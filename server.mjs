import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.resolve(process.env.DIGIFORT_CONFIG_DIR || path.join(ROOT, 'config'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 4177);
const launcher = process.argv.includes('--launcher');
const configs = new Map();
const authStates = new Map();
const authPromises = new Map();
const mediaWriters = new Map();
const mediaRequests = new Set();
let shuttingDown = false;
let activeServerId = '';
let authGeneration = 0;

const safeError = (message, status = 400) => ({ status, body: { error: message } });

function safeId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(value) && value !== '.' && value !== '..';
}

function parseTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

async function readConfig(id) {
  if (!safeId(id) || id.toLowerCase() === 'example') throw new Error('Configuração de servidor inválida.');
  const configPath = path.resolve(CONFIG_DIR, `${id}.config`);
  if (!configPath.startsWith(`${CONFIG_DIR}${path.sep}`)) throw new Error('Configuração de servidor inválida.');
  let source;
  try {
    source = await fs.readFile(configPath, 'utf8');
  } catch {
    throw new Error('Não foi possível ler o arquivo de configuração selecionado. Verifique se o arquivo existe e se está acessível.');
  }
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    const position = Number(error?.message?.match(/position\s+(\d+)/i)?.[1] ?? source.length);
    const safePosition = Math.max(0, Math.min(position, source.length));
    const beforeError = source.slice(0, safePosition);
    const line = (beforeError.match(/\n/g) ?? []).length + 1;
    const column = safePosition - beforeError.lastIndexOf('\n');
    throw new Error(`O arquivo de configuração não contém JSON válido (linha ${line}, coluna ${column}). Salve como JSON UTF-8 sem BOM e revise aspas e vírgulas.`);
  }
  return value;
}

function configName(id, value) {
  return typeof value?.name === 'string' && value.name.trim()
    ? value.name.trim().replace(/\s+/g, ' ').slice(0, 120)
    : id;
}

function parseConfig(id, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A configuração deve ser um objeto JSON.');
  const { serverAddress, userAgent, username, password, timeZone, initialCameras } = value;
  const name = configName(id, value);
  const useBasicAuth = value.useBasicAuth ?? false;
  if (typeof serverAddress !== 'string' || !/^https?:\/\//i.test(serverAddress)) throw new Error('A configuração precisa de um endereço HTTP ou HTTPS válido.');
  let parsedAddress;
  try { parsedAddress = new URL(serverAddress); } catch { throw new Error('A configuração precisa de um endereço HTTP ou HTTPS válido.'); }
  if (parsedAddress.username || parsedAddress.password) throw new Error('Remova usuário e senha do endereço do servidor; use os campos próprios da configuração.');
  if (typeof userAgent !== 'string' || !userAgent.trim()) throw new Error('A configuração precisa informar um User-Agent.');
  if (typeof useBasicAuth !== 'boolean') throw new Error('useBasicAuth deve ser true ou false.');
  if (typeof username !== 'string' || !username.trim()) throw new Error('A configuração precisa informar o usuário.');
  if (typeof password !== 'string') throw new Error('A configuração precisa informar a senha.');
  if (typeof timeZone !== 'string' || !parseTimeZone(timeZone)) throw new Error('A configuração precisa informar um fuso horário IANA válido.');
  if (!initialCameras || typeof initialCameras !== 'object' || Array.isArray(initialCameras)) throw new Error('initialCameras deve ser um mapa de câmeras para perfis.');
  for (const [camera, profile] of Object.entries(initialCameras)) {
    if (!camera.trim() || !['Visualization', 'Recording'].includes(profile)) throw new Error('Cada câmera inicial precisa ter um nome e o perfil Visualization ou Recording.');
  }
  const mosaicIds = new Set(['auto', '2x2', '3x3-six', '4x4-eight', '3x3', '4x4-ten', '4x4-thirteen-a', '4x4-thirteen-b', '4x4-center', '4x4', '5x5']);
  const initialMosaic = value.initialMosaic ?? 'auto';
  if (typeof initialMosaic !== 'string' || !mosaicIds.has(initialMosaic)) throw new Error('initialMosaic deve corresponder a um mosaico disponível.');
  for (const key of ['mediaFolder', 'screenshotFolder', 'videoFolder']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') throw new Error(`${key} deve ser um caminho de pasta ou uma string vazia.`);
  }
  const mediaFolder = value.mediaFolder?.trim() || '';
  const screenshotFolder = value.screenshotFolder?.trim() || mediaFolder;
  const videoFolder = value.videoFolder?.trim() || mediaFolder;
  return { id, name, serverAddress: serverAddress.replace(/\/+$/, ''), userAgent: userAgent.trim(), username, password, useBasicAuth, timeZone, initialCameras, initialMosaic, screenshotFolder, videoFolder };
}

async function getConfig(id) {
  if (configs.has(id)) return configs.get(id);
  const parsed = parseConfig(id, await readConfig(id));
  configs.set(id, parsed);
  return parsed;
}

async function serverOptions() {
  let entries;
  try {
    entries = await fs.readdir(CONFIG_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids = entries
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.config') && entry.name.toLowerCase() !== 'example.config')
    .map(entry => entry.name.slice(0, -'.config'.length))
    .filter(safeId)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return Promise.all(ids.map(async id => {
    let name = id;
    try {
      const value = await readConfig(id);
      name = configName(id, value);
      parseConfig(id, value);
      return { id, name, ready: true };
    } catch {
      return { id, name, ready: false };
    }
  }));
}

function activateServer(id) {
  if (activeServerId === id) return;
  authGeneration += 1;
  for (const [serverId, state] of authStates) {
    if (state.timer) clearInterval(state.timer);
    authStates.delete(serverId);
  }
  authPromises.clear();
  for (const serverId of configs.keys()) if (serverId !== id) configs.delete(serverId);
  activeServerId = id;
}

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

const DIGIFORT_REQUEST_HEADERS = Object.freeze({
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Accept-Encoding': 'gzip, deflate'
});

const AUTH_QUERY_KEYS = /^(authuser|authpass|authsession|authdata|username|password|passwd|token|nonce|authorization)$/i;
const PRIVATE_QUERY_KEYS = /^(camera|startdate|starttime|enddate|endtime)$/i;

function safeApiTarget(url) {
  const parsed = new URL(url);
  const query = new URLSearchParams();
  for (const [key, value] of parsed.searchParams) {
    query.append(key, AUTH_QUERY_KEYS.test(key) || PRIVATE_QUERY_KEYS.test(key) ? '[REDACTED]' : value);
  }
  const target = `${parsed.pathname}${query.size ? `?${query}` : ''}`;
  return target.replace(/[\r\n]/g, '').slice(0, 1600);
}

async function fetchDigifort(config, url, options = {}, operation = 'upstream_request') {
  const method = String(options.method || 'GET').toUpperCase();
  const target = safeApiTarget(url);
  const headers = new Headers({ ...DIGIFORT_REQUEST_HEADERS, 'User-Agent': config.userAgent });
  new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  try {
    const response = await fetch(url, { ...options, headers });
    return response;
  } catch (error) {
    const causeCode = error?.cause?.code;
    const safeCode = typeof causeCode === 'string' && /^[a-z0-9_]+$/i.test(causeCode)
      ? causeCode
      : error?.name === 'TimeoutError' ? 'TIMEOUT' : 'FETCH_ERROR';
    process.stderr.write(`[api:transport-error] ${method} ${target} ${operation} ${safeCode}\n`);
    throw new Error(`Falha de transporte na etapa ${operation} (${safeCode}).`);
  }
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

async function createAuthState(id, config) {
  const generation = authGeneration;
  const response = await fetchDigifort(config, apiUrl(config, 'CreateAuthSession', { ResponseFormat: 'JSON' }), { signal: AbortSignal.timeout(12000) }, 'CreateAuthSession');
  const payload = await readJsonResponse(response);
  if (generation !== authGeneration || activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
  const session = extractSession(payload);
  const state = { ...session, authData: makeAuthData(session.nonce, config.username, config.password), timer: null };
  state.timer = setInterval(async () => {
    try {
      const url = apiUrl(config, 'UpdateAuthSession', { AuthSession: state.id, AuthData: state.authData, ResponseFormat: 'JSON' });
      const keepAlive = await fetchDigifort(config, url, { signal: AbortSignal.timeout(10000) }, 'UpdateAuthSession');
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
    return fetchDigifort(config, url, { signal }, route.replaceAll('/', '_'));
  }
  let session = await authState(id, config);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const url = apiUrl(config, route, { ...params, AuthSession: session.id, AuthData: session.authData });
    const response = await fetchDigifort(config, url, { signal }, route.replaceAll('/', '_'));
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

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function mediaTarget(config, filename, screenshot) {
  const key = screenshot ? 'screenshotFolder' : 'videoFolder';
  if (!config[key]) throw new Error(`Defina ${key} ou mediaFolder no arquivo de configuração do servidor.`);
  const validName = screenshot ? /^[\p{L}\p{N}_-]{1,100}\.png$/u : /^[\p{L}\p{N}_-]{1,100}\.(?:mp4|mpg)$/u;
  if (typeof filename !== 'string' || !validName.test(filename)) throw new Error('Nome de arquivo de mídia inválido.');
  const folder = path.resolve(config[key]);
  return { folder, finalPath: path.join(folder, filename), partPath: path.join(folder, `${filename}.part`) };
}

async function writeRequestToStream(req, stream) {
  for await (const chunk of req) {
    await new Promise((resolve, reject) => {
      stream.write(chunk, error => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

async function finishRecording(writer, recover = false) {
  const { stream, partPath, finalPath, completedBytes } = writer;
  try {
    if (!stream.closed) {
      const closed = once(stream, 'close');
      stream.end();
      await closed;
    }
    if (recover) {
      if (completedBytes === 0) {
        await fs.unlink(partPath);
        return;
      }
      await fs.truncate(partPath, completedBytes);
    }
    await fs.rename(partPath, finalPath);
  } catch (error) {
    await fs.unlink(partPath).catch(() => {});
    throw error;
  }
}

async function handleMediaPost(req, res, url) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método não disponível.' });
    const id = queryValue(url, 'server');
    if (activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
    const config = await getConfig(id);
    const filename = queryValue(url, 'filename');
    const screenshot = url.pathname === '/api/media-file';
    const { folder, finalPath, partPath } = mediaTarget(config, filename, screenshot);
    await fs.mkdir(folder, { recursive: true });
    if (screenshot) {
      if ((req.headers['content-type'] || '').toLowerCase() !== 'image/png') throw new Error('O tipo de imagem enviado é inválido.');
      const temporaryPath = `${partPath}.${process.pid}`;
      try { await pipeline(req, createWriteStream(temporaryPath, { flags: 'wx' })); }
      catch (error) { await fs.unlink(temporaryPath).catch(() => {}); throw error; }
      if (await fs.stat(finalPath).then(() => true, () => false)) { await fs.unlink(temporaryPath).catch(() => {}); throw new Error('Já existe um arquivo com esse nome.'); }
      await fs.rename(temporaryPath, finalPath);
      return sendJson(res, 201, { filename });
    }
    if (url.pathname !== '/api/media-recording') return sendJson(res, 404, { error: 'Rota não encontrada.' });
    const action = queryValue(url, 'action');
    const key = `${id}\0${filename}`;
    if (action === 'start') {
      if (mediaWriters.has(key) || await fs.stat(partPath).then(() => true, () => false) || await fs.stat(finalPath).then(() => true, () => false)) throw new Error('Já existe uma gravação com esse nome.');
      const stream = createWriteStream(partPath, { flags: 'wx' });
      stream.on('error', () => { mediaWriters.delete(key); void fs.unlink(partPath).catch(() => {}); });
      try { await once(stream, 'open'); } catch (error) { throw new Error(`Não foi possível criar o arquivo de gravação: ${error.code || 'erro de escrita'}.`); }
      mediaWriters.set(key, { stream, partPath, finalPath, completedBytes: 0 });
      return sendJson(res, 201, { filename });
    }
    const writer = mediaWriters.get(key);
    if (!writer) throw new Error('A gravação local não está aberta.');
    if (action === 'chunk') {
      await writeRequestToStream(req, writer.stream);
      writer.completedBytes = writer.stream.bytesWritten;
      return sendJson(res, 200, { accepted: true });
    }
    if (action === 'abort') {
      mediaWriters.delete(key);
      const closed = writer.stream.closed ? Promise.resolve() : once(writer.stream, 'close').catch(() => {});
      writer.stream.destroy();
      await closed;
      await fs.unlink(writer.partPath).catch(() => {});
      return sendJson(res, 200, { discarded: true });
    }
    if (action !== 'finish') throw new Error('Ação de gravação inválida.');
    mediaWriters.delete(key);
    await finishRecording(writer);
    return sendJson(res, 201, { filename });
  } catch (error) {
    const message = error?.message && !/password|authdata|authsession|nonce/i.test(error.message) ? error.message : 'Não foi possível salvar a mídia local.';
    sendJson(res, 400, { error: message });
  }
}

function safeErrorCategory(error) {
  const message = String(error?.message ?? '');
  const transport = message.match(/^Falha de transporte na etapa ([a-zA-Z0-9_]+) \(([A-Z0-9_]+)\)\.?$/);
  if (transport) return `transport:${transport[1]}:${transport[2]}`;
  if (/arquivo de configuração não contém JSON válido/i.test(message)) return 'invalid-config-json';
  if (/configuração|fuso|initialCameras|initialMosaic/i.test(message)) return 'invalid-config';
  if (/servidor Digifort não aceitou/i.test(message)) return 'upstream-rejected';
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'request-timeout';
  return 'request-failed';
}

function queryValue(url, key, required = true) {
  const value = url.searchParams.get(key);
  if (required && !value) throw new Error(`Parâmetro ausente: ${key}.`);
  return value;
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

async function handleApi(req, res, url) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    if (req.method === 'POST' && ['/api/media-file', '/api/media-recording'].includes(url.pathname)) {
      const pending = handleMediaPost(req, res, url);
      mediaRequests.add(pending);
      try { return await pending; } finally { mediaRequests.delete(pending); }
    }
    if (launcher && req.method === 'POST' && ['/api/config-folder', '/api/close-app'].includes(url.pathname)) {
      if (req.headers.origin !== `http://${HOST}:${PORT}` || req.headers.host !== `${HOST}:${PORT}`) {
        return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      }
      const command = url.pathname === '/api/config-folder' ? 'DIGIFORT_OPEN_CONFIG' : 'DIGIFORT_CLOSE_APP';
      return res.once('finish', () => process.stdout.write(`${command}\n`)).writeHead(204).end();
    }
    if (url.pathname === '/api/config') {
      if (req.headers.host !== `${HOST}:${PORT}` || (req.method !== 'GET' && req.headers.origin !== `http://${HOST}:${PORT}`)) return sendJson(res, 403, { error: 'Solicitação de outra origem.' });
      const id = queryValue(url, 'server');
      if (!safeId(id) || id.toLowerCase() === 'example') throw new Error('Identificador de configuração inválido.');
      const configPath = path.join(CONFIG_DIR, `${id}.config`);
      if (req.method === 'GET') {
        const value = await readConfig(id);
        const fields = Object.fromEntries(['name', 'serverAddress', 'userAgent', 'username', 'timeZone', 'mediaFolder', 'screenshotFolder', 'videoFolder', 'initialMosaic', 'useBasicAuth', 'initialCameras'].filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
        return sendJson(res, 200, { fields, hasPassword: typeof value.password === 'string' });
      }
      if (req.method === 'DELETE') {
        await fs.unlink(configPath);
        configs.delete(id);
        if (activeServerId === id) activateServer('');
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'PUT' || req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 65536) throw new Error('Configuração muito grande.');
        }
        let fields;
        try { fields = JSON.parse(body); } catch { throw new Error('Configuração JSON inválida.'); }
        if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new Error('Configuração inválida.');
        let previous = {};
        if (req.method === 'PUT') previous = await readConfig(id);
        const value = { ...previous, ...fields };
        if (!Object.hasOwn(fields, 'password')) value.password = previous.password;
        parseConfig(id, value);
        await fs.mkdir(CONFIG_DIR, { recursive: true });
        if (req.method === 'POST') await fs.writeFile(configPath, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
        else await fs.writeFile(configPath, JSON.stringify(value, null, 2) + '\n');
        configs.delete(id);
        if (activeServerId === id) activateServer('');
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: 'Método não disponível.' });
    }
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Método não disponível.' });
    if (url.pathname === '/api/servers') {
      return sendJson(res, 200, { servers: await serverOptions(), configDirectory: CONFIG_DIR, canOpenConfigFolder: launcher });
    }
    const id = queryValue(url, 'server');
    if (url.pathname === '/api/server') {
      const config = await getConfig(id);
      activateServer(id);
      return sendJson(res, 200, { id, name: config.name, timeZone: config.timeZone, initialCameras: config.initialCameras, initialMosaic: config.initialMosaic, screenshotFolderConfigured: Boolean(config.screenshotFolder), videoFolderConfigured: Boolean(config.videoFolder) });
    }
    if (activeServerId !== id) throw new Error('Selecione novamente o servidor antes de continuar.');
    const config = await getConfig(id);
    if (url.pathname === '/api/cameras') {
      const response = await apiFetch(id, config, 'Cameras/GetCameras', {
        Fields: 'Name,Description,Active,MediaProfiles',
        ResponseFormat: 'JSON'
      }, controller.signal);
      const payload = await readJsonResponse(response);
      return sendJson(res, 200, { cameras: findCameras(payload) });
    }
    if (url.pathname === '/api/camera-status') {
      const response = await apiFetch(id, config, 'Cameras/GetStatus', {
        ResponseFormat: 'JSON'
      }, controller.signal);
      const payload = await readJsonResponse(response);
      return sendJson(res, 200, { statuses: findCameraStatuses(payload) });
    }
    if (url.pathname === '/api/timeline') {
      const camera = queryValue(url, 'camera');
      const startDate = queryValue(url, 'startDate');
      const startTime = queryValue(url, 'startTime');
      const endDate = queryValue(url, 'endDate', false);
      const endTime = queryValue(url, 'endTime', false);
      const response = await apiFetch(id, config, 'Cameras/Playback/GetTimelineData', {
        Camera: camera, StartDate: startDate, StartTime: startTime,
        EndDate: endDate, EndTime: endTime, Video: 'TRUE', Audio: 'TRUE', Metadata: 'FALSE', ResponseFormat: 'Text'
      }, controller.signal);
      if (!response.ok || !response.body || !(response.headers.get('content-type') || '').toLowerCase().includes('multipart/')) throw new Error('Não foi possível carregar a timeline dessa câmera. Verifique acesso e período selecionado.');
      res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'multipart/x-mixed-replace', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      for await (const chunk of response.body) {
        if (!res.write(Buffer.from(chunk))) await new Promise(resolve => res.once('drain', resolve));
      }
      return res.end();
    }
    if (url.pathname === '/api/snapshot') {
      const snapshotSizes = { '75x51': ['75', '51'], '150x102': ['150', '102'], '300x205': ['300', '205'], '352x240': ['352', '240'] };
      const requested = `${queryValue(url, 'width') || '352'}x${queryValue(url, 'height') || '240'}`;
      const [width, height] = snapshotSizes[requested] || snapshotSizes['352x240'];
      const response = await apiFetch(id, config, 'Cameras/Playback/GetSnapshot', {
        Camera: queryValue(url, 'camera'), Date: queryValue(url, 'date'), Time: queryValue(url, 'time'),
        Width: width, Height: height, KeepAspectRatio: 'TRUE', Quality: '55', ResponseFormat: 'Text'
      }, controller.signal);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.toLowerCase().includes('image/jpeg')) throw new Error('Não há imagem gravada nesse instante.');
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      await response.body.pipeTo(WritableStreamFromServerResponse(res));
      return;
    }
    if (url.pathname === '/api/stream' || url.pathname === '/api/audio-stream') {
      const audioOnly = url.pathname === '/api/audio-stream';
      const mode = queryValue(url, 'mode');
      const camera = queryValue(url, 'camera');
      const audio = audioOnly || queryValue(url, 'audio', false) === '1';
      let response;
      if (mode === 'live') {
        const profile = queryValue(url, 'profile', false) || 'Visualization';
        if (!['Visualization', 'Recording'].includes(profile)) throw new Error('Perfil ao vivo inválido.');
        response = await apiFetch(id, config, 'Cameras/GetMediaStream', {
          Camera: camera, Profile: profile, Audio: audio ? 'TRUE' : 'FALSE', Video: audioOnly ? 'FALSE' : 'TRUE', TimestampHeader: 'TRUE', ResponseFormat: 'Text'
        }, controller.signal);
      } else if (mode === 'playback') {
        response = await apiFetch(id, config, 'Cameras/Playback/GetMediaStream', {
          Camera: camera, StartDate: queryValue(url, 'startDate'), StartTime: queryValue(url, 'startTime'),
          EndDate: queryValue(url, 'endDate', false), EndTime: queryValue(url, 'endTime', false),
          Audio: audio ? 'TRUE' : 'FALSE', Push: 'FALSE', ResponseFormat: 'Text'
        }, controller.signal);
      } else {
        throw new Error('Modo de reprodução inválido.');
      }
      if (!response.ok || !response.body || !(response.headers.get('content-type') || '').toLowerCase().includes('multipart/')) throw new Error('Não foi possível abrir o stream da câmera. Verifique acesso e perfil selecionado.');
      res.writeHead(200, { 'Content-Type': response.headers.get('content-type') || 'multipart/x-mixed-replace; boundary=--DigifortBoundary', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      for await (const chunk of response.body) {
        if (!res.write(Buffer.from(chunk))) await new Promise(resolve => res.once('drain', resolve));
      }
      return res.end();
    }
    return sendJson(res, 404, { error: 'Rota não encontrada.' });
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    const message = error?.message && !/password|authdata|authsession|nonce|http[s]?:\/\//i.test(error.message)
      ? error.message
      : 'Não foi possível concluir a solicitação. Revise a conexão e a configuração local.';
    const status = /configuração|fuso|initialCameras|initialMosaic|parâmetro|perfil/i.test(message) ? 400 : 502;
    process.stderr.write(`[api:error] ${req.method} ${url.pathname} ${status} ${safeErrorCategory(error)}\n`);
    sendJson(res, status, { error: message });
  }
}

function WritableStreamFromServerResponse(res) {
  return new WritableStream({
    write(chunk) {
      if (!res.write(Buffer.from(chunk))) return new Promise(resolve => res.once('drain', resolve));
    },
    close() { res.end(); },
    abort() { res.destroy(); }
  });
}

function staticFile(res, pathname) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  let decodedPath;
  try { decodedPath = decodeURIComponent(normalized); }
  catch { return sendJson(res, 400, { error: 'Caminho inválido.' }); }
  const filePath = path.resolve(PUBLIC_DIR, `.${decodedPath}`);
  if (!filePath.startsWith(`${PUBLIC_DIR}${path.sep}`)) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
  fs.stat(filePath).then(stat => {
    if (!stat.isFile()) return sendJson(res, 404, { error: 'Arquivo não encontrado.' });
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    createReadStream(filePath).pipe(res);
  }).catch(() => sendJson(res, 404, { error: 'Arquivo não encontrado.' }));
}

const server = createServer((req, res) => {
  if (shuttingDown) return sendJson(res, 503, { error: 'Encerrando o Digifort Monitor.' });
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    void handleApi(req, res, url);
    return;
  }
  staticFile(res, url.pathname);
});

server.once('error', error => {
  if (launcher && error.code === 'EADDRINUSE') process.stdout.write('DIGIFORT_PORT_IN_USE\n');
  process.stderr.write(`Falha ao escutar em ${HOST}:${PORT} (${error.code || 'erro de inicialização'}).\n`);
  process.exitCode = 1;
  process.stdin.destroy();
});

server.listen(PORT, HOST, () => {
  if (launcher) process.stdout.write('DIGIFORT_READY\n');
  process.stdout.write(`Player local disponível em http://${HOST}:${PORT}\n`);
});

if (launcher) {
  const control = createInterface({ input: process.stdin, terminal: false });
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close();
    // Give a pending media upload a brief chance to drain before closing streams.
    const pendingMedia = Promise.allSettled(mediaRequests);
    await Promise.race([pendingMedia, delay(750)]);
    server.closeAllConnections();
    await pendingMedia;
    await Promise.allSettled([...mediaWriters.values()].map(writer => finishRecording(writer, true)));
    process.exit(process.exitCode || 0);
  };
  control.on('line', line => { if (line === 'shutdown') void shutdown(); });
  control.on('close', () => { if (server.listening) void shutdown(); });
}
