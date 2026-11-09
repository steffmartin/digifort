const $ = selector => document.querySelector(selector);
let g726ModulePromise;

function loadG726Decoder() {
  if (!g726ModulePromise) {
    g726ModulePromise = import('/wasm/digifort_g726_wasm.js')
      .then(async module => { await module.default(); return module.G726Decoder; })
      .catch(error => { g726ModulePromise = null; throw error; });
  }
  return g726ModulePromise;
}

function getG726Config(headers, type) {
  const hint = [type, headers['content-type'], headers['dgf-frametype'], headers['dgf-codec'], headers['dgf-audioformat'], headers['dgf-audiocodec']]
    .filter(Boolean).join(' ').toLowerCase();
  const headerRate = [headers['dgf-bitrate'], headers['dgf-audio-bitrate'], headers['bitrate']]
    .find(value => value !== undefined)?.match(/(?:16|24|32|40)(?:000)?/);
  const namedRate = hint.match(/g\.?726(?:[-_/ ]?(16|24|32|40))|\b(16|24|32|40)\s*(?:kbps|kbit(?:s|\/s)?)/i);
  const parsedRate = Number(headerRate?.[0]?.replace(/000$/, '') || namedRate?.[1] || namedRate?.[2]);
  const rate = [16, 24, 32, 40].includes(parsedRate) ? parsedRate : null;
  const orderHint = [headers['dgf-bitorder'], headers['dgf-audio-bit-order'], headers['bit-order'], headers['bitorder'], hint]
    .filter(Boolean).join(' ').toLowerCase();
  const explicitOrder = /\b(?:lsb|little[- ]?endian|le)\b/.test(orderHint) ? 'lsb'
    : /\b(?:msb|big[- ]?endian|be)\b/.test(orderHint) ? 'msb' : null;
  // The Digifort MIME does not carry packing order; RFC 3551 defines the canonical G.726 payload as LSB-first.
  return { rate, bitOrder: explicitOrder || 'lsb', assumedBitOrder: !explicitOrder };
}

const state = {
  servers: [], serverId: '', server: null, cameras: [], tiles: new Map(),
  mode: 'live', focused: '', audioSource: '', audioEnabled: false,
  allStopped: false,
  audioContext: null, reviewEpoch: null, reviewStart: null, reviewEnd: null,
  timeline: [], timelineStart: null, timelineEnd: null, timelineCamera: '',
  thumbnailPage: 0, thumbnails: [], thumbnailObjectUrls: []
};

const elements = {
  serverSelect: $('#serverSelect'), connectionState: $('#connectionState'), connectionLabel: $('#connectionLabel'),
  cameraSearch: $('#cameraSearch'), cameraList: $('#cameraList'), cameraListEmpty: $('#cameraListEmpty'),
  cameraCount: $('#cameraCount'), availableCount: $('#availableCount'), timeZone: $('#serverTimeZone'),
  liveMode: $('#liveMode'), reviewMode: $('#reviewMode'), reviewFields: $('#reviewFields'),
  startDateTime: $('#startDateTime'), endDateTime: $('#endDateTime'), playReview: $('#playReview'),
  audioSource: $('#audioSource'), audioToggle: $('#audioToggle'), viewerGrid: $('#viewerGrid'), emptyMonitor: $('#emptyMonitor'),
  viewTitle: $('#viewTitle'), viewSubtitle: $('#viewSubtitle'), tileCount: $('#tileCount'), stopAll: $('#stopAll'),
  reviewPanel: $('#reviewPanel'), timelineCameraLabel: $('#timelineCameraLabel'), timelineRuler: $('#timelineRuler'),
  videoLane: $('#videoLane'), audioLane: $('#audioLane'), timelineStatus: $('#timelineStatus'),
  thumbnailPanel: $('#thumbnailPanel'), thumbnailGrid: $('#thumbnailGrid'), thumbnailStatus: $('#thumbnailStatus'),
  thumbnailInterval: $('#thumbnailInterval'), customInterval: $('#customInterval'), thumbnailPrev: $('#thumbnailPrev'),
  thumbnailNext: $('#thumbnailNext'), thumbnailPageLabel: $('#thumbnailPageLabel'),
  modeStatus: $('#modeStatus'), statusLiveDot: $('#statusLiveDot'), focusedLabel: $('#focusedLabel'),
  codecStatus: $('#codecStatus'), toastRegion: $('#toastRegion')
};

function toast(message, kind = 'info') {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'error' ? 'error' : ''}`;
  node.textContent = message;
  elements.toastRegion.append(node);
  window.setTimeout(() => node.remove(), 5200);
}

function setConnection(status, label) {
  elements.connectionState.dataset.state = status;
  elements.connectionLabel.textContent = label;
}

async function apiJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  let result;
  try { result = await response.json(); } catch { throw new Error('O serviço local retornou uma resposta inválida.'); }
  if (!response.ok) throw new Error(result?.error || 'Não foi possível concluir a solicitação.');
  return result;
}

function query(params) {
  return new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')).toString();
}

async function initializeServers() {
  setConnection('idle', 'Procurando servidores');
  try {
    const result = await apiJson('/api/servers');
    state.servers = result.servers || [];
    elements.serverSelect.replaceChildren();
    if (!state.servers.length) {
      const option = new Option('Nenhuma configuração encontrada', '');
      elements.serverSelect.add(option);
      elements.serverSelect.disabled = true;
      elements.cameraListEmpty.textContent = 'Crie um arquivo config/<servidor>.config a partir de config/example.config.';
      elements.cameraListEmpty.hidden = false;
      setConnection('idle', 'Aguardando configuração');
      return;
    }
    elements.serverSelect.disabled = false;
    if (state.servers.length > 1) {
      elements.serverSelect.add(new Option('Escolha um servidor…', ''));
    }
    for (const id of state.servers) elements.serverSelect.add(new Option(id, id));
    if (state.servers.length === 1) {
      elements.serverSelect.value = state.servers[0];
      await selectServer(state.servers[0]);
    } else {
      setConnection('idle', 'Escolha um servidor');
      elements.cameraListEmpty.textContent = 'Selecione um servidor para carregar as câmeras.';
      elements.cameraListEmpty.hidden = false;
    }
  } catch (error) {
    setConnection('error', 'Serviço indisponível');
    elements.cameraListEmpty.textContent = error.message;
    elements.cameraListEmpty.hidden = false;
  }
}

async function selectServer(id) {
  if (!id) return;
  await closeAllTiles();
  state.mode = 'live';
  state.serverId = id;
  state.server = null;
  state.cameras = [];
  state.focused = '';
  state.audioSource = '';
  state.audioEnabled = false;
  state.allStopped = false;
  state.reviewEpoch = null;
  state.reviewStart = null;
  state.reviewEnd = null;
  elements.liveMode.classList.add('is-active');
  elements.liveMode.setAttribute('aria-pressed', 'true');
  elements.reviewMode.classList.remove('is-active');
  elements.reviewMode.setAttribute('aria-pressed', 'false');
  elements.reviewFields.hidden = true;
  elements.reviewPanel.hidden = true;
  elements.thumbnailPanel.hidden = true;
  clearThumbnails();
  setConnection('idle', 'Conectando');
  elements.cameraList.replaceChildren();
  elements.cameraListEmpty.hidden = false;
  elements.cameraListEmpty.textContent = 'Carregando câmeras…';
  try {
    const serverInfo = await apiJson(`/api/server?${query({ server: id })}`);
    state.server = serverInfo;
    elements.timeZone.textContent = `Fuso · ${serverInfo.timeZone}`;
    $('#reviewTimeZone').textContent = `Horário do servidor · ${serverInfo.timeZone}`;
    const result = await apiJson(`/api/cameras?${query({ server: id })}`);
    state.cameras = result.cameras || [];
    elements.cameraListEmpty.hidden = state.cameras.length > 0;
    elements.cameraListEmpty.textContent = state.cameras.length ? '' : 'O servidor não retornou câmeras disponíveis para esta conta.';
    drawCameraList();
    updateAudioSources();
    setConnection('connected', 'Conectado');
    const initial = Object.entries(serverInfo.initialCameras || {});
    for (const [cameraName, profile] of initial) {
      if (state.cameras.some(camera => camera.name === cameraName)) await openCamera(cameraName, profile);
    }
    if (initial.length && !state.tiles.size) toast('Os nomes de câmeras iniciais não correspondem a câmeras disponíveis neste servidor.', 'error');
    updateViewHeader();
  } catch (error) {
    setConnection('error', 'Falha na conexão');
    elements.cameraListEmpty.hidden = false;
    elements.cameraListEmpty.textContent = error.message;
    toast(error.message, 'error');
  }
}

function drawCameraList() {
  const filter = elements.cameraSearch.value.trim().toLocaleLowerCase('pt-BR');
  const visible = state.cameras.filter(camera => `${camera.name} ${camera.description}`.toLocaleLowerCase('pt-BR').includes(filter));
  elements.cameraList.replaceChildren();
  elements.cameraCount.textContent = String(state.tiles.size);
  elements.availableCount.textContent = String(state.cameras.length);
  for (const camera of visible) {
    const isOpen = state.tiles.has(camera.name);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `camera-row${isOpen ? ' is-open' : ''}`;
    button.setAttribute('aria-pressed', String(isOpen));
    button.setAttribute('aria-label', `Câmera ${camera.name}`);
    button.title = isOpen ? `Fechar câmera ${camera.name}` : `Abrir câmera ${camera.name}`;
    button.innerHTML = '<span class="camera-icon" aria-hidden="true"></span><span class="camera-meta"><span class="camera-name"></span><span class="camera-description"></span></span><span class="camera-add" aria-hidden="true"></span>';
    button.querySelector('.camera-name').textContent = camera.name;
    button.querySelector('.camera-description').textContent = camera.description || (camera.active ? 'Disponível' : 'Desativada');
    button.querySelector('.camera-add').textContent = isOpen ? '×' : '+';
    button.disabled = !camera.active;
    button.addEventListener('click', () => isOpen ? closeCamera(camera.name) : openCamera(camera.name));
    elements.cameraList.append(button);
  }
  if (state.cameras.length && !visible.length) {
    const empty = document.createElement('div');
    empty.className = 'rail-empty';
    empty.textContent = 'Nenhuma câmera corresponde à busca.';
    elements.cameraList.append(empty);
  }
}

function createTile(cameraName, profile) {
  const tile = document.createElement('article');
  tile.className = 'camera-tile';
  tile.dataset.camera = cameraName;
  tile.innerHTML = `
    <div class="tile-video" tabindex="0" role="button" aria-label="Focar câmera">
      <canvas class="tile-canvas"></canvas>
      <div class="tile-overlay">
        <div class="tile-topline"><span class="tile-camera-name"></span><span class="tile-state"><span class="tile-state-text">Conectando</span></span></div>
        <div class="tile-message" hidden></div>
        <div class="tile-bottomline"><span class="tile-timecode">--:--:--</span><span class="tile-codec"></span></div>
      </div>
    </div>
    <div class="tile-controls">
      <button class="tile-focus-button" type="button">Focar</button>
      <select class="tile-profile"><option value="Visualization">Visualização</option><option value="Recording">Gravação</option></select>
      <button class="tile-close-button" type="button">×</button>
    </div>`;
  tile.querySelector('.tile-camera-name').textContent = cameraName;
  tile.querySelector('.tile-video').setAttribute('aria-label', `Focar câmera ${cameraName}`);
  tile.querySelector('.tile-focus-button').setAttribute('aria-label', `Focar câmera ${cameraName}`);
  tile.querySelector('.tile-profile').setAttribute('aria-label', `Perfil da câmera ${cameraName}`);
  const closeButton = tile.querySelector('.tile-close-button');
  closeButton.setAttribute('aria-label', `Fechar câmera ${cameraName}`);
  closeButton.title = `Fechar câmera ${cameraName}`;
  tile.querySelector('.tile-profile').value = profile === 'Recording' ? 'Recording' : 'Visualization';
  tile.querySelector('.tile-video').addEventListener('click', () => focusCamera(cameraName));
  tile.querySelector('.tile-video').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusCamera(cameraName); }
  });
  tile.querySelector('.tile-focus-button').addEventListener('click', () => focusCamera(cameraName));
  tile.querySelector('.tile-close-button').addEventListener('click', () => closeCamera(cameraName));
  tile.querySelector('.tile-profile').addEventListener('change', event => {
    const player = state.tiles.get(cameraName);
    if (!player || state.mode !== 'live') return;
    player.profile = event.target.value;
    player.lastLiveProfile = player.profile;
    if (!state.allStopped) player.restart();
  });
  if (state.mode === 'playback') {
    tile.querySelector('.tile-profile').hidden = true;
    tile.querySelector('.tile-state').classList.add('review');
  }
  return tile;
}

async function openCamera(cameraName, initialProfile = 'Visualization') {
  if (!state.serverId || state.tiles.has(cameraName)) return;
  const camera = state.cameras.find(item => item.name === cameraName);
  if (!camera?.active) return toast('Esta câmera está desativada ou indisponível.', 'error');
  const profile = ['Visualization', 'Recording'].includes(initialProfile) ? initialProfile : 'Visualization';
  const tile = createTile(cameraName, profile);
  elements.emptyMonitor.hidden = true;
  elements.viewerGrid.classList.toggle('has-many', state.tiles.size >= 3);
  elements.viewerGrid.append(tile);
  const player = new CameraPlayer(cameraName, tile, profile);
  state.tiles.set(cameraName, player);
  elements.viewerGrid.classList.toggle('has-many', state.tiles.size >= 3);
  const resumeExisting = state.allStopped;
  state.allStopped = false;
  if (resumeExisting) for (const existing of state.tiles.values()) if (existing !== player) await existing.start();
  if (!state.focused) focusCamera(cameraName);
  if (!state.audioSource) state.audioSource = cameraName;
  updateAudioSources();
  drawCameraList();
  updateViewHeader();
  await player.start();
}

async function closeCamera(cameraName) {
  const player = state.tiles.get(cameraName);
  if (!player) return;
  player.stop();
  state.tiles.delete(cameraName);
  elements.viewerGrid.classList.toggle('has-many', state.tiles.size >= 3);
  player.tile.remove();
  if (state.focused === cameraName) state.focused = state.tiles.keys().next().value || '';
  if (state.audioSource === cameraName) state.audioSource = state.focused;
  if (!state.tiles.size) {
    elements.emptyMonitor.hidden = false;
    state.audioEnabled = false;
  }
  if (!state.tiles.size) state.allStopped = false;
  updateAudioSources();
  drawCameraList();
  updateViewHeader();
  if (state.mode === 'playback') loadTimeline().catch(() => {});
}

async function closeAllTiles() {
  for (const player of state.tiles.values()) player.stop();
  state.tiles.clear();
  elements.viewerGrid.querySelectorAll('.camera-tile').forEach(tile => tile.remove());
  elements.emptyMonitor.hidden = false;
  state.focused = '';
  state.audioSource = '';
  state.audioEnabled = false;
  state.allStopped = false;
  updateAudioSources();
  drawCameraList();
  updateViewHeader();
}

function focusCamera(cameraName) {
  if (!state.tiles.has(cameraName)) return;
  state.focused = cameraName;
  const oldSource = state.audioSource;
  state.audioSource = cameraName;
  for (const [name, player] of state.tiles) {
    player.tile.classList.toggle('is-focused', name === cameraName);
    player.tile.querySelector('.tile-focus-button').classList.toggle('is-audio', name === state.audioSource && state.audioEnabled);
  }
  updateAudioSources();
  updateViewHeader();
  if (state.audioEnabled && oldSource !== state.audioSource) audioSourceChanged(oldSource, state.audioSource);
  if (state.mode === 'playback' && state.timelineCamera !== cameraName) loadTimeline().catch(() => {});
}

function updateAudioSources() {
  const previous = elements.audioSource.value;
  elements.audioSource.replaceChildren();
  if (!state.tiles.size) {
    elements.audioSource.add(new Option('Nenhuma câmera aberta', ''));
    elements.audioSource.disabled = true;
    elements.audioToggle.disabled = true;
    elements.audioToggle.setAttribute('aria-pressed', 'false');
    elements.audioToggle.querySelector('span').textContent = 'Ativar áudio';
    return;
  }
  for (const name of state.tiles.keys()) elements.audioSource.add(new Option(name, name));
  elements.audioSource.value = [...state.tiles.keys()].includes(previous) ? previous : (state.audioSource || state.focused);
  state.audioSource = elements.audioSource.value;
  elements.audioSource.disabled = false;
  elements.audioToggle.disabled = false;
  elements.audioToggle.setAttribute('aria-pressed', String(state.audioEnabled));
  elements.audioToggle.querySelector('span').textContent = state.audioEnabled ? 'Áudio ativo' : 'Ativar áudio';
  for (const [name, player] of state.tiles) player.tile.querySelector('.tile-focus-button').classList.toggle('is-audio', name === state.audioSource && state.audioEnabled);
}

function updateViewHeader() {
  const count = state.tiles.size;
  elements.tileCount.textContent = `${count} ${count === 1 ? 'aberta' : 'abertas'}`;
  elements.cameraCount.textContent = String(count);
  elements.stopAll.disabled = count === 0;
  elements.stopAll.title = state.allStopped ? 'Retomar todas as câmeras' : 'Parar todas as câmeras';
  elements.stopAll.setAttribute('aria-label', state.allStopped ? 'Retomar todas as câmeras' : 'Parar todas as câmeras');
  elements.viewTitle.textContent = state.mode === 'live' ? 'Monitoramento ao vivo' : 'Revisão de gravações';
  elements.viewSubtitle.textContent = state.focused ? `${state.focused}${state.mode === 'live' ? ' · transmissão instantânea' : ' · horário sincronizado'}` : 'Escolha uma câmera para começar.';
  elements.focusedLabel.textContent = state.focused ? `Foco · ${state.focused}` : 'Nenhuma câmera em foco';
  elements.modeStatus.textContent = state.mode === 'live' ? 'Ao vivo' : 'Revisão gravada';
  elements.statusLiveDot.classList.toggle('review', state.mode === 'playback');
}

function setMode(mode) {
  if (state.mode === mode) return;
  state.mode = mode;
  state.allStopped = false;
  const wasPlayback = mode === 'playback';
  elements.liveMode.classList.toggle('is-active', !wasPlayback);
  elements.liveMode.setAttribute('aria-pressed', String(!wasPlayback));
  elements.reviewMode.classList.toggle('is-active', wasPlayback);
  elements.reviewMode.setAttribute('aria-pressed', String(wasPlayback));
  elements.reviewFields.hidden = !wasPlayback;
  elements.reviewPanel.hidden = !wasPlayback;
  elements.thumbnailPanel.hidden = !wasPlayback;
  if (wasPlayback) {
    setDefaultReviewTimes();
    for (const player of state.tiles.values()) {
      player.profile = 'Recording';
      player.tile.querySelector('.tile-profile').hidden = true;
      player.tile.querySelector('.tile-state').classList.add('review');
    }
  } else {
    elements.timelineStatus.textContent = 'Timeline disponível durante a revisão gravada.';
    for (const player of state.tiles.values()) {
      player.profile = player.lastLiveProfile || 'Visualization';
      const select = player.tile.querySelector('.tile-profile');
      select.hidden = false;
      select.value = player.profile;
      player.tile.querySelector('.tile-state').classList.remove('review');
    }
  }
  clearTimeline();
  for (const player of state.tiles.values()) player.restart();
  updateViewHeader();
}

function setDefaultReviewTimes() {
  if (!state.server) return;
  const now = Date.now() - 5 * 60 * 1000;
  elements.startDateTime.value = epochToInput(now, state.server.timeZone);
  elements.endDateTime.value = '';
}

function startReview() {
  if (!state.tiles.size) return toast('Abra pelo menos uma câmera antes de iniciar a revisão.', 'error');
  if (!elements.startDateTime.value) return toast('Informe data e hora de início.', 'error');
  try {
    state.reviewStart = inputToEpoch(elements.startDateTime.value, state.server.timeZone);
    state.reviewEnd = elements.endDateTime.value ? inputToEpoch(elements.endDateTime.value, state.server.timeZone) : null;
    if (state.reviewEnd && state.reviewEnd <= state.reviewStart) throw new Error('O fim precisa ser posterior ao início.');
    state.reviewEpoch = state.reviewStart;
  state.allStopped = false;
  } catch (error) {
    return toast(error.message || 'Confira o período selecionado.', 'error');
  }
  for (const player of state.tiles.values()) player.restart();
  loadTimeline().catch(error => { elements.timelineStatus.textContent = error.message; });
  renderThumbnailPage(0).catch(() => {});
}

function epochToApi(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}.${values.month}.${values.day}`, time: `${values.hour}.${values.minute}.${values.second}` };
}

function epochToInput(epoch, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const v = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day}T${v.hour}:${v.minute}:${v.second}`;
}

function inputToEpoch(input, timeZone) {
  const match = input.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.(\d{1,3}))?)?$/);
  if (!match) throw new Error('Informe uma data e hora válidas.');
  const [, year, month, day, hour, minute, second = '00', millis = '0'] = match;
  const millisecond = Number(millis.padEnd(3, '0'));
  const wanted = Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, millisecond);
  let epoch = wanted;
  for (let i = 0; i < 3; i += 1) {
    const localParts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
    const v = Object.fromEntries(localParts.map(part => [part.type, part.value]));
    const seen = Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second);
    epoch += wanted - seen;
  }
  const checked = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(epoch));
  const result = Object.fromEntries(checked.map(part => [part.type, part.value]));
  if (`${result.year}-${result.month}-${result.day}T${result.hour}:${result.minute}:${result.second}` !== `${year}-${month}-${day}T${hour}:${minute}:${second}`) {
    throw new Error('Esse horário não existe no fuso configurado.');
  }
  return epoch;
}

function parseFrameEpoch(headers) {
  const date = headers['dgf-framedate'];
  const time = headers['dgf-frametime'];
  if (!date || !time || !state.server) return null;
  const d = date.replaceAll('.', '-');
  const t = time.replaceAll('.', ':');
  const [whole, millis = '0'] = t.split(':').length === 4 ? [t.slice(0, t.lastIndexOf(':')), t.slice(t.lastIndexOf(':') + 1)] : [t, '0'];
  try { return inputToEpoch(`${d}T${whole}.${millis.padEnd(3, '0').slice(0, 3)}`, state.server.timeZone); } catch { return null; }
}

function parseApiTimestamp(value) {
  if (!value) return null;
  const normalized = value.replace(' ', 'T');
  if (/[zZ]|[+-]\d\d:\d\d$/.test(normalized)) {
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  try {
    const [date, time] = value.split(' ');
    const [year, month, day] = date.split('-');
    const [hour, minute, rest] = time.split(':');
    const [second, ms = '0'] = rest.split('.');
    return inputToEpoch(`${year}-${month}-${day}T${hour}:${minute}:${second}.${ms.padEnd(3, '0').slice(0, 3)}`, state.server.timeZone);
  } catch { return null; }
}

class CameraPlayer {
  constructor(name, tile, profile) {
    this.name = name;
    this.tile = tile;
    this.canvas = tile.querySelector('canvas');
    this.context = this.canvas.getContext('2d', { alpha: false });
    this.profile = profile;
    this.lastLiveProfile = profile;
    this.abortController = null;
    this.videoDecoder = null;
    this.audioDecoder = null;
    this.g726 = null;
    this.g726Config = null;
    this.g726DecodeChain = Promise.resolve();
    this.requestToken = 0;
    this.videoEpoch = null;
    this.audioEpoch = null;
    this.frameCount = 0;
    this.audioCount = 0;
    this.stopped = false;
  }

  async start() {
    this.stopped = false;
    const token = ++this.requestToken;
    this.abortController = new AbortController();
    const audio = state.audioEnabled && state.audioSource === this.name;
    const params = {
      server: state.serverId, camera: this.name, mode: state.mode,
      profile: state.mode === 'live' ? this.profile : undefined,
      audio: audio ? '1' : '0'
    };
    if (state.mode === 'playback') {
      if (!state.reviewStart) {
        this.setMessage('Informe o horário e selecione Reproduzir.');
        return;
      }
      const start = epochToApi(state.reviewStart, state.server.timeZone);
      const end = state.reviewEnd ? epochToApi(state.reviewEnd, state.server.timeZone) : null;
      Object.assign(params, { startDate: start.date, startTime: start.time, endDate: end?.date, endTime: end?.time });
    }
    this.setState(state.mode === 'live' ? 'Ao vivo' : 'Revisão');
    this.setMessage('Conectando ao stream…');
    try {
      const response = await fetch(`/api/stream?${query(params)}`, { signal: this.abortController.signal, cache: 'no-store' });
      if (token !== this.requestToken) return;
      if (!response.ok) {
        let message = 'Não foi possível abrir esta câmera.';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      this.setMessage('Recebendo mídia…');
      $('#codecStatus').textContent = 'Stream multipart ativo';
      void consumeMultipart(response, part => {
        if (!this.stopped && token === this.requestToken) this.consumePart(part);
      }).then(() => {
        if (!this.stopped && token === this.requestToken) this.setMessage('O servidor encerrou o stream.');
      }).catch(error => {
        if (error.name === 'AbortError' || this.stopped || token !== this.requestToken) return;
        this.setMessage(error.message || 'Erro ao receber stream.');
        this.setState('Erro');
        toast(`${this.name}: ${error.message || 'erro de stream.'}`, 'error');
      });
    } catch (error) {
      if (error.name === 'AbortError' || this.stopped || token !== this.requestToken) return;
      this.setMessage(error.message || 'Erro ao receber stream.');
      this.setState('Erro');
      toast(`${this.name}: ${error.message || 'erro de stream.'}`, 'error');
    }
  }

  async restart() {
    if (state.mode === 'live') this.lastLiveProfile = this.profile;
    this.stop(false);
    await this.start();
  }

  stop(clear = true) {
    this.stopped = true;
    this.requestToken += 1;
    this.abortController?.abort();
    this.abortController = null;
    try { this.videoDecoder?.close(); } catch {}
    try { this.audioDecoder?.close(); } catch {}
    try { this.g726?.free(); } catch {}
    this.videoDecoder = null;
    this.audioDecoder = null;
    this.g726 = null;
    this.g726Config = null;
    this.videoEpoch = null;
    this.audioEpoch = null;
    if (clear && this.context) this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setState(label) { this.tile.querySelector('.tile-state-text').textContent = label; }
  setMessage(message) {
    const node = this.tile.querySelector('.tile-message');
    node.textContent = message;
    node.hidden = !message;
  }

  consumePart(part) {
    const type = `${part.headers['dgf-frametype'] || ''} ${part.headers['content-type'] || ''}`.toLowerCase();
    const epoch = parseFrameEpoch(part.headers);
    if (epoch) this.tile.querySelector('.tile-timecode').textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: state.server.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(epoch);
    if (type.includes('jpeg') || part.headers['content-type']?.toLowerCase().includes('image/jpeg')) {
      this.drawJpeg(part.data);
      this.frameCount += 1;
      this.setMessage('');
      this.setState(state.mode === 'live' ? 'Ao vivo' : 'Revisão');
      return;
    }
    if (type.includes('h.264') || type.includes('h264') || part.headers['content-type']?.toLowerCase().includes('video/h264')) {
      this.decodeH264(part.data, type.includes('i-frame') || type.includes('iframe'), epoch);
      return;
    }
    if (type.includes('h.265') || type.includes('h265') || type.includes('hevc')) {
      this.setMessage('Este stream usa H.265, que exige perfil de codec compatível.');
      this.setState('Codec H.265');
      return;
    }
    if (/g\.?726/i.test(type)) {
      if (state.audioEnabled && state.audioSource === this.name) this.decodeG726(part.data, type, epoch, part.headers);
      return;
    }
    if (type.includes('audio/basic') || type.includes('audio/alaw') || type.includes('audio/mulaw') || type.includes('audio/ulaw')) {
      if (state.audioEnabled && state.audioSource === this.name) this.decodeWebAudio(part.data, type, epoch);
      return;
    }
    if (type.includes('audio/aac')) {
      if (state.audioEnabled && state.audioSource === this.name) this.decodeAac(part.data, epoch);
      return;
    }
    if (type.startsWith('audio/')) {
      this.setMessage(`Codec de áudio não suportado: ${part.headers['content-type'] || type}`);
      this.setState('Codec incompatível');
      return;
    }
    if (type.startsWith('video/')) {
      this.setMessage(`Codec de vídeo não suportado: ${part.headers['content-type'] || type}`);
      this.setState('Codec incompatível');
    }
  }

  async drawJpeg(data) {
    try {
      const bitmap = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
      if (this.stopped) { bitmap.close(); return; }
      this.canvas.width = bitmap.width;
      this.canvas.height = bitmap.height;
      this.context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);
      bitmap.close();
    } catch {
      this.setMessage('Não foi possível decodificar o quadro JPEG.');
    }
  }

  decodeH264(data, keyFrame, epoch) {
    if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') {
      this.setMessage('Este navegador não oferece WebCodecs de vídeo. Use uma versão atual do Chromium ou Edge.');
      this.setState('Navegador incompatível');
      return;
    }
    const bytes = normalizeAnnexB(data);
    const sps = findNal(bytes, 7);
    if (!this.videoDecoder && sps && sps.length >= 4) {
      const codec = `avc1.${[sps[1], sps[2], sps[3]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
      this.videoDecoder = new VideoDecoder({
        output: frame => {
          if (this.stopped) { frame.close(); return; }
          if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
          }
          this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
          frame.close();
          this.frameCount += 1;
          this.setMessage('');
          this.setState(state.mode === 'live' ? 'Ao vivo' : 'Revisão');
          this.tile.querySelector('.tile-codec').textContent = codec.toUpperCase();
          $('#codecStatus').textContent = `${codec.toUpperCase()} · ${this.frameCount} quadros`;
        },
        error: () => { this.setMessage('O navegador não conseguiu decodificar o perfil H.264 desta câmera.'); this.setState('Codec incompatível'); }
      });
      try { this.videoDecoder.configure({ codec, optimizeForLatency: true }); }
      catch { this.setMessage('Perfil H.264 indisponível neste navegador.'); this.setState('Codec incompatível'); return; }
    }
    if (!this.videoDecoder || this.videoDecoder.state !== 'configured') {
      if (!sps) this.setMessage('Aguardando quadro-chave com parâmetros H.264.');
      return;
    }
    const timestamp = this.mediaTimestamp(epoch, 'video');
    try {
      if (this.videoDecoder.decodeQueueSize < 14) this.videoDecoder.decode(new EncodedVideoChunk({ type: keyFrame ? 'key' : 'delta', timestamp, data: bytes }));
    } catch { this.setMessage('Quadro H.264 inválido recebido do stream.'); }
  }

  mediaTimestamp(epoch, kind) {
    if (epoch === null) return kind === 'video' ? (this.frameCount * 40000) : (this.audioCount * 20000);
    let base = kind === 'video' ? this.videoEpoch : this.audioEpoch;
    if (base === null) {
      base = state.mode === 'playback' && state.reviewStart ? state.reviewStart : epoch;
      if (kind === 'video') this.videoEpoch = base; else this.audioEpoch = base;
    }
    return Math.max(0, Math.round((epoch - base) * 1000));
  }

  async getAudioDecoder(codec, sampleRate, channels, description) {
    if (this.audioDecoder?.state === 'configured') return this.audioDecoder;
    if (typeof AudioDecoder !== 'function') throw new Error('Este navegador não oferece WebCodecs de áudio.');
    this.audioDecoder = new AudioDecoder({
      output: audioData => this.scheduleAudio(audioData),
      error: () => this.setMessage('O navegador não conseguiu decodificar o áudio recebido.')
    });
    const config = { codec, sampleRate, numberOfChannels: channels };
    if (description) config.description = description;
    const support = await AudioDecoder.isConfigSupported(config);
    if (!support.supported) { this.audioDecoder.close(); this.audioDecoder = null; throw new Error(`O navegador não suporta o áudio ${codec}.`); }
    this.audioDecoder.configure(config);
    return this.audioDecoder;
  }

  async decodeWebAudio(data, type, epoch) {
    const codec = type.includes('alaw') ? 'alaw' : 'ulaw';
    try {
      const decoder = await this.getAudioDecoder(codec, 8000, 1);
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.mediaTimestamp(epoch, 'audio'), data }));
      this.audioCount += 1;
    } catch (error) {
      this.setMessage(error.message || 'Áudio G.711 indisponível.');
    }
  }

  async decodeAac(data, epoch) {
    try {
      const parsed = parseAdts(data);
      const payload = parsed ? parsed.payload : data;
      const decoder = await this.getAudioDecoder('mp4a.40.2', parsed?.sampleRate || 48000, parsed?.channels || 2, parsed?.description);
      decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.mediaTimestamp(epoch, 'audio'), data: payload }));
      this.audioCount += 1;
    } catch (error) { this.setMessage(error.message || 'Áudio AAC indisponível.'); }
  }

  decodeG726(data, type, epoch, headers) {
    const bytes = data.slice();
    const token = this.requestToken;
    const config = getG726Config(headers, type);
    this.g726DecodeChain = this.g726DecodeChain.then(async () => {
      if (this.stopped || token !== this.requestToken || !state.audioEnabled || state.audioSource !== this.name) return;
      if (!config.rate) {
        this.setMessage('O frame G.726 não informa uma taxa reconhecida (16, 24, 32 ou 40 kb/s).');
        this.setState('Taxa G.726 desconhecida');
        return;
      }
      const Decoder = await loadG726Decoder();
      if (this.stopped || token !== this.requestToken || !state.audioEnabled || state.audioSource !== this.name) return;
      if (!this.g726 || this.g726Config?.rate !== config.rate || this.g726Config?.bitOrder !== config.bitOrder) {
        try { this.g726?.free(); } catch {}
        this.g726 = new Decoder(config.rate, config.bitOrder);
        this.g726Config = config;
      }
      const samples = this.g726.decode(bytes);
      const pcm = new Float32Array(samples.length);
      for (let index = 0; index < samples.length; index += 1) pcm[index] = samples[index] / 32768;
      this.schedulePcm(pcm, 8000, 1, this.mediaTimestamp(epoch, 'audio'));
      this.audioCount += 1;
      this.setMessage('');
      this.setState(state.mode === 'live' ? 'Ao vivo' : 'Revisão');
      this.tile.querySelector('.tile-codec').textContent = `G.726 ${config.rate} kb/s · ${config.bitOrder.toUpperCase()}${config.assumedBitOrder ? ' (RFC 3551)' : ''}`;
    }).catch(() => {
      if (this.stopped || token !== this.requestToken) return;
      this.setMessage('Não foi possível carregar ou decodificar o módulo G.726 local.');
      this.setState('Decoder G.726 indisponível');
    });
  }

  scheduleAudio(audioData) {
    try {
      const channels = audioData.numberOfChannels;
      const frames = audioData.numberOfFrames;
      const pcm = new Float32Array(frames * channels);
      for (let channel = 0; channel < channels; channel += 1) {
        const plane = new Float32Array(frames);
        audioData.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
        for (let index = 0; index < frames; index += 1) pcm[index * channels + channel] = plane[index];
      }
      this.schedulePcm(pcm, audioData.sampleRate, channels, audioData.timestamp);
    } catch {} finally { audioData.close(); }
  }

  schedulePcm(pcm, sampleRate, channels, timestampUs) {
    if (!state.audioContext || !state.audioEnabled || state.audioSource !== this.name) return;
    try {
      const ctx = state.audioContext;
      const frames = Math.floor(pcm.length / channels);
      if (!frames) return;
      const buffer = ctx.createBuffer(channels, frames, sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const plane = buffer.getChannelData(channel);
        for (let index = 0; index < frames; index += 1) plane[index] = pcm[index * channels + channel] ?? 0;
      }
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      const relativeSeconds = typeof timestampUs === 'number' ? Math.max(0, timestampUs / 1e6) : 0;
      const startAt = Math.max(ctx.currentTime + 0.02, (state.audioContextStart || ctx.currentTime) + relativeSeconds);
      source.start(startAt);
    } catch {}
  }
}

function findNal(bytes, wantedType) {
  for (let i = 0; i + 4 < bytes.length; i += 1) {
    let start = -1;
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) start = i + 3;
    else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) start = i + 4;
    if (start < 0 || start >= bytes.length) continue;
    if ((bytes[start] & 0x1f) !== wantedType) continue;
    let end = bytes.length;
    for (let j = start + 1; j + 3 < bytes.length; j += 1) {
      if (bytes[j] === 0 && bytes[j + 1] === 0 && (bytes[j + 2] === 1 || (bytes[j + 2] === 0 && bytes[j + 3] === 1))) { end = j; break; }
    }
    return bytes.subarray(start, end);
  }
  return null;
}

function normalizeAnnexB(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  for (let i = 0; i + 3 < bytes.length; i += 1) if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))) return bytes;
  const prefix = new Uint8Array([0, 0, 0, 1]);
  const normalized = new Uint8Array(prefix.length + bytes.length);
  normalized.set(prefix); normalized.set(bytes, prefix.length);
  return normalized;
}

function parseAdts(data) {
  if (data.length < 7 || data[0] !== 0xff || (data[1] & 0xf6) !== 0xf0) return null;
  const profile = (data[2] >> 6) & 3;
  const frequencyIndex = (data[2] >> 2) & 15;
  const frequencies = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const sampleRate = frequencies[frequencyIndex];
  const channels = ((data[2] & 1) << 2) | ((data[3] >> 6) & 3);
  const headerLength = (data[1] & 1) ? 7 : 9;
  if (!sampleRate || !channels || data.length <= headerLength) return null;
  const asc = ((profile + 1) << 11) | (frequencyIndex << 7) | (channels << 3);
  return { sampleRate, channels, description: new Uint8Array([asc >> 8, asc & 255]), payload: data.subarray(headerLength) };
}

async function consumeMultipart(response, onPart) {
  const contentType = response.headers.get('content-type') || '';
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const name = (match?.[1] || match?.[2] || '--DigifortBoundary').replace(/^--/, '');
  const boundaries = [`--${name}`, `----${name}`].map(value => new TextEncoder().encode(value));
  const reader = response.body.getReader();
  let buffer = new Uint8Array(0);
  let done = false;
  const concat = (left, right) => { const out = new Uint8Array(left.length + right.length); out.set(left); out.set(right, left.length); return out; };
  const indexOf = (haystack, needle, from = 0) => {
    outer: for (let i = from; i <= haystack.length - needle.length; i += 1) {
      for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  };
  const findBoundary = (from = 0) => {
    const found = boundaries.map(bytes => ({ index: indexOf(buffer, bytes, from), bytes })).filter(x => x.index >= 0).sort((a, b) => a.index - b.index);
    return found[0] || null;
  };
  const readMore = async () => {
    const result = await reader.read();
    if (result.done) { done = true; return; }
    buffer = concat(buffer, result.value);
  };
  const readUntil = async needle => {
    let index;
    while ((index = indexOf(buffer, needle)) < 0 && !done) await readMore();
    return index;
  };
  while (!done || buffer.length) {
    let boundary = findBoundary();
    while (!boundary && !done) { await readMore(); boundary = findBoundary(); }
    if (!boundary) break;
    buffer = buffer.subarray(boundary.index + boundary.bytes.length);
    while (buffer.length < 2 && !done) await readMore();
    if (buffer[0] === 45 && buffer[1] === 45) break;
    if (buffer[0] === 13 && buffer[1] === 10) buffer = buffer.subarray(2);
    const separator = new Uint8Array([13, 10, 13, 10]);
    const headerEnd = await readUntil(separator);
    if (headerEnd < 0) break;
    const rawHeaders = new TextDecoder().decode(buffer.subarray(0, headerEnd));
    buffer = buffer.subarray(headerEnd + separator.length);
    const headers = {};
    for (const line of rawHeaders.split(/\r?\n/)) {
      const split = line.indexOf(':');
      if (split > 0) headers[line.slice(0, split).trim().toLowerCase()] = line.slice(split + 1).trim();
    }
    const length = Number(headers['content-length']);
    if (!Number.isFinite(length) || length < 0 || length > 25_000_000) throw new Error('Frame multipart com tamanho inválido.');
    while (buffer.length < length && !done) await readMore();
    if (buffer.length < length) break;
    const data = buffer.slice(0, length);
    buffer = buffer.subarray(length);
    if (buffer[0] === 13 && buffer[1] === 10) buffer = buffer.subarray(2);
    onPart({ headers, data });
  }
}

async function audioSourceChanged(oldSource, newSource) {
  if (state.allStopped) return;
  if (oldSource && state.tiles.has(oldSource)) await state.tiles.get(oldSource).restart();
  if (newSource && newSource !== oldSource && state.tiles.has(newSource)) await state.tiles.get(newSource).restart();
}

function clearTimeline() {
  state.timeline = [];
  state.timelineCamera = '';
  state.timelineStart = null;
  state.timelineEnd = null;
  elements.videoLane.replaceChildren();
  elements.audioLane.replaceChildren();
  elements.timelineRuler.replaceChildren();
}

function parseTimelinePart(part) {
  const text = new TextDecoder().decode(part.data);
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const split = line.indexOf('=');
    if (split > 0) values[line.slice(0, split).trim().toUpperCase()] = line.slice(split + 1).trim();
  }
  if (!values.TIMELINEDATA_MEDIAKIND) return null;
  return {
    kind: values.TIMELINEDATA_MEDIAKIND.toLowerCase(),
    type: (values.TIMELINEDATA_FRAMETYPE || values.TIMELINEDATA_FRAMEKIND || '').toLowerCase(),
    start: parseApiTimestamp(values.TIMELINEDATA_STARTTIME),
    end: parseApiTimestamp(values.TIMELINEDATA_ENDTIME)
  };
}

async function loadTimeline() {
  if (state.mode !== 'playback' || !state.server || !state.tiles.size || !state.reviewStart) return;
  const camera = state.focused || state.tiles.keys().next().value;
  if (!camera) return;
  state.timelineCamera = camera;
  elements.timelineCameraLabel.textContent = camera;
  elements.timelineStatus.textContent = 'Carregando disponibilidade de gravações…';
  const start = epochToApi(state.reviewStart, state.server.timeZone);
  const end = state.reviewEnd ? epochToApi(state.reviewEnd, state.server.timeZone) : epochToApi(Date.now(), state.server.timeZone);
  const response = await fetch(`/api/timeline?${query({ server: state.serverId, camera, startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time })}`, { cache: 'no-store' });
  if (!response.ok) {
    let message = 'Não foi possível carregar a timeline.';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  const data = [];
  await consumeMultipart(response, part => {
    const parsed = parseTimelinePart(part);
    if (parsed && Number.isFinite(parsed.start) && Number.isFinite(parsed.end)) data.push(parsed);
  });
  state.timeline = data;
  state.timelineStart = state.reviewStart;
  state.timelineEnd = state.reviewEnd || Date.now();
  drawTimeline();
  elements.timelineStatus.textContent = data.length ? `${data.filter(item => item.kind === 'video').length} intervalos de vídeo · ${data.filter(item => item.kind === 'audio').length} intervalos de áudio` : 'Nenhuma gravação encontrada neste período.';
}

function drawTimeline() {
  const start = state.timelineStart;
  const end = state.timelineEnd;
  if (!start || !end || end <= start) return;
  elements.videoLane.replaceChildren();
  elements.audioLane.replaceChildren();
  elements.timelineRuler.replaceChildren();
  const span = end - start;
  for (let tick = 0; tick <= 4; tick += 1) {
    const epoch = start + span * tick / 4;
    const mark = document.createElement('span');
    mark.className = 'ruler-tick';
    mark.style.left = `${tick * 25}%`;
    mark.textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: state.server.timeZone, hour: '2-digit', minute: '2-digit' }).format(epoch);
    elements.timelineRuler.append(mark);
  }
  for (const item of state.timeline) {
    const lane = item.kind === 'audio' ? elements.audioLane : item.kind === 'video' ? elements.videoLane : null;
    if (!lane) continue;
    const segment = document.createElement('span');
    segment.className = `track-segment${item.kind === 'audio' ? ' audio' : ''}`;
    const left = Math.max(0, (item.start - start) / span * 100);
    const right = Math.min(100, (item.end - start) / span * 100);
    segment.style.left = `${left}%`;
    segment.style.width = `${Math.max(.3, right - left)}%`;
    segment.title = `${item.kind === 'audio' ? 'Áudio' : 'Vídeo'} · ${formatClock(item.start)}–${formatClock(item.end)}`;
    lane.append(segment);
  }
  for (const lane of [elements.videoLane, elements.audioLane]) lane.onclick = event => seekFromTimeline(event, lane);
}

function seekFromTimeline(event, lane) {
  const rect = lane.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const epoch = state.timelineStart + (state.timelineEnd - state.timelineStart) * percent;
  elements.startDateTime.value = epochToInput(epoch, state.server.timeZone);
  startReview();
}

function formatClock(epoch) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: state.server?.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(epoch);
}

async function toggleAllStreams() {
  if (!state.tiles.size) return;
  if (!state.allStopped) {
    for (const player of state.tiles.values()) {
      player.stop();
      player.setState('Parado');
      player.setMessage('Transmissão parada. Use o botão superior para retomar.');
    }
    state.allStopped = true;
  } else {
    state.allStopped = false;
    for (const player of state.tiles.values()) await player.start();
  }
  updateViewHeader();
}

function clearThumbnails() {
  for (const url of state.thumbnailObjectUrls) URL.revokeObjectURL(url);
  state.thumbnailObjectUrls = [];
  state.thumbnails = [];
  elements.thumbnailGrid.replaceChildren();
}

function getThumbnailInterval() {
  if (elements.thumbnailInterval.value === 'custom') return Math.max(1, Number(elements.customInterval.value) || 120);
  return Number(elements.thumbnailInterval.value) || 300;
}

async function renderThumbnailPage(page) {
  if (!state.server || !state.reviewStart || !state.tiles.size) return;
  const camera = state.focused || state.tiles.keys().next().value;
  const end = state.reviewEnd || Date.now();
  const interval = getThumbnailInterval() * 1000;
  if (end <= state.reviewStart) return;
  const total = Math.floor((end - state.reviewStart) / interval) + 1;
  const pages = Math.max(1, Math.ceil(total / 24));
  state.thumbnailPage = Math.max(0, Math.min(page, pages - 1));
  const offset = state.thumbnailPage * 24;
  const pageItems = Array.from({ length: Math.min(24, total - offset) }, (_, index) => state.reviewStart + (offset + index) * interval);
  clearThumbnails();
  state.thumbnails = pageItems;
  elements.thumbnailPageLabel.textContent = `Página ${state.thumbnailPage + 1} / ${pages}`;
  elements.thumbnailPrev.disabled = state.thumbnailPage === 0;
  elements.thumbnailNext.disabled = state.thumbnailPage >= pages - 1;
  elements.thumbnailStatus.textContent = `Carregando até ${pageItems.length} miniaturas de ${camera}…`;
  const cards = pageItems.map(epoch => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'thumbnail-card';
    const image = document.createElement('img');
    image.alt = `Quadro de ${camera} às ${formatClock(epoch)}`;
    const label = document.createElement('span');
    label.textContent = formatClock(epoch);
    card.append(image, label);
    card.addEventListener('click', () => { elements.startDateTime.value = epochToInput(epoch, state.server.timeZone); startReview(); });
    elements.thumbnailGrid.append(card);
    return { epoch, image };
  });
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, cards.length) }, async () => {
    while (cursor < cards.length) {
      const item = cards[cursor++];
      const api = epochToApi(item.epoch, state.server.timeZone);
      try {
        const response = await fetch(`/api/snapshot?${query({ server: state.serverId, camera, date: api.date, time: api.time })}`, { cache: 'no-store' });
        if (!response.ok) continue;
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        state.thumbnailObjectUrls.push(objectUrl);
        item.image.src = objectUrl;
      } catch {}
    }
  });
  await Promise.all(workers);
  elements.thumbnailStatus.textContent = cards.some(card => card.image.src) ? `${cards.length} pontos nesta página · clique em uma miniatura para revisar daquele instante.` : 'Nenhuma miniatura encontrada nesta página.';
}

function clockTick() {
  const now = new Date();
  $('#clockTime').textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
  $('#clockDate').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now);
}

elements.serverSelect.addEventListener('change', event => selectServer(event.target.value));
elements.cameraSearch.addEventListener('input', drawCameraList);
elements.liveMode.addEventListener('click', () => setMode('live'));
elements.reviewMode.addEventListener('click', () => setMode('playback'));
elements.playReview.addEventListener('click', startReview);
elements.stopAll.addEventListener('click', toggleAllStreams);
elements.audioSource.addEventListener('change', async event => {
  const old = state.audioSource;
  state.audioSource = event.target.value;
  if (state.audioEnabled && old !== state.audioSource) await audioSourceChanged(old, state.audioSource);
  updateAudioSources();
});
elements.audioToggle.addEventListener('click', async () => {
  if (!state.audioContext) state.audioContext = new AudioContext();
  try { await state.audioContext.resume(); } catch {}
  state.audioContextStart = state.audioContext.currentTime + 0.08;
  state.audioEnabled = !state.audioEnabled;
  updateAudioSources();
  const source = state.audioSource || state.focused;
  if (!state.allStopped && source && state.tiles.has(source)) await state.tiles.get(source).restart();
});
elements.thumbnailInterval.addEventListener('change', () => {
  elements.customInterval.hidden = elements.thumbnailInterval.value !== 'custom';
  if (state.mode === 'playback' && state.reviewStart) renderThumbnailPage(0).catch(() => {});
});
elements.customInterval.addEventListener('change', () => renderThumbnailPage(0).catch(() => {}));
elements.thumbnailPrev.addEventListener('click', () => renderThumbnailPage(state.thumbnailPage - 1).catch(() => {}));
elements.thumbnailNext.addEventListener('click', () => renderThumbnailPage(state.thumbnailPage + 1).catch(() => {}));
document.addEventListener('keydown', event => {
  if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) { event.preventDefault(); elements.cameraSearch.focus(); }
  if (event.key === 'Escape' && document.activeElement === elements.cameraSearch) { elements.cameraSearch.value = ''; drawCameraList(); elements.cameraSearch.blur(); }
});

clockTick();
window.setInterval(clockTick, 1000);
initializeServers();
