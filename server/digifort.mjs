import { createHash } from 'node:crypto';

function md5(value) {
  return createHash('md5').update(value, 'utf8').digest('hex').toUpperCase();
}

function makeAuthData(nonce, username, password) {
  return md5(`${nonce}:${username.toUpperCase()}:${md5(password)}`);
}

function apiUrl(config, route, params = {}) {
  const url = new URL(`${config.serverAddress}/Interface/${route}`);
  const authParams = config.useBasicAuth
    ? { AuthUser: config.username, AuthPass: config.password }
    : {};
  for (const [key, value] of Object.entries({ ...params, ...authParams })) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url;
}

function extractSession(payload) {
  const response = payload?.Response ?? payload?.response ?? payload;
  const session = response?.Data?.Session ?? response?.data?.session ?? response?.Session ?? response?.session;
  const id = session?.ID ?? session?.Id ?? session?.id;
  const nonce = session?.NOnce ?? session?.Nonce ?? session?.nonce;
  if (id === undefined || !nonce) throw new Error('A autenticação segura não retornou uma sessão válida.');
  return { id: String(id), nonce: String(nonce) };
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!response.ok) throw new Error('O servidor Digifort não aceitou a solicitação.');
  try {
    const data = JSON.parse(text);
    const result = data?.Response ?? data?.response ?? data;
    const code = result?.Code ?? result?.code;
    if (code !== undefined && Number(code) !== 0) throw new Error('O servidor Digifort recusou a solicitação.');
    return data;
  } catch (error) {
    if (error.message.startsWith('O servidor Digifort')) throw error;
    throw new Error('O servidor Digifort retornou uma resposta inválida.');
  }
}

function findCameras(payload) {
  const found = new Map();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const name = value.NAME ?? value.Name ?? value.name;
    if (typeof name === 'string' && name.trim()) {
      const description = value.DESCRIPTION ?? value.Description ?? value.description ?? '';
      const active = value.ACTIVE ?? value.Active ?? value.active;
      const profiles = value.MEDIAPROFILES ?? value.MediaProfiles ?? value.mediaProfiles ?? '';
      found.set(name, {
        name,
        description: typeof description === 'string' ? description : '',
        active: active === undefined ? true : String(active).toUpperCase() !== 'FALSE',
        profiles: typeof profiles === 'string' ? profiles.split(',').map(x => x.trim()).filter(Boolean) : []
      });
    }
    Object.values(value).forEach(walk);
  };
  walk(payload);
  if (!found.size && payload && typeof payload === 'object') {
    const flat = payload.Response?.Data ?? payload.Data ?? payload;
    const keys = Object.keys(flat);
    const prefixSet = new Set(keys.map(key => key.match(/^(CAMERA_\d+)_NAME$/i)?.[1]).filter(Boolean));
    for (const prefix of prefixSet) {
      const get = suffix => flat[`${prefix}_${suffix}`] ?? flat[`${prefix}_${suffix.toLowerCase()}`];
      const name = get('NAME');
      if (name) found.set(String(name), { name: String(name), description: String(get('DESCRIPTION') ?? ''), active: String(get('ACTIVE') ?? 'TRUE').toUpperCase() !== 'FALSE', profiles: String(get('MEDIAPROFILES') ?? '').split(',').filter(Boolean) });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function findCameraStatuses(payload) {
  const found = new Map();
  const getField = (object, name) => {
    const entry = Object.entries(object).find(([key]) => key.toLowerCase() === name.toLowerCase());
    return entry?.[1];
  };
  const toBoolean = value => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) return true;
    if (['false', '0', 'no'].includes(normalized)) return false;
    return null;
  };
  const toSeconds = value => {
    if (value === undefined || value === null || value === '') return null;
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  };
  const add = (name, working, activeTime, inactiveTime) => {
    if (typeof name !== 'string' || !name.trim()) return;
    found.set(name, {
      working: toBoolean(working),
      activeTime: toSeconds(activeTime),
      inactiveTime: toSeconds(inactiveTime)
    });
  };
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const name = getField(value, 'Name');
    if (typeof name === 'string') {
      add(name, getField(value, 'Working'), getField(value, 'ActiveTime'), getField(value, 'InactiveTime'));
    }
    Object.values(value).forEach(walk);
  };
  walk(payload);
  if (!found.size && payload && typeof payload === 'object') {
    const flat = payload.Response?.Data ?? payload.Data ?? payload;
    const prefixes = new Set(Object.keys(flat).map(key => key.match(/^(CAMERA_\d+)_NAME$/i)?.[1]).filter(Boolean));
    for (const prefix of prefixes) {
      const get = suffix => flat[`${prefix}_${suffix}`] ?? flat[`${prefix}_${suffix.toLowerCase()}`];
      add(get('NAME'), get('WORKING'), get('ACTIVETIME'), get('INACTIVETIME'));
    }
  }
  return [...found].map(([name, status]) => ({ name, ...status }));
}


export function createDigifortTransport({ adapter }) {
  const authStates = new Map(), authPromises = new Map();
  let activeServerId = '', authGeneration = 0;

async function createAuthState(id, config) {
  const generation = authGeneration;
  const response = await adapter.request(config, apiUrl(config, 'CreateAuthSession', { ResponseFormat: 'JSON' }), { signal: AbortSignal.timeout(12000) }, 'CreateAuthSession');
  const payload = await readJsonResponse(response);
  if (generation !== authGeneration || activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
  const session = extractSession(payload);
  const state = { ...session, authData: makeAuthData(session.nonce, config.username, config.password), timer: null };
  state.timer = setInterval(async () => {
    try {
      const url = apiUrl(config, 'UpdateAuthSession', { AuthSession: state.id, AuthData: state.authData, ResponseFormat: 'JSON' });
      const keepAlive = await adapter.request(config, url, { signal: AbortSignal.timeout(10000) }, 'UpdateAuthSession');
      if (!keepAlive.ok) {
        clearInterval(state.timer);
        authStates.delete(id);
      }
    } catch {
      clearInterval(state.timer);
      authStates.delete(id);
    }
  }, 25000);
  state.timer.unref?.();
  const previous = authStates.get(id);
  if (previous?.timer) clearInterval(previous.timer);
  authStates.set(id, state);
  return state;
}

async function authState(id, config, refresh = false) {
  if (!refresh && authStates.has(id)) return authStates.get(id);
  if (authPromises.has(id)) return authPromises.get(id);
  const pending = createAuthState(id, config);
  authPromises.set(id, pending);
  pending.finally(() => { if (authPromises.get(id) === pending) authPromises.delete(id); }).catch(() => {});
  return pending;
}

async function apiFetch(id, config, route, params, signal) {
  if (config.useBasicAuth) {
    const url = apiUrl(config, route, params);
    return adapter.request(config, url, { signal }, route.replaceAll('/', '_'));
  }
  let session = await authState(id, config);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = apiUrl(config, route, { ...params, AuthSession: session.id, AuthData: session.authData });
    const response = await adapter.request(config, url, { signal }, route.replaceAll('/', '_'));
    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      await response.body?.cancel().catch(() => {});
      if (authStates.get(id) === session) {
        authStates.delete(id);
        session = await authState(id, config, true);
      } else {
        session = await authState(id, config);
      }
      continue;
    }
    return response;
  }
  throw new Error('A sessão segura do servidor expirou. Selecione o servidor novamente.');
}


function activate(id) {
  if (activeServerId === id) return;
  authGeneration += 1;
  for (const state of authStates.values()) if (state.timer) clearInterval(state.timer);
  authStates.clear();
  authPromises.clear();
  activeServerId = id;
}
async function cameras(id, config, signal) {
  const response = await apiFetch(id, config, 'Cameras/GetCameras', { Fields: 'Name,Description,Active,MediaProfiles', ResponseFormat: 'JSON' }, signal);
  return findCameras(await readJsonResponse(response));
}
async function statuses(id, config, signal) {
  const response = await apiFetch(id, config, 'Cameras/GetStatus', { ResponseFormat: 'JSON' }, signal);
  return findCameraStatuses(await readJsonResponse(response));
}
return { activate, request: apiFetch, cameras, statuses };
}
