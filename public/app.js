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
  servers: [], serverId: '', server: null, cameras: [], tiles: new Map(), desktopWindow: false,
  cameraStatuses: new Map(), statusTimer: null, statusRequestId: 0, statusRefreshing: false,
  mode: 'live', focused: '', audioEnabled: false,
  allStopped: false, mosaic: 'auto', overlaysVisible: false, timelineVisible: true, surveillance: false,
  audioContext: null, reviewEpoch: null, reviewStart: null, reviewEnd: null, reviewLimitEnd: null,
  timelineStart: null, timelineEnd: null,
  timelineRequestId: 0, timelineData: new Map(), timelineZoom: 1, timelineControllers: [], recordings: new Map(), recordingSession: null,
  pendingRecordingScope: null,
  thumbnailPage: 0, thumbnailSize: 'large', thumbnailInterval: 300, thumbnailCamera: '', thumbnailAnchor: null, thumbnailActive: false, thumbnailWasStopped: false, thumbnails: [], thumbnailCache: new Map(), thumbnailRequestId: 0, thumbnailControllers: new Set()
};

const elements = {
  serverSelect: $('#serverSelect'), connectionState: $('#connectionState'), connectionLabel: $('#connectionLabel'),
  cameraSearch: $('#cameraSearch'), cameraList: $('#cameraList'), cameraListEmpty: $('#cameraListEmpty'),
  cameraCount: $('#cameraCount'), availableCount: $('#availableCount'),
  liveMode: $('#liveMode'), reviewMode: $('#reviewMode'), reviewFields: $('#reviewFields'),
  startDateTime: $('#startDateTime'), endDateTime: $('#endDateTime'), playReview: $('#playReview'),
  audioSource: $('#audioSource'), audioToggle: $('#audioToggle'), viewerGrid: $('#viewerGrid'), emptyMonitor: $('#emptyMonitor'),
  viewSubtitle: $('#viewSubtitle'), stopAll: $('#stopAll'),
  reviewPanel: $('#reviewPanel'), timelineRuler: $('#timelineRuler'), timelineTracks: $('#timelineTracks'), timelineNames: $('#timelineNames'), timelineScroll: $('#timelineScroll'), timelineContent: $('#timelineContent'), timelineDays: $('#timelineDays'),
  timelinePlayhead: $('#timelinePlayhead'), timelineStatus: $('#timelineStatus'),
  thumbnailPanel: $('#thumbnailPanel'), thumbnailGrid: $('#thumbnailGrid'), thumbnailStatus: $('#thumbnailStatus'),
  thumbnailPrev: $('#thumbnailPrev'),
  mosaicSelect: $('#mosaicSelect'), resetGrid: $('#resetGrid'), mosaicPreview: $('#mosaicPreview'), overlayToggle: $('#overlayToggle'), displayControl: $('#displayControl'), displayMenuToggle: $('#displayMenuToggle'), displayMenu: $('#displayMenu'),
  toggleOverlayVisibility: $('#toggleOverlayVisibility'), toggleTimelineVisibility: $('#toggleTimelineVisibility'),
  surveillanceToggle: $('#surveillanceToggle'), contextMenu: $('#contextMenu'),
  thumbnailNext: $('#thumbnailNext'),
  recordDialog: $('#recordDialog'), recordForm: $('#recordForm'), recordFormat: $('#recordFormat'), recordFormatHelp: $('#recordFormatHelp'), recordConfirm: $('#recordConfirm'),
  configDialog: $('#configDialog'), configDialogMessage: $('#configDialogMessage'), closeConfigApp: $('#closeConfigApp'),
  toastRegion: $('#toastRegion')
};

// The current thumbnail grid starts at 150px wide; request half, current, and double size.
const THUMBNAIL_SIZES = { small: [75, 51], medium: [150, 102], large: [300, 205] };
const MOSAICS = [
  { id: 'auto', name: 'Grade automática', columns: 0, capacity: Infinity, previewCapacity: 8 },
  { id: '3x3-six', name: '3 × 3 · 6 câmeras', columns: 3, capacity: 6, slots: [[1,1,2,2],[1,3,1,1],[2,3,1,1],[3,1,1,1],[3,2,1,1],[3,3,1,1]] },
  { id: '4x4-eight', name: '4 × 4 · 8 câmeras', columns: 4, capacity: 8, slots: [[1,1,3,3],[1,4,1,1],[2,4,1,1],[3,4,1,1],[4,1,1,1],[4,2,1,1],[4,3,1,1],[4,4,1,1]] },
  { id: '4x4-ten', name: '4 × 4 · 10 câmeras', columns: 4, capacity: 10, slots: [[1,1,2,2],[1,3,2,2],[3,1,1,1],[3,2,1,1],[3,3,1,1],[3,4,1,1],[4,1,1,1],[4,2,1,1],[4,3,1,1],[4,4,1,1]] },
  { id: '4x4-thirteen-a', name: '4 × 4 · 13 câmeras A', columns: 4, capacity: 13, slots: [[1,1,2,2],[1,3,1,1],[1,4,1,1],[2,3,1,1],[2,4,1,1],[3,1,1,1],[3,2,1,1],[3,3,1,1],[3,4,1,1],[4,1,1,1],[4,2,1,1],[4,3,1,1],[4,4,1,1]] },
  { id: '4x4-thirteen-b', name: '4 × 4 · 13 câmeras B', columns: 4, capacity: 13, slots: [[1,2,2,2],[1,1,1,1],[1,4,1,1],[2,1,1,1],[2,4,1,1],[3,1,1,1],[3,2,1,1],[3,3,1,1],[3,4,1,1],[4,1,1,1],[4,2,1,1],[4,3,1,1],[4,4,1,1]] },
  { id: '4x4-center', name: '4 × 4 · 13 câmeras C', columns: 4, capacity: 13, slots: [[2,2,2,2],[1,1,1,1],[1,2,1,1],[1,3,1,1],[1,4,1,1],[2,1,1,1],[2,4,1,1],[3,1,1,1],[3,4,1,1],[4,1,1,1],[4,2,1,1],[4,3,1,1],[4,4,1,1]] }
];

function getMosaic(id = state.mosaic) { return MOSAICS.find(item => item.id === id) || MOSAICS[0]; }

function mosaicAllowed(mosaic) { return mosaic.id === 'auto' || !state.server?.maxCams || mosaic.capacity <= state.server.maxCams; }
function cameraCapacity() { return Math.min(getMosaic().capacity, state.server?.maxCams || Infinity); }

function setupMosaics(initial = 'auto') {
  elements.mosaicSelect.replaceChildren(...MOSAICS.map((item, index) => {
    const option = new Option(item.name, item.id);
    option.disabled = !mosaicAllowed(item);
    option.title = `Ctrl+Alt+${index ? index % 10 : 'A'}`;
    return option;
  }));
  state.mosaic = MOSAICS.some(item => item.id === initial && mosaicAllowed(item)) ? initial : 'auto';
  elements.mosaicSelect.value = state.mosaic;
  applyMosaic();
}

function applyMosaic() {
  const grid = elements.viewerGrid;
  const mosaic = getMosaic();
  const cameraCount = grid.querySelectorAll('.camera-tile').length;
  const autoColumns = Math.ceil(Math.sqrt(Math.max(cameraCount, 1)));
  const autoRows = Math.ceil(Math.max(cameraCount, 1) / autoColumns);
  grid.dataset.mosaic = mosaic.id;
  grid.style.setProperty('--mosaic-columns', mosaic.columns || autoColumns);
  grid.style.setProperty('--mosaic-rows', mosaic.columns || autoRows);
  drawMosaicPreview(mosaic);
  grid.querySelectorAll('.camera-tile').forEach((tile, index) => {
    const slot = mosaic.slots?.[index];
    tile.style.gridArea = slot ? `${slot[0]} / ${slot[1]} / span ${slot[2]} / span ${slot[3]}` : '';
  });
  drawCameraList();
}

function drawMosaicPreview(mosaic) {
  const size = mosaic.columns || 3;
  const previewCapacity = mosaic.previewCapacity ?? mosaic.capacity;
  elements.mosaicPreview.replaceChildren();
  elements.mosaicPreview.style.setProperty('--preview-columns', size);
  elements.mosaicPreview.style.setProperty('--preview-rows', mosaic.columns || 3);
  for (let index = 0; index < Math.min(previewCapacity, 25); index += 1) {
    const cell = document.createElement('i');
    cell.style.gridArea = mosaic.slots?.[index] ? `${mosaic.slots[index][0]} / ${mosaic.slots[index][1]} / span ${mosaic.slots[index][2]} / span ${mosaic.slots[index][3]}` : '';
    elements.mosaicPreview.append(cell);
  }
}

function setDisplayMenuLabel(item, label, shortcut) {
  const hint = document.createElement('span');
  hint.className = 'context-shortcut'; hint.textContent = shortcut;
  item.setAttribute('aria-keyshortcuts', shortcut);
  item.replaceChildren(document.createTextNode(label), hint);
}

function updateOverlayState() {
  elements.viewerGrid.classList.toggle('overlays-hidden', !state.overlaysVisible);
  elements.reviewPanel.hidden = state.mode !== 'playback' || !state.timelineVisible || state.thumbnailActive;
  elements.thumbnailPanel.hidden = !state.thumbnailActive;
  const allVisible = state.overlaysVisible && state.timelineVisible;
  elements.overlayToggle.setAttribute('aria-pressed', String(allVisible));
  elements.overlayToggle.textContent = allVisible ? 'Ocultar tudo' : 'Mostrar tudo';
  elements.toggleOverlayVisibility.setAttribute('aria-checked', String(state.overlaysVisible));
  setDisplayMenuLabel(elements.toggleOverlayVisibility, 'Mostrar dados', 'D');
  elements.toggleTimelineVisibility.setAttribute('aria-checked', String(state.timelineVisible));
  setDisplayMenuLabel(elements.toggleTimelineVisibility, 'Mostrar timeline', 'T');
  if (state.mode === 'playback' && state.reviewStart && state.timelineVisible) drawTimeline();
}

function setDisplayVisibility({ overlays = state.overlaysVisible, timeline = state.timelineVisible } = {}) {
  const wasTimelineVisible = state.timelineVisible;
  state.overlaysVisible = overlays;
  state.timelineVisible = timeline;
  if (wasTimelineVisible && !timeline) {
    clearTimeline();
    elements.timelineStatus.textContent = 'Timeline ocultada.';
  }
  updateOverlayState();
  if (state.mode === 'playback' && state.reviewStart) {
    if (!wasTimelineVisible && timeline) loadFocusedTimeline(state.focused);
  }
}

function closeDisplayMenu(restoreFocus = false) {
  elements.displayMenu.hidden = true;
  elements.displayMenuToggle.setAttribute('aria-expanded', 'false');
  if (restoreFocus) elements.displayMenuToggle.focus();
}

function openDisplayMenu() {
  elements.displayMenu.hidden = false;
  elements.displayMenuToggle.setAttribute('aria-expanded', 'true');
  elements.displayMenu.querySelector('[role="menuitemcheckbox"]')?.focus();
}

function reorderTiles() {
  const ordered = [...elements.viewerGrid.querySelectorAll('.camera-tile')].map(tile => [tile.dataset.camera, state.tiles.get(tile.dataset.camera)]).filter(([, player]) => player);
  state.tiles = new Map(ordered);
  state.timelineData = new Map(ordered.filter(([camera]) => state.timelineData.has(camera)).map(([camera]) => [camera, state.timelineData.get(camera)]));
  if (state.mode === 'playback' && state.timelineVisible && state.timelineStart) drawTimeline();
  applyMosaic();
  updateAudioSources();
}

function updateSurveillance() {
  document.body.classList.toggle('is-surveillance', state.surveillance);
  elements.surveillanceToggle.setAttribute('aria-pressed', String(state.surveillance));
  const surveillanceAction = state.surveillance ? 'Sair do modo vigilância' : 'Ativar modo vigilância';
  elements.surveillanceToggle.setAttribute('aria-label', surveillanceAction);
  elements.surveillanceToggle.title = `${surveillanceAction} · V`;
}

const PLAYBACK_SHORTCUTS = [
  ['30 segundos atrás', 30], ['1 minuto atrás', 60], ['30 minutos atrás', 1800],
  null, ['1 hora atrás', 3600], ['6 horas atrás', 21600], ['12 horas atrás', 43200], null,
  ['1 dia atrás', 86400], ['2 dias atrás', 172800], ['3 dias atrás', 259200], null,
  ['1 semana atrás', 604800], null, ['Personalizado', null]
];

function createPlaybackMenu(scope) {
  const menu = document.createElement('div');
  menu.className = 'context-submenu';
  menu.setAttribute('role', 'menu');
  appendPlaybackShortcuts(menu, scope);
  return menu;
}

function appendPlaybackShortcuts(menu, scope) {
  for (const entry of PLAYBACK_SHORTCUTS) {
    if (!entry) { const separator = document.createElement('div'); separator.className = 'context-separator'; separator.setAttribute('role', 'separator'); menu.append(separator); continue; }
    const [label, seconds] = entry;
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'context-item'; item.setAttribute('role', 'menuitem'); item.textContent = label;
    const index = PLAYBACK_SHORTCUTS.filter(entry => entry && entry[1] !== null).findIndex(entry => entry[1] === seconds);
    if (index >= 0) {
      const hint = document.createElement('span'); hint.className = 'context-shortcut';
      hint.textContent = `Ctrl+${scope.all ? 'Shift+' : ''}${(index + 1) % 10}`;
      item.append(hint);
    }
    item.addEventListener('click', () => { void beginContextPlayback(scope, seconds); closeContextMenu(); });
    menu.append(item);
  }
}

function createCaptureMenu(scope) {
  const menu = document.createElement('div');
  menu.className = 'context-submenu';
  menu.setAttribute('role', 'menu');
  const capture = document.createElement('button');
  capture.type = 'button'; capture.className = 'context-item'; capture.setAttribute('role', 'menuitem');
  capture.textContent = 'Frame';
  if (scope.all || scope.camera === state.focused) {
    const hint = document.createElement('span'); hint.className = 'context-shortcut';
    hint.textContent = scope.all ? 'Ctrl+Shift+PrintScreen' : 'Ctrl+PrintScreen';
    capture.append(hint);
  }
  capture.disabled = !(scope.all ? state.tiles.size : state.tiles.has(scope.camera));
  capture.addEventListener('click', () => { void captureFrames(scope); closeContextMenu(); });
  menu.append(capture);
  appendRecordingActions(menu, scope);
  return menu;
}

function contextSeparator() {
  const separator = document.createElement('div');
  separator.className = 'context-separator'; separator.setAttribute('role', 'separator');
  return separator;
}

function createCameraScopeMenu(scope, { includeCapture = true } = {}) {
  const menu = document.createElement('div');
  menu.className = 'context-submenu context-scope-menu';
  menu.setAttribute('role', 'menu');
  const cameraOpen = !scope.all && state.tiles.has(scope.camera);
  if (cameraOpen) {
    const focus = document.createElement('button');
    focus.type = 'button'; focus.className = 'context-item context-check-item'; focus.setAttribute('role', 'menuitemcheckbox');
    focus.setAttribute('aria-checked', String(state.focused === scope.camera)); focus.textContent = 'Em foco';
    focus.addEventListener('click', () => { focusCamera(scope.camera); closeContextMenu(); });
    menu.append(focus);
    if (state.mode === 'live') {
      menu.append(contextSeparator());
      appendProfileItems(menu, scope.camera);
    }
    menu.append(contextSeparator());
  }
  menu.append(createContextBranch('Gravado', () => createPlaybackMenu(scope)));
  if (cameraOpen && state.mode === 'playback') menu.append(createContextBranch('Miniaturas', () => createThumbnailMenu(scope.camera)));
  if (includeCapture) menu.append(createContextBranch('Captura', () => createCaptureMenu(scope)));
  if (cameraOpen) {
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'context-item'; close.setAttribute('role', 'menuitem'); close.textContent = 'Fechar câmera';
    close.addEventListener('click', () => { closeContextMenu(); void closeCamera(scope.camera); });
    menu.append(contextSeparator(), close);
  }
  return menu;
}

function appendProfileItems(menu, cameraName) {
  for (const [profile, label] of [['Visualization', 'Visualização'], ['Recording', 'Gravação']]) {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'context-item thumbnail-size-item'; item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', String(state.tiles.get(cameraName)?.profile === profile)); item.textContent = label;
    item.addEventListener('click', () => {
      const player = state.tiles.get(cameraName);
      if (player && state.mode === 'live' && player.profile !== profile) {
        player.profile = profile; player.lastLiveProfile = profile;
        if (!state.allStopped) player.restart();
      }
      closeContextMenu();
    });
    menu.append(item);
  }
}

function scopedCameraNames(scope) { return scope.all ? [...state.tiles.keys()] : [scope.camera].filter(name => state.tiles.has(name)); }

function appendRecordingActions(menu, scope) {
  const names = scopedCameraNames(scope);
  const session = state.recordingSession;
  const belongsToSession = session?.key === recordingScopeKey(scope);
  const active = session ? session.cameras.map(name => state.recordings.get(name)).filter(Boolean) : [];
  const actions = session ? [
    ['start', 'Iniciar gravação', true],
    ['pause', 'Pausar gravação', !belongsToSession || session.status === 'starting' || !active.some(recording => recording.status === 'recording')],
    ['resume', 'Retomar gravação', !belongsToSession || !active.some(recording => recording.status === 'paused')],
    ['stop', 'Finalizar gravação', !belongsToSession || active.length === 0]
  ] : [['start', 'Iniciar gravação', !names.length || names.some(name => !state.tiles.has(name))]];
  if (actions.length) { const separator = document.createElement('div'); separator.className = 'context-separator'; separator.setAttribute('role', 'separator'); menu.append(separator); }
  for (const [action, label, disabled] of actions) {
    const item = document.createElement('button');
    item.type = 'button'; item.className = 'context-item'; item.setAttribute('role', 'menuitem'); item.textContent = label; item.disabled = disabled;
    if (session && !belongsToSession && action !== 'start') item.title = `Esta gravação foi iniciada no menu ${session.all ? 'Todas as câmeras' : 'Esta câmera'}.`;
    item.addEventListener('click', () => {
      if (item.disabled) return;
      closeContextMenu();
      if (action === 'start') openRecordingDialog(scope);
      else changeRecordingState(scope, action);
    });
    menu.append(item);
  }
}

function recordingScopeKey(scope) { return scope.all ? 'all-cameras' : `camera:${scope.camera}`; }

function addContextTitle(menu, label) {
  const title = document.createElement('div');
  title.className = 'context-title';
  title.textContent = label;
  menu.prepend(title);
  menu.setAttribute('aria-label', label);
}

function createContextBranch(label, makeSubmenu) {
  const wrapper = document.createElement('div');
  wrapper.className = 'context-branch';
  const trigger = document.createElement('button');
  trigger.type = 'button'; trigger.className = 'context-item context-branch-trigger'; trigger.setAttribute('role', 'menuitem'); trigger.setAttribute('aria-haspopup', 'menu'); trigger.setAttribute('aria-expanded', 'false');
  trigger.append(document.createTextNode(label));
  const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '›'; trigger.append(arrow);
  const submenu = makeSubmenu(); addContextTitle(submenu, label); submenu.hidden = true; wrapper.append(trigger, submenu);
  const show = () => {
    for (const sibling of wrapper.parentElement.querySelectorAll(':scope > .context-branch')) {
      if (sibling === wrapper) continue;
      sibling.querySelector('.context-submenu').hidden = true;
      sibling.querySelector('[aria-haspopup="menu"]').setAttribute('aria-expanded', 'false');
    }
    submenu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    positionSubmenu(wrapper, submenu);
  };
  trigger.addEventListener('click', () => { show(); submenu.querySelector('[role^="menuitem"]')?.focus(); });
  wrapper.addEventListener('mouseenter', show);
  wrapper.addEventListener('focusin', show);
  return wrapper;
}

function positionSubmenu(wrapper, submenu) {
  const parent = wrapper.getBoundingClientRect();
  const width = submenu.getBoundingClientRect().width || 220;
  const height = Math.min(submenu.scrollHeight, innerHeight - 16);
  const left = parent.right + width <= innerWidth - 8 ? parent.right - 1 : parent.left - width + 1;
  const top = Math.max(8, Math.min(parent.top - 5, innerHeight - 8 - height));
  submenu.style.left = `${Math.max(8, left)}px`;
  submenu.style.top = `${top}px`;
}

function openContextMenu(x, y, cameraScope, allScope = null) {
  const root = elements.contextMenu;
  state.contextInvoker = document.activeElement;
  state.contextCamera = cameraScope.camera;
  root.replaceChildren(); root.removeAttribute('aria-label'); root.hidden = false;
  if (allScope) {
    root.append(
      createContextBranch('Esta câmera', () => createCameraScopeMenu(cameraScope)),
      createContextBranch('Todas as câmeras', () => createCameraScopeMenu(allScope))
    );
  } else {
    addContextTitle(root, 'Gravado');
    appendPlaybackShortcuts(root, cameraScope);
  }
  root.style.left = `${Math.max(8, Math.min(x, innerWidth - 240))}px`;
  root.style.top = `${Math.max(8, Math.min(y, innerHeight - Math.min(root.scrollHeight || 320, innerHeight - 16) - 8))}px`;
  root.querySelector('[role="menuitem"]')?.focus();
}

function safeMediaFilename(value) {
  return value.normalize('NFKC').replace(/\s+/gu, '-').replace(/[^\p{L}\p{N}_-]/gu, '_').replace(/[-_]+$/g, '').slice(0, 60) || 'camera';
}

function mediaEpoch() {
  if (state.mode !== 'playback') return Date.now();
  const epoch = state.reviewEpoch ?? state.reviewStart;
  if (!Number.isFinite(epoch)) throw new Error('Inicie a revisão antes de capturar a imagem ou o vídeo.');
  return epoch;
}

function mediaFilenames(cameras, extension, epoch) {
  const localTime = epochToInput(epoch, state.server.timeZone).replace(/:/g, '-');
  const milliseconds = String(new Date(epoch).getUTCMilliseconds()).padStart(3, '0');
  const stamp = `${localTime}-${milliseconds}`;
  const used = new Set();
  const random = new Uint32Array(1);
  return cameras.map(camera => {
    const base = `${safeMediaFilename(camera)}-${stamp}`;
    let filename;
    do {
      const suffix = crypto.getRandomValues(random)[0].toString(36).padStart(6, '0').slice(-6);
      filename = `${base}-${suffix}${extension}`;
    } while (used.has(filename.toLowerCase()));
    used.add(filename.toLowerCase());
    return filename;
  });
}

function captureCanvasBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível capturar o quadro da câmera.')), 'image/png'));
}

async function postMedia(path, params, body = null, contentType = 'application/octet-stream') {
  const response = await fetch(`${path}?${query({ server: state.serverId, ...params })}`, {
    method: 'POST', cache: 'no-store', headers: body ? { 'Content-Type': contentType } : {}, body
  });
  if (!response.ok) {
    let message = 'Não foi possível salvar a mídia na pasta configurada.';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.json();
}

async function captureFrames(scope) {
  if (!state.server?.screenshotFolderConfigured) {
    return toast('Defina screenshotFolder ou mediaFolder no arquivo de configuração do servidor.', 'error');
  }
  const cameraNames = scope.all ? [...state.tiles.keys()] : [scope.camera];
  const players = cameraNames.map(name => state.tiles.get(name)).filter(Boolean);
  if (!players.length) return toast('Abra uma câmera para capturar o quadro exibido.', 'error');
  if (players.some(player => !player.canvas.width || !player.canvas.height)) return toast('Aguarde a chegada do primeiro quadro antes de capturar.', 'error');
  try {
    const filenames = mediaFilenames(players.map(player => player.name), '.png', mediaEpoch());
    const blobs = await Promise.all(players.map(player => captureCanvasBlob(player.canvas)));
    for (const [index, filename] of filenames.entries()) {
      await postMedia('/api/media-file', { filename }, blobs[index], 'image/png');
    }
    toast(players.length === 1 ? 'Screenshot salvo sem sobreposições.' : `${players.length} screenshots salvos.`);
  } catch (error) {
    if (error.name !== 'AbortError') toast(error.message || 'Não foi possível salvar o screenshot.', 'error');
  }
}

function recordingMime(format) {
  const candidates = format === 'mp4'
    ? ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4']
    : ['video/mpeg'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function openRecordingDialog(scope) {
  if (!state.server?.videoFolderConfigured) {
    return toast('Defina videoFolder ou mediaFolder no arquivo de configuração do servidor.', 'error');
  }
  if (typeof MediaRecorder !== 'function') return toast('Este navegador não oferece gravação local de mídia.', 'error');
  state.pendingRecordingScope = scope;
  const mp4 = recordingMime('mp4');
  const mpeg = recordingMime('mpeg');
  for (const option of elements.recordFormat.options) {
    const supported = option.value === 'mp4' ? mp4 : mpeg;
    option.disabled = !supported;
    option.textContent = option.value === 'mp4'
      ? `MP4${mp4 ? '' : ' (não suportado neste navegador)'}`
      : `MPG / MPEG${mpeg ? '' : ' (não suportado neste navegador)'}`;
  }
  elements.recordFormat.value = mp4 ? 'mp4' : 'mpeg';
  updateRecordFormatHelp();
  elements.recordDialog.showModal();
}

function updateRecordFormatHelp() {
  const type = recordingMime(elements.recordFormat.value);
  elements.recordFormatHelp.textContent = type
    ? `Formato disponível neste navegador (${type}). O vídeo é recodificado a partir dos quadros exibidos.`
    : 'Este navegador não consegue gravar o formato selecionado. Escolha um formato disponível para continuar.';
  elements.recordConfirm.disabled = !type;
}

function setRecordingOverlay(camera, status) {
  const tile = state.tiles.get(camera)?.tile;
  if (!tile) return;
  const badge = tile.querySelector('.tile-state');
  badge.classList.toggle('is-recording', status === 'recording');
  badge.classList.toggle('is-recording-paused', status === 'paused');
  state.tiles.get(camera)?.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
}

function startRecording(camera, filename, mimeType, session) {
  const player = state.tiles.get(camera);
  if (!player || state.recordings.has(camera)) return;
  if (player.stopped || state.allStopped || !player.canvas.width || !player.canvas.height) throw new Error(`Aguarde a chegada do vídeo de ${camera} antes de gravar.`);
  if (typeof player.canvas.captureStream !== 'function') throw new Error('Este navegador não permite capturar os quadros exibidos.');
  const stream = player.canvas.captureStream(30);
  if (!state.audioContext) state.audioContext = new AudioContext();
  const destination = state.audioContext.createMediaStreamDestination();
  stream.addTrack(destination.stream.getAudioTracks()[0]);
  let opened = false;
  try {
    const recorder = new MediaRecorder(stream, { mimeType });
    const recording = { camera, recorder, destination, status: 'recording', bytes: 0, writeChain: Promise.resolve(), writeError: null };
    recording.finished = new Promise(resolve => { recording.resolveFinished = resolve; });
    recorder.addEventListener('dataavailable', event => {
      if (!event.data?.size || recording.writeError) return;
      recording.bytes += event.data.size;
      recording.writeChain = recording.writeChain.then(() => {
        if (recording.writeError) return;
        return postMedia('/api/media-recording', { filename, action: 'chunk' }, event.data, mimeType);
      }).catch(error => { recording.writeError = error; });
    });
    recorder.addEventListener('error', () => {
      recording.writeError ||= new Error('O navegador encontrou um erro durante a gravação.');
      if (recorder.state !== 'inactive') recorder.stop();
    });
    recorder.addEventListener('stop', async () => {
      try {
        await recording.writeChain;
        if (recording.writeError || recording.bytes === 0) {
          if (recording.writeError) throw recording.writeError;
          throw new Error('A gravação não produziu mídia válida; o arquivo foi descartado.');
        }
        await postMedia('/api/media-recording', { filename, action: 'finish' });
        toast(`Gravação salva: ${filename}`);
      } catch (error) {
        if (opened) await postMedia('/api/media-recording', { filename, action: 'abort' }).catch(() => {});
        if (error.name !== 'AbortError') toast(error.message || 'Não foi possível finalizar o arquivo de gravação.', 'error');
      } finally {
        for (const track of stream.getTracks()) track.stop();
        destination.disconnect?.();
        state.recordings.delete(camera);
        setRecordingOverlay(camera, 'stopped');
        if (state.recordingSession === session && session.status !== 'starting' &&
            session.cameras.every(name => !state.recordings.has(name))) state.recordingSession = null;
        recording.resolveFinished();
      }
    }, { once: true });
    recorder.start(1000);
    recording.writeChain = postMedia('/api/media-recording', { filename, action: 'start' }).then(() => {
      opened = true;
    }).catch(error => {
      recording.writeError = error;
      if (recorder.state !== 'inactive') recorder.stop();
    });
    state.recordings.set(camera, recording);
    setRecordingOverlay(camera, 'recording');
    return recording;
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    destination.disconnect?.();
    throw error;
  }
}

async function changeRecordingState(scope, action) {
  const names = scopedCameraNames(scope);
  if (action === 'start') {
    if (!state.server?.videoFolderConfigured) {
      return toast('Defina videoFolder ou mediaFolder no arquivo de configuração do servidor.', 'error');
    }
    if (state.recordingSession) return toast('Finalize a gravação atual no submenu que a iniciou antes de iniciar outra.', 'error');
    if (!names.length) return toast('Abra uma câmera antes de iniciar a gravação.', 'error');
    const mimeType = recordingMime(elements.recordFormat.value);
    if (!mimeType) return toast('O formato escolhido não é suportado por este navegador.', 'error');
    const session = { key: recordingScopeKey(scope), all: Boolean(scope.all), cameras: names.slice(), status: 'starting' };
    const started = [];
    state.recordingSession = session;
    try {
      const extension = mimeType.startsWith('video/mp4') ? '.mp4' : '.mpg';
      const filenames = mediaFilenames(session.cameras, extension, mediaEpoch());
      for (const [index, camera] of session.cameras.entries()) {
        const recording = startRecording(camera, filenames[index], mimeType, session);
        if (recording) started.push(recording);
      }
      session.status = 'recording';
      if (session.cameras.every(name => !state.recordings.has(name))) state.recordingSession = null;
    } catch (error) {
      if (started.length) {
        session.status = 'stopping';
        for (const recording of started) if (recording.recorder.state !== 'inactive') recording.recorder.stop();
        await Promise.all(started.map(recording => recording.finished));
      }
      if (state.recordingSession === session) state.recordingSession = null;
      if (error.name !== 'AbortError') toast(error.message || 'Não foi possível iniciar a gravação.', 'error');
    }
    return;
  }
  const session = state.recordingSession;
  if (!session || session.key !== recordingScopeKey(scope)) return;
  if (session.status === 'starting') {
    if (action === 'stop') requestStopRecordingSession();
    return;
  }
  for (const camera of session.cameras) {
    const recording = state.recordings.get(camera);
    if (!recording) continue;
    try {
      if (action === 'pause' && recording.status === 'recording') {
        recording.recorder.pause(); recording.status = 'paused'; setRecordingOverlay(camera, 'paused');
        session.status = 'paused';
      } else if (action === 'resume' && recording.status === 'paused') {
        recording.recorder.resume(); recording.status = 'recording'; setRecordingOverlay(camera, 'recording');
        session.status = 'recording';
      } else if (action === 'stop' && recording.recorder.state !== 'inactive') {
        session.status = 'stopping'; recording.status = 'stopping'; recording.recorder.stop();
      }
    } catch { toast(`Não foi possível atualizar a gravação de ${camera}.`, 'error'); }
  }
}

function requestStopRecordingSession() {
  const session = state.recordingSession;
  if (!session) return [];
  session.status = 'stopping';
  const active = session.cameras.map(camera => state.recordings.get(camera)).filter(Boolean);
  for (const recording of active) {
    recording.status = 'stopping';
    if (recording.recorder.state !== 'inactive') recording.recorder.stop();
  }
  if (!active.length && state.recordingSession === session) state.recordingSession = null;
  return active.map(recording => recording.finished);
}

function closeContextMenu(restoreFocus = false) {
  const invoker = state.contextInvoker;
  elements.contextMenu.hidden = true; elements.contextMenu.replaceChildren();
  if (restoreFocus && invoker?.isConnected) invoker.focus();
}

async function beginContextPlayback(scope, seconds) {
  if (!state.server || (scope.all && !state.tiles.has(scope.camera))) return;
  const selectedAt = Date.now();
  if (!scope.all) {
    for (const camera of [...state.tiles.keys()]) if (camera !== scope.camera) await closeCamera(camera);
    state.mosaic = 'auto'; elements.mosaicSelect.value = 'auto'; applyMosaic();
    if (!state.tiles.has(scope.camera)) await openCamera(scope.camera, 'Recording');
  }
  await leaveFullscreen();
  setMode('playback');
  if (seconds === null) {
    elements.startDateTime.value = ''; elements.endDateTime.value = '';
    state.reviewStart = null; state.reviewEnd = null; state.reviewLimitEnd = null; state.reviewEpoch = null;
    clearTimeline(); clearThumbnails();
    elements.timelineStatus.textContent = 'Informe um período para carregar a timeline.';
    elements.thumbnailStatus.textContent = 'Informe um período para carregar miniaturas.';
    elements.startDateTime.focus();
    return;
  }
  elements.startDateTime.value = epochToInput(selectedAt - seconds * 1000, state.server.timeZone);
  elements.endDateTime.value = '';
  startReview();
}

elements.contextMenu.addEventListener('keydown', event => {
  const current = event.target.closest('[role^="menuitem"]');
  const menu = event.target.closest('[role="menu"]');
  const items = [...menu.querySelectorAll(':scope > [role^="menuitem"], :scope > .context-branch > [role="menuitem"]')].filter(item => !item.disabled && item.offsetParent !== null);
  const index = items.indexOf(current);
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); }
  if (event.key === 'ArrowRight' && current?.getAttribute('aria-haspopup') === 'menu') {
    event.preventDefault();
    if (current.getAttribute('aria-expanded') !== 'true') current.click();
    current.parentElement.querySelector('.context-submenu [role^="menuitem"]')?.focus();
  }
  if (event.key === 'ArrowLeft' && menu !== elements.contextMenu) { event.preventDefault(); const branch = menu.parentElement; menu.hidden = true; branch.querySelector('[aria-haspopup="menu"]').setAttribute('aria-expanded', 'false'); branch.querySelector('[aria-haspopup="menu"]').focus(); }
  if (event.key === 'Escape') { event.preventDefault(); closeContextMenu(true); }
});

document.addEventListener('pointerdown', event => {
  if (!elements.contextMenu.contains(event.target)) closeContextMenu();
  if (!elements.displayControl.contains(event.target)) closeDisplayMenu();
});
document.addEventListener('contextmenu', event => {
  if (!event.target.closest?.('.camera-tile, .camera-row')) event.preventDefault();
});

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
    state.desktopWindow = Boolean(result.canOpenConfigFolder);
    state.servers = (result.servers || []).map(server => typeof server === 'string'
      ? { id: server, name: server }
      : { id: server.id, name: server.name || server.id, ready: server.ready });
    const readyServers = state.servers.filter(server => server.ready !== false);
    elements.serverSelect.replaceChildren();
    if (!readyServers.length && !elements.configDialog.open) await openConfigDialog();
    if (!state.servers.length) {
      const option = new Option('Nenhuma configuração encontrada', '');
      elements.serverSelect.add(option);
      elements.serverSelect.disabled = true;
      elements.cameraListEmpty.textContent = 'Adicione um arquivo de configuração para conectar ao servidor.';
      elements.cameraListEmpty.hidden = false;
      setConnection('idle', 'Aguardando configuração');
      return;
    }
    elements.serverSelect.disabled = false;
    if (state.servers.length > 1 || !readyServers.length) {
      elements.serverSelect.add(new Option('Escolha um servidor…', ''));
    }
    for (const server of state.servers) {
      elements.serverSelect.add(new Option(server.ready === false ? `${server.name} (revisar configuração)` : server.name, server.id));
    }
    if (readyServers.length === 1) {
      elements.serverSelect.value = readyServers[0].id;
      await selectServer(readyServers[0].id);
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

const configForm = $('#configForm');
const configChoice = $('#configChoice');
let configPausedStreams = false;
let configChangedActive = false;

function refreshConfigChoices(selected = '') {
  configChoice.replaceChildren(new Option('Nova configuração', ''), ...state.servers.map(server => new Option(server.name, server.id)));
  configChoice.value = selected;
}

async function loadConfigForm(id) {
  configForm.reset();
  configChoice.value = id;
  configForm.elements.initialMosaic.replaceChildren(...MOSAICS.map(item => new Option(item.name, item.id)));
  configForm.elements.id.readOnly = Boolean(id);
  $('#deleteConfig').hidden = !id;
  $('#passwordHint').textContent = id ? 'Deixe em branco para manter a senha atual.' : '';
  configForm.elements.password.required = !id;
  configForm.elements.password.type = 'password';
  $('#toggleConfigPassword').setAttribute('aria-label', 'Mostrar senha');
  $('#toggleConfigPassword').setAttribute('aria-pressed', 'false');
  $('#toggleConfigPassword').title = 'Mostrar senha';
  elements.configDialogMessage.textContent = '';
  if (!id) return;
  try {
    const { fields, hasPassword } = await apiJson(`/api/config?${query({ server: id })}`);
    for (const name of ['name', 'serverAddress', 'userAgent', 'username', 'timeZone', 'mediaFolder', 'screenshotFolder', 'videoFolder', 'initialMosaic']) {
      if (typeof fields[name] === 'string') configForm.elements[name].value = fields[name];
    }
    configForm.elements.maxCams.value = fields.maxCams ?? 0;
    configForm.elements.id.value = id;
    configForm.elements.useBasicAuth.checked = fields.useBasicAuth === true;
    configForm.elements.initialCameras.value = Object.entries(fields.initialCameras || {}).map(([name, profile]) => `${name} | ${profile}`).join('\n');
    configForm.elements.password.required = !hasPassword;
  } catch (error) { elements.configDialogMessage.textContent = error.message; }
}

async function openConfigDialog() {
  if (elements.configDialog.open) return;
  configPausedStreams = !state.allStopped && state.tiles.size > 0;
  if (configPausedStreams) await toggleAllStreams();
  configChangedActive = false;
  refreshConfigChoices(state.serverId);
  await loadConfigForm(configChoice.value);
  elements.configDialog.showModal();
}
$('#manageConfigs').addEventListener('click', openConfigDialog);
configChoice.addEventListener('change', () => loadConfigForm(configChoice.value));
$('#toggleConfigPassword').addEventListener('click', event => {
  const input = configForm.elements.password;
  input.type = input.type === 'password' ? 'text' : 'password';
  const label = input.type === 'password' ? 'Mostrar senha' : 'Ocultar senha';
  event.currentTarget.setAttribute('aria-label', label);
  event.currentTarget.setAttribute('aria-pressed', String(input.type === 'text'));
  event.currentTarget.title = label;
});

async function configRequest(method, id, fields) {
  const response = await fetch(`/api/config?${query({ server: id })}`, {
    method, headers: fields ? { 'Content-Type': 'application/json' } : {}, body: fields ? JSON.stringify(fields) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a configuração.');
}

async function saveConfig() {
  if (!configForm.reportValidity()) return;
  $('#saveConfig').disabled = true;
  const f = configForm.elements;
  const id = f.id.value.trim();
  const initialCameras = Object.create(null);
  for (const line of f.initialCameras.value.split('\n').filter(line => line.trim())) {
    const parts = line.split('|').map(part => part.trim());
    if (parts.length !== 2 || !parts[0] || !['Visualization', 'Recording'].includes(parts[1]) || Object.hasOwn(initialCameras, parts[0])) {
      elements.configDialogMessage.textContent = 'Informe cada câmera uma vez, no formato nome | Visualization ou nome | Recording.';
      $('#saveConfig').disabled = false; return;
    }
    initialCameras[parts[0]] = parts[1];
  }
  const fields = { name: f.name.value, serverAddress: f.serverAddress.value, userAgent: f.userAgent.value, username: f.username.value, timeZone: f.timeZone.value, mediaFolder: f.mediaFolder.value, screenshotFolder: f.screenshotFolder.value, videoFolder: f.videoFolder.value, initialMosaic: f.initialMosaic.value, maxCams: Number(f.maxCams.value), useBasicAuth: f.useBasicAuth.checked, initialCameras };
  if (f.password.value || !configChoice.value) fields.password = f.password.value;
  f.password.value = '';
  try {
    await configRequest(configChoice.value ? 'PUT' : 'POST', id, fields);
    if (id === state.serverId) configChangedActive = true;
    const result = await apiJson('/api/servers'); state.servers = result.servers;
    const closing = closeConfigDialog();
    toast('Configuração salva.');
    await closing;
  } catch (error) {
    if (Object.hasOwn(fields, 'password')) f.password.value = fields.password;
    elements.configDialogMessage.textContent = error.message;
  } finally { $('#saveConfig').disabled = false; }
}
$('#saveConfig').addEventListener('click', saveConfig);
configForm.addEventListener('submit', event => event.preventDefault());
configForm.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.isComposing && event.target.tagName !== 'TEXTAREA' && event.target.tagName !== 'BUTTON') {
    event.preventDefault();
    if (!$('#saveConfig').disabled) void saveConfig();
  }
});
$('#deleteConfig').addEventListener('click', async () => {
  const id = configChoice.value;
  if (!id || !window.confirm('Excluir esta configuração?')) return;
  try {
    await configRequest('DELETE', id);
    if (id === state.serverId) configChangedActive = true;
    const result = await apiJson('/api/servers'); state.servers = result.servers;
    refreshConfigChoices(); await loadConfigForm('');
    elements.configDialogMessage.textContent = 'Configuração excluída.';
  } catch (error) { elements.configDialogMessage.textContent = error.message; }
});
async function closeConfigDialog() {
  if (!state.servers.some(server => server.ready !== false)) {
    if (state.desktopWindow) await fetch('/api/close-app', { method: 'POST' });
    else window.location.replace('about:blank');
    return;
  }
  elements.configDialog.close();
  const oldId = state.serverId;
  if (configChangedActive || !oldId) {
    if (oldId && !state.servers.some(server => server.id === oldId && server.ready)) {
      if (state.statusTimer) window.clearInterval(state.statusTimer);
      state.statusTimer = null; state.statusRequestId += 1;
      clearTimeline(); clearThumbnails(); await closeAllTiles();
      state.server = null; state.cameras = []; state.cameraStatuses.clear();
      drawCameraList();
    }
    state.serverId = '';
    await initializeServers();
    if (oldId && state.servers.some(server => server.id === oldId && server.ready) && state.serverId !== oldId) {
      elements.serverSelect.value = oldId; await selectServer(oldId);
    }
  } else {
    const result = await apiJson('/api/servers'); state.servers = result.servers;
    elements.serverSelect.replaceChildren(new Option('Escolha um servidor…', ''), ...state.servers.map(server => new Option(server.name, server.id)));
    elements.serverSelect.value = oldId;
    if (configPausedStreams) await toggleAllStreams();
  }
}
elements.closeConfigApp.addEventListener('click', closeConfigDialog);
elements.configDialog.addEventListener('cancel', event => { event.preventDefault(); void closeConfigDialog(); });

async function selectServer(id) {
  if (!id) return;
  if (state.statusTimer) window.clearInterval(state.statusTimer);
  state.statusTimer = null;
  state.statusRequestId += 1;
  state.statusRefreshing = false;
  clearTimeline();
  await closeAllTiles();
  state.mode = 'live';
  state.serverId = id;
  state.server = null;
  state.cameras = [];
  state.cameraStatuses.clear();
  state.focused = '';
  state.audioEnabled = false;
  state.allStopped = false;
  state.reviewEpoch = null;
  state.surveillance = false; updateSurveillance();
  state.reviewStart = null;
  state.reviewEnd = null;
  state.reviewLimitEnd = null;
  elements.liveMode.classList.add('is-active');
  elements.liveMode.setAttribute('aria-pressed', 'true');
  elements.reviewMode.classList.remove('is-active');
  elements.reviewMode.setAttribute('aria-pressed', 'false');
  elements.reviewFields.hidden = true;
  elements.reviewPanel.hidden = true;
  closeThumbnailView(false);
  elements.thumbnailPanel.hidden = true;
  clearThumbnails();
  setConnection('idle', 'Conectando');
  elements.cameraList.replaceChildren();
  elements.cameraListEmpty.hidden = false;
  elements.cameraListEmpty.textContent = 'Carregando câmeras…';
  try {
    const serverInfo = await apiJson(`/api/server?${query({ server: id })}`);
    state.server = serverInfo;

    setupMosaics(serverInfo.initialMosaic || 'auto');
    const result = await apiJson(`/api/cameras?${query({ server: id })}`);
    state.cameras = result.cameras || [];
    elements.cameraListEmpty.hidden = state.cameras.length > 0;
    elements.cameraListEmpty.textContent = state.cameras.length ? '' : 'O servidor não retornou câmeras disponíveis para esta conta.';
    drawCameraList();
    void refreshCameraStatuses(id);
    state.statusTimer = window.setInterval(() => void refreshCameraStatuses(id), 60000);
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
  const focusedName = elements.cameraList.contains(document.activeElement) ? document.activeElement.dataset.cameraName : null;
  elements.cameraList.replaceChildren();
  elements.cameraCount.textContent = String(state.tiles.size);
  elements.availableCount.textContent = String(state.cameras.length);
  for (const camera of visible) {
    const isOpen = state.tiles.has(camera.name);
    const full = !isOpen && state.tiles.size >= cameraCapacity();
    const status = state.cameraStatuses.get(camera.name);
    const unavailable = status?.working === false;
    const description = camera.description || (camera.active ? 'Disponível' : 'Desativada');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.cameraName = camera.name;
    button.className = `camera-row${isOpen ? ' is-open' : ''}${unavailable ? ' is-unavailable' : ''}`;
    button.setAttribute('aria-pressed', String(isOpen));
    const statusLabel = unavailable ? 'indisponível' : status?.working === true ? 'funcionando' : '';
    const statusDetail = unavailable
      ? `Indisponível${status.inactiveTime === null ? '' : ` · parada há ${formatDuration(status.inactiveTime)}`}`
      : status?.working === true && status.activeTime !== null
        ? `Funcionando há ${formatDuration(status.activeTime)}`
        : '';
    button.setAttribute('aria-label', `Câmera ${camera.name}; ${description}${statusLabel ? `; ${statusDetail || statusLabel}` : ''}`);
    button.innerHTML = '<span class="camera-icon" aria-hidden="true"><svg class="camera-symbol" viewBox="0 0 28 22" aria-hidden="true" focusable="false"><rect x="2.5" y="4.5" width="15.5" height="13" rx="2.3"></rect><path d="m18 8.3 5.3-2.6a1.1 1.1 0 0 1 1.6 1v8.6a1.1 1.1 0 0 1-1.6 1L18 13.7z"></path><path d="M6 8.2h3.8"></path></svg><span class="camera-health-mark" hidden>!</span></span><span class="camera-meta"><span class="camera-name"></span><span class="camera-description"></span><span class="camera-status-detail" hidden></span></span><span class="camera-add" aria-hidden="true"></span>';
    button.querySelector('.camera-name').textContent = camera.name;
    button.querySelector('.camera-description').textContent = description;
    const statusDetailNode = button.querySelector('.camera-status-detail');
    statusDetailNode.textContent = statusDetail;
    statusDetailNode.hidden = !statusDetail;
    button.querySelector('.camera-health-mark').hidden = !unavailable;
    button.querySelector('.camera-add').textContent = isOpen ? '×' : '+';
    button.disabled = !camera.active;
    button.setAttribute('aria-disabled', String(full));
    button.addEventListener('click', () => isOpen ? closeCamera(camera.name) : full ? toast('O mosaico está cheio. Libere uma posição antes de abrir outra câmera.', 'error') : openCamera(camera.name));
    button.addEventListener('contextmenu', event => { event.preventDefault(); openContextMenu(event.clientX, event.clientY, { camera: camera.name, all: false }); });
    button.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const rows = [...elements.cameraList.querySelectorAll('.camera-row:not(:disabled)')];
        const index = rows.indexOf(button);
        rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { event.preventDefault(); const rect = button.getBoundingClientRect(); openContextMenu(rect.left + 12, rect.top + 12, { camera: camera.name, all: false }); }
    });
    elements.cameraList.append(button);
  }
  if (focusedName) [...elements.cameraList.querySelectorAll('.camera-row')].find(row => row.dataset.cameraName === focusedName)?.focus();
  if (state.cameras.length && !visible.length) {
    const empty = document.createElement('div');
    empty.className = 'rail-empty';
    empty.textContent = 'Nenhuma câmera corresponde à busca.';
    elements.cameraList.append(empty);
  }
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(seconds));
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = value % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min ${remainingSeconds} s`;
  return `${remainingSeconds} s`;
}

async function refreshCameraStatuses(serverId) {
  if (!serverId || serverId !== state.serverId || state.statusRefreshing) return;
  state.statusRefreshing = true;
  const requestId = ++state.statusRequestId;
  try {
    const result = await apiJson(`/api/camera-status?${query({ server: serverId })}`);
    if (requestId !== state.statusRequestId || serverId !== state.serverId || !Array.isArray(result.statuses)) return;
    for (const status of result.statuses) {
      if (!status || typeof status.name !== 'string') continue;
      state.cameraStatuses.set(status.name, {
        working: typeof status.working === 'boolean' ? status.working : null,
        activeTime: Number.isFinite(status.activeTime) ? status.activeTime : null,
        inactiveTime: Number.isFinite(status.inactiveTime) ? status.inactiveTime : null
      });
    }
    drawCameraList();
  } catch {
    // Keep the last known status, or leave it unknown when no status was received.
  } finally {
    if (requestId === state.statusRequestId) state.statusRefreshing = false;
  }
}

function createTile(cameraName, profile) {
  const tile = document.createElement('article');
  tile.className = 'camera-tile';
  tile.dataset.camera = cameraName;
  tile.draggable = true;
  const camera = state.cameras.find(item => item.name === cameraName);
  tile.innerHTML = `
    <div class="tile-video" tabindex="0" role="button" aria-label="Focar câmera">
      <canvas class="tile-canvas"></canvas>
      <div class="tile-overlay">
        <div class="tile-topline"><div class="tile-camera-meta"><span class="tile-camera-name"></span><span class="tile-camera-description"></span></div><span class="tile-state"><span class="tile-audio-indicator" hidden><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 8h3l4-3v10l-4-3H3z"></path><path class="tile-audio-on" d="M13 7c1.7 1.6 1.7 4.4 0 6m2-8c3 2.8 3 7.2 0 10"></path><path class="tile-audio-off" d="m13 8 4 4m0-4-4 4"></path></svg></span><span class="tile-state-text">Conectando</span></span></div>
        <div class="tile-message" hidden></div>
        <div class="tile-bottomline"><span class="tile-timecode">--:--:--</span><span class="tile-codec"></span></div>
      </div>
    </div>`;
  tile.querySelector('.tile-camera-name').textContent = cameraName;
  const cameraDescription = tile.querySelector('.tile-camera-description');
  cameraDescription.textContent = camera?.description || '';
  cameraDescription.hidden = !camera?.description;
  tile.querySelector('.tile-video').setAttribute('aria-label', `Focar câmera ${cameraName}`);
  const videoSurface = tile.querySelector('.tile-video');
  videoSurface.addEventListener('click', () => focusCamera(cameraName));
  videoSurface.addEventListener('dblclick', () => toggleTileFullscreen(tile, cameraName));
  tile.addEventListener('contextmenu', event => { event.preventDefault(); openContextMenu(event.clientX, event.clientY, { camera: cameraName, all: false }, { camera: cameraName, all: true }); });
  const canvas = tile.querySelector('.tile-canvas');
  const zoom = { scale: 1, x: 0, y: 0 };
  const applyZoom = () => { canvas.style.transform = `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`; };
  const resetZoom = () => { zoom.scale = 1; zoom.x = 0; zoom.y = 0; applyZoom(); };
  tile.resetZoom = resetZoom;
  tile.addEventListener('wheel', event => {
    if (!isTileEnlarged(tile) || !event.target.closest('.tile-video') || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const nextScale = Math.max(1, Math.min(8, zoom.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (nextScale <= 1.001) { resetZoom(); return; }
    if (nextScale === zoom.scale) return;
    const rect = canvas.getBoundingClientRect();
    const baseLeft = rect.left - zoom.x;
    const baseTop = rect.top - zoom.y;
    const anchorX = (event.clientX - rect.left) / zoom.scale;
    const anchorY = (event.clientY - rect.top) / zoom.scale;
    zoom.x = event.clientX - baseLeft - anchorX * nextScale;
    zoom.y = event.clientY - baseTop - anchorY * nextScale;
    zoom.scale = nextScale;
    applyZoom();
  }, { passive: false });
  tile.addEventListener('dblclick', event => {
    if (isTileEnlarged(tile)) { event.preventDefault(); resetZoom(); }
  });
  tile.addEventListener('keydown', event => {
    if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && !['SELECT', 'BUTTON'].includes(event.target.tagName)) { event.preventDefault(); const rect = tile.getBoundingClientRect(); openContextMenu(rect.left + rect.width / 2, rect.top + rect.height / 2, { camera: cameraName, all: false }, { camera: cameraName, all: true }); }
  });
  tile.addEventListener('dragstart', event => { event.dataTransfer.setData('text/plain', cameraName); event.dataTransfer.effectAllowed = 'move'; tile.classList.add('is-dragging'); });
  tile.addEventListener('dragend', () => tile.classList.remove('is-dragging'));
  tile.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('text/plain')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } });
  tile.addEventListener('drop', event => {
    event.preventDefault();
    const moving = elements.viewerGrid.querySelector(`[data-camera="${CSS.escape(event.dataTransfer.getData('text/plain'))}"]`);
    if (!moving || moving === tile) return;
    const tiles = [...elements.viewerGrid.querySelectorAll('.camera-tile')];
    const sourceIndex = tiles.indexOf(moving);
    const targetIndex = tiles.indexOf(tile);
    [tiles[sourceIndex], tiles[targetIndex]] = [tiles[targetIndex], tiles[sourceIndex]];
    for (const item of tiles) elements.viewerGrid.append(item);
    reorderTiles();
  });
  tile.querySelector('.tile-video').addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusCamera(cameraName); }
  });
  if (state.mode === 'playback') tile.querySelector('.tile-state').classList.add('review');
  return tile;
}

function isTileEnlarged(tile) { return document.fullscreenElement === tile || tile.classList.contains('is-enlarged'); }

function closeSurveillanceTile() {
  const tile = elements.viewerGrid.querySelector('.camera-tile.is-enlarged');
  if (!tile) return false;
  tile.classList.remove('is-enlarged');
  tile.resetZoom?.();
  return true;
}

async function toggleTileFullscreen(tile, cameraName) {
  if (state.surveillance && document.fullscreenElement === document.documentElement) {
    const wasEnlarged = tile.classList.contains('is-enlarged');
    closeSurveillanceTile();
    if (!wasEnlarged) tile.classList.add('is-enlarged');
    return;
  }
  if (document.fullscreenElement === tile) {
    try { await document.exitFullscreen(); }
    catch { toast(`Não foi possível sair da tela cheia de ${cameraName}.`, 'error'); }
    return;
  }
  if (typeof tile.requestFullscreen !== 'function' || !document.fullscreenEnabled) {
    toast('Este navegador não permite abrir a câmera em tela cheia.', 'error');
    return;
  }
  try { await tile.requestFullscreen(); }
  catch { toast(`Não foi possível abrir ${cameraName} em tela cheia.`, 'error'); }
}

async function leaveFullscreen() {
  closeSurveillanceTile();
  while (document.fullscreenElement) await document.exitFullscreen();
  state.surveillance = false; updateSurveillance();
}

async function toggleSurveillance() {
  if (state.surveillance) { await leaveFullscreen(); return; }
  try { await document.documentElement.requestFullscreen(); state.surveillance = true; updateSurveillance(); }
  catch { toast('Não foi possível ativar o modo vigilância.', 'error'); return; }
  try {
    if (!navigator.keyboard?.lock) throw new Error('Keyboard Lock indisponível');
    await navigator.keyboard.lock(['Escape']);
    if (!state.surveillance || !document.fullscreenElement) navigator.keyboard.unlock();
  } catch {
    if (state.surveillance) toast('O navegador não permitiu controlar Esc. Para restaurar a câmera sem sair da vigilância, clique duas vezes.', 'error');
  }
}

document.addEventListener('keydown', event => {
  if (event.key === 'F11') { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (event.defaultPrevented || document.querySelector('dialog[open]')) return;
  if (event.key === 'Escape' && state.surveillance && closeSurveillanceTile()) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (event.key === 'Escape' && state.thumbnailActive) { event.preventDefault(); closeThumbnailView(); return; }
  if (event.key === 'Escape' && state.surveillance && document.fullscreenElement === document.documentElement) { event.preventDefault(); void leaveFullscreen(); return; }
  if (event.key !== 'Escape' || !document.fullscreenElement?.classList.contains('camera-tile')) return;
  event.preventDefault();
  void document.exitFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  for (const tile of elements.viewerGrid.querySelectorAll('.camera-tile')) if (!isTileEnlarged(tile)) tile.resetZoom?.();
  if (!document.fullscreenElement && state.surveillance) { navigator.keyboard?.unlock?.(); closeSurveillanceTile(); state.surveillance = false; updateSurveillance(); }
});

async function openCamera(cameraName, initialProfile = 'Visualization') {
  if (!state.serverId || state.tiles.has(cameraName)) return;
  if (state.thumbnailActive) closeThumbnailView();
  const camera = state.cameras.find(item => item.name === cameraName);
  if (!camera?.active) return toast('Esta câmera está desativada ou indisponível.', 'error');
  if (state.tiles.size >= cameraCapacity()) return toast('O mosaico está cheio. Libere uma posição antes de abrir outra câmera.', 'error');
  const profile = state.mode === 'playback' ? 'Recording' : ['Visualization', 'Recording'].includes(initialProfile) ? initialProfile : 'Visualization';
  const tile = createTile(cameraName, profile);
  elements.emptyMonitor.hidden = true;
  elements.viewerGrid.append(tile);
  const player = new CameraPlayer(cameraName, tile, profile);
  state.tiles.set(cameraName, player);
  applyMosaic();
  if (state.mode === 'playback' && state.reviewStart) loadFocusedTimeline();
  const resumeExisting = state.allStopped;
  state.allStopped = false;
  if (resumeExisting) for (const existing of state.tiles.values()) if (existing !== player) await existing.start();
  if (!state.focused) focusCamera(cameraName);
  updateAudioSources();
  drawCameraList();
  updateViewHeader();
  await player.start();
}

async function closeCamera(cameraName) {
  const player = state.tiles.get(cameraName);
  if (!player) return;
  if (state.thumbnailActive) closeThumbnailView();
  const recording = state.recordings.get(cameraName);
  if (recording) {
    await Promise.all(requestStopRecordingSession());
  }
  const wasFocused = state.focused === cameraName;
  player.stop();
  state.tiles.delete(cameraName);
  player.tile.remove();
  if (wasFocused) {
    const nextFocus = state.tiles.keys().next().value || '';
    if (nextFocus) focusCamera(nextFocus);
    else { state.focused = ''; clearThumbnails(); }
  }
  if (!state.tiles.size) {
    elements.emptyMonitor.hidden = false;
    state.audioEnabled = false;
  }
  if (!state.tiles.size) state.allStopped = false;
  applyMosaic();
  if (state.mode === 'playback' && state.reviewStart && state.tiles.size) loadFocusedTimeline();
  updateAudioSources();
  drawCameraList();
  updateViewHeader();
  if (wasFocused && state.mode === 'playback' && state.reviewStart) {
    if (!state.focused) {
      clearTimeline();
      clearThumbnails();
      if (state.timelineVisible) elements.timelineStatus.textContent = 'Abra uma câmera para carregar a timeline.';
    }
  }
}

async function closeAllTiles() {
  for (const player of state.tiles.values()) player.stop();
  state.tiles.clear();
  elements.viewerGrid.querySelectorAll('.camera-tile').forEach(tile => tile.remove());
  elements.emptyMonitor.hidden = false;
  state.focused = '';
  state.audioEnabled = false;
  state.allStopped = false;
  updateAudioSources();
  drawCameraList();
  updateViewHeader();
}

function focusCamera(cameraName) {
  if (!state.tiles.has(cameraName)) return;
  const previousFocus = state.focused;
  if (previousFocus !== cameraName) clearThumbnails();
  state.focused = cameraName;
  for (const [name, player] of state.tiles) {
    player.tile.classList.toggle('is-focused', name === cameraName);
  }
  updateAudioSources();
  updateViewHeader();
  if (state.audioEnabled && previousFocus !== cameraName) void audioSourceChanged(previousFocus, cameraName);

}

function updateAudioSources() {
  elements.audioSource.replaceChildren();
  for (const [name, player] of state.tiles) {
    const indicator = player.tile.querySelector('.tile-audio-indicator');
    indicator.hidden = name !== state.focused;
    indicator.classList.toggle('is-audio-on', state.audioEnabled);
    indicator.setAttribute('aria-label', state.audioEnabled ? 'Em foco, áudio ativado' : 'Em foco, áudio desativado');
  }
  if (!state.tiles.size) {
    elements.audioSource.add(new Option('Nenhuma câmera aberta', ''));
    elements.audioSource.disabled = true;
    elements.audioToggle.disabled = true;
    elements.audioToggle.setAttribute('aria-pressed', 'false');
    elements.audioToggle.setAttribute('aria-label', 'Ativar áudio');
    elements.audioToggle.title = 'Ativar áudio · A';
    return;
  }
  for (const name of state.tiles.keys()) elements.audioSource.add(new Option(name, name));
  elements.audioSource.value = state.focused;
  elements.audioSource.disabled = false;
  elements.audioToggle.disabled = false;
  elements.audioToggle.setAttribute('aria-pressed', String(state.audioEnabled));
  const audioAction = state.audioEnabled ? 'Desativar áudio' : 'Ativar áudio';
  elements.audioToggle.setAttribute('aria-label', audioAction);
  elements.audioToggle.title = `${audioAction} · A`;
}

function updateViewHeader() {
  const count = state.tiles.size;
  elements.cameraCount.textContent = String(count);
  elements.stopAll.disabled = count === 0;
  const stopAction = state.allStopped ? 'Retomar todas as câmeras' : 'Parar todas as câmeras';
  elements.stopAll.title = `${stopAction} · Espaço`;
  elements.stopAll.setAttribute('aria-label', stopAction);
  elements.stopAll.setAttribute('aria-pressed', String(state.allStopped));
  elements.stopAll.dataset.state = state.allStopped ? 'stopped' : 'active';
  elements.viewSubtitle.textContent = state.focused ? `${state.focused}${state.mode === 'live' ? ' · transmissão instantânea' : ' · horário sincronizado'}` : 'Escolha uma câmera para começar.';
}

function setMode(mode) {
  if (state.mode === mode) return;
  if (state.mode === 'playback' && mode !== 'playback' && state.recordings.size) requestStopRecordingSession();
  if (state.thumbnailActive) closeThumbnailView(false);
  state.mode = mode;
  state.allStopped = false;
  const wasPlayback = mode === 'playback';
  elements.liveMode.classList.toggle('is-active', !wasPlayback);
  elements.liveMode.setAttribute('aria-pressed', String(!wasPlayback));
  elements.reviewMode.classList.toggle('is-active', wasPlayback);
  elements.reviewMode.setAttribute('aria-pressed', String(wasPlayback));
  elements.reviewFields.hidden = !wasPlayback;
  updateOverlayState();
  if (wasPlayback) {
    setDefaultReviewTimes();
    state.reviewStart = null;
    state.reviewEnd = null;
    state.reviewLimitEnd = null;
    state.reviewEpoch = null;
    for (const player of state.tiles.values()) {
      player.profile = 'Recording';
      player.tile.querySelector('.tile-state').classList.add('review');
    }
  } else {
    elements.timelineStatus.textContent = 'Timeline disponível durante as gravações.';
    for (const player of state.tiles.values()) {
      player.profile = player.lastLiveProfile || 'Visualization';
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
  if (state.thumbnailActive) closeThumbnailView(false);
  if (!state.tiles.size) return toast('Abra pelo menos uma câmera antes de carregar gravações.', 'error');
  if (!elements.startDateTime.value) return toast('Informe data e hora de início.', 'error');
  try {
    state.reviewStart = inputToEpoch(elements.startDateTime.value, state.server.timeZone);
    state.reviewEnd = elements.endDateTime.value ? inputToEpoch(elements.endDateTime.value, state.server.timeZone) : null;
    if (state.reviewEnd && state.reviewEnd <= state.reviewStart) throw new Error('O fim precisa ser posterior ao início.');
    state.reviewLimitEnd = state.reviewEnd ?? Date.now();
    state.reviewEpoch = state.reviewStart;
    clearThumbnails();
    state.allStopped = false;
  } catch (error) {
    return toast(error.message || 'Confira o período selecionado.', 'error');
  }
  for (const player of state.tiles.values()) player.restart();
  loadFocusedTimeline();
}

function loadFocusedTimeline() {
  if (state.mode !== 'playback' || !state.reviewStart || !state.timelineVisible) return;
  clearTimeline();
  state.timelineStart = state.reviewStart;
  state.timelineEnd = state.reviewLimitEnd;
  for (const camera of state.tiles.keys()) { state.timelineData.set(camera, []); void loadTimeline(camera); }
  drawTimeline();
}

function seekReview(epoch) {
  if (state.thumbnailActive) closeThumbnailView(false);
  if (state.mode !== 'playback' || !Number.isFinite(epoch) || !Number.isFinite(state.reviewStart)) return;
  const end = state.reviewLimitEnd ?? state.reviewEnd ?? state.timelineEnd ?? Date.now();
  clearThumbnails();
  state.reviewEpoch = Math.max(state.reviewStart, Math.min(end, epoch));
  updateTimelinePlayhead(state.reviewEpoch);
  for (const player of state.tiles.values()) player.restart();
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
    epoch += wanted - (seen + (epoch % 1000 + 1000) % 1000);
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
    this.videoCodec = '';
    this.videoDecoderGeneration = 0;
    this.activeVideoCodec = '';
    this.videoCodecEpoch = 0;
    this.hevcParameterSets = new Map();
    this.hevcHasRandomAccess = false;
    this.hevcDecodeChain = Promise.resolve();
    this.audioDecoder = null;
    this.g726 = null;
    this.g726Config = null;
    this.g726DecodeChain = Promise.resolve();
    this.audioAbortController = null;
    this.audioStreamToken = 0;
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
    const params = {
      server: state.serverId, camera: this.name, mode: state.mode,
      profile: state.mode === 'live' ? this.profile : undefined,
      audio: '0'
    };
    if (state.mode === 'playback') {
      if (!state.reviewStart) {
        this.setMessage('Informe o horário e selecione Reproduzir.');
        return;
      }
      const start = epochToApi(state.reviewEpoch ?? state.reviewStart, state.server.timeZone);
      const end = state.reviewEnd ? epochToApi(state.reviewEnd, state.server.timeZone) : null;
      Object.assign(params, { startDate: start.date, startTime: start.time, endDate: end?.date, endTime: end?.time });
    }
    this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
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
      if (state.audioEnabled && state.focused === this.name) void this.startAudioStream();
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

  async startAudioStream() {
    this.stopAudioStream();
    if (this.stopped || state.allStopped || !state.audioEnabled || state.focused !== this.name) return;
    if (state.mode === 'playback' && !state.reviewStart) return;
    const token = ++this.audioStreamToken;
    const controller = new AbortController();
    this.audioAbortController = controller;
    const params = { server: state.serverId, camera: this.name, mode: state.mode, audioOnly: '1' };
    if (state.mode === 'live') params.profile = this.profile;
    else if (state.mode === 'playback') {
      const start = epochToApi(state.reviewEpoch ?? state.reviewStart, state.server.timeZone);
      const end = state.reviewEnd ? epochToApi(state.reviewEnd, state.server.timeZone) : null;
      Object.assign(params, { startDate: start.date, startTime: start.time, endDate: end?.date, endTime: end?.time });
    }
    try {
      const response = await fetch(`/api/audio-stream?${query(params)}`, { signal: controller.signal, cache: 'no-store' });
      if (token !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
      if (!response.ok || !response.body || !(response.headers.get('content-type') || '').toLowerCase().includes('multipart/')) {
        let message = 'Não foi possível abrir o áudio desta câmera.';
        try { message = (await response.json()).error || message; } catch {}
        throw new Error(message);
      }
      void consumeMultipart(response, part => {
        if (token === this.audioStreamToken && state.audioEnabled && state.focused === this.name) this.consumePart(part, true);
      }).catch(error => {
        if (error.name === 'AbortError' || token !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
        this.setMessage(error.message || 'Erro ao receber áudio.');
      });
    } catch (error) {
      if (error.name === 'AbortError' || token !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
      this.setMessage(error.message || 'Não foi possível abrir o áudio desta câmera.');
    }
  }

  stopAudioStream() {
    this.audioStreamToken += 1;
    this.audioAbortController?.abort();
    this.audioAbortController = null;
    try { this.audioDecoder?.close(); } catch {}
    this.audioDecoder = null;
    try { this.g726?.free(); } catch {}
    this.g726 = null;
    this.g726Config = null;
    this.g726DecodeChain = Promise.resolve();
  }

  stop(clear = true) {
    this.stopped = true;
    this.requestToken += 1;
    this.stopAudioStream();
    this.abortController?.abort();
    this.abortController = null;
    this.clearVideoDecoder();
    this.activeVideoCodec = '';
    this.videoCodecEpoch += 1;
    try { this.audioDecoder?.close(); } catch {}
    try { this.g726?.free(); } catch {}
    this.hevcParameterSets.clear();
    this.hevcDecodeChain = Promise.resolve();
    this.audioDecoder = null;
    this.g726 = null;
    this.g726Config = null;
    this.videoEpoch = null;
    this.audioEpoch = null;
    if (clear && this.context) this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setState(label) {
    const recording = state.recordings.get(this.name);
    const base = state.mode === 'live' ? 'Ao vivo' : 'Gravado';
    if (recording?.status === 'recording') label = `${base} (capturando)`;
    else if (recording?.status === 'paused') label = `${base} (pausado)`;
    this.tile.querySelector('.tile-state-text').textContent = label;
  }
  setMessage(message) {
    const node = this.tile.querySelector('.tile-message');
    node.textContent = message;
    node.hidden = !message;
  }

  consumePart(part, audioOnly = false) {
    const type = `${part.headers['dgf-frametype'] || ''} ${part.headers['content-type'] || ''}`.toLowerCase();
    if (audioOnly && !/audio|g\.?726|alaw|mulaw|ulaw/i.test(type)) return;
    const epoch = parseFrameEpoch(part.headers);
    if (state.mode === 'playback' && this.name === state.focused && epoch !== null) updateTimelinePlayhead(epoch);
    if (epoch) this.tile.querySelector('.tile-timecode').textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: state.server.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(epoch);
    if (type.includes('jpeg') || part.headers['content-type']?.toLowerCase().includes('image/jpeg')) {
      this.drawJpeg(part.data);
      this.frameCount += 1;
      this.setMessage('');
      this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
      return;
    }
    if (type.includes('h.264') || type.includes('h264') || part.headers['content-type']?.toLowerCase().includes('video/h264')) {
      this.decodeH264(part.data, type.includes('i-frame') || type.includes('iframe'), epoch);
      return;
    }
    if (type.includes('h.265') || type.includes('h265') || type.includes('hevc')) {
      this.decodeH265(part.data, type, epoch);
      return;
    }
    if (/g\.?726/i.test(type)) {
      if (state.audioEnabled && state.focused === this.name) this.decodeG726(part.data, type, epoch, part.headers);
      return;
    }
    if (type.includes('audio/basic') || type.includes('audio/alaw') || type.includes('audio/mulaw') || type.includes('audio/ulaw')) {
      if (state.audioEnabled && state.focused === this.name) this.decodeWebAudio(part.data, type, epoch);
      return;
    }
    if (type.includes('audio/aac')) {
      if (state.audioEnabled && state.focused === this.name) this.decodeAac(part.data, epoch);
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
    if (this.activeVideoCodec !== 'h264') {
      this.clearVideoDecoder();
      this.hevcParameterSets.clear();
      this.activeVideoCodec = 'h264';
      this.videoCodecEpoch += 1;
    }
    const bytes = normalizeAnnexB(data);
    const sps = findNal(bytes, 7);
    if (!this.videoDecoder && sps && sps.length >= 4) {
      const codec = `avc1.${[sps[1], sps[2], sps[3]].map(value => value.toString(16).padStart(2, '0')).join('')}`;
      this.videoDecoder = this.createVideoDecoder(codec, 'H.264', this.requestToken);
      try { this.videoDecoder.configure({ codec, optimizeForLatency: true }); this.videoCodec = codec; }
      catch {
        this.clearVideoDecoder();
        this.setMessage('Perfil H.264 indisponível neste navegador.');
        this.setState('Codec incompatível');
        return;
      }
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

  decodeH265(data, type, epoch) {
    if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') {
      this.setMessage('Este navegador não oferece WebCodecs de vídeo. Use uma versão atual do Chromium ou Edge.');
      this.setState('Navegador incompatível');
      return;
    }
    const token = this.requestToken;
    if (this.activeVideoCodec !== 'h265') {
      this.clearVideoDecoder();
      this.hevcParameterSets.clear();
      this.activeVideoCodec = 'h265';
      this.videoCodecEpoch += 1;
    }
    const codecEpoch = this.videoCodecEpoch;
    this.hevcDecodeChain = this.hevcDecodeChain.then(async () => {
      if (this.stopped || token !== this.requestToken || codecEpoch !== this.videoCodecEpoch) return;
      await this.processH265(data, type, epoch, token, codecEpoch);
    }).catch(() => {
      if (!this.stopped && token === this.requestToken && codecEpoch === this.videoCodecEpoch) {
        this.setMessage('Não foi possível preparar ou decodificar o frame H.265 recebido.');
        this.setState('Codec incompatível');
      }
    });
  }

  async processH265(data, type, epoch, token, codecEpoch) {
    const bytes = normalizeHevcAnnexB(data);
    const nals = splitAnnexBNals(bytes);
    for (const nal of nals) {
      const nalType = (nal[0] >> 1) & 0x3f;
      if (nalType >= 32 && nalType <= 34) this.hevcParameterSets.set(nalType, nal);
    }

    const sps = this.hevcParameterSets.get(33);
    const randomAccess = nals.some(nal => {
      const nalType = (nal[0] >> 1) & 0x3f;
      return nalType >= 16 && nalType <= 21;
    });
    if (!sps) {
      this.setMessage('Os frames recebidos não contêm um SPS H.265 válido em formato Annex B.');
      this.setState('Aguardando H.265');
      return;
    }

    let codec;
    try { codec = hevcCodecString(sps); }
    catch {
      this.setMessage('Não foi possível identificar o perfil e nível do stream H.265.');
      this.setState('Codec incompatível');
      return;
    }

    const keyFrame = randomAccess;
    if (!this.hevcHasRandomAccess && !keyFrame) {
      this.setMessage('Aguardando um quadro-chave H.265 (IDR, CRA ou BLA).');
      this.setState('Aguardando H.265');
      return;
    }

    if (!this.videoDecoder) {
      const missing = [32, 33, 34].filter(nalType => !this.hevcParameterSets.has(nalType));
      if (missing.length) {
        this.setMessage(`Aguardando parâmetros H.265 necessários (NAL ${missing.join(', ')}).`);
        this.setState('Aguardando H.265');
        return;
      }
      const config = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true });
      if (this.stopped || token !== this.requestToken || codecEpoch !== this.videoCodecEpoch) return;
      if (!config.supported) {
        this.setMessage(`Este navegador não suporta o perfil H.265 ${codec}.`);
        this.setState('Codec incompatível');
        return;
      }
      this.videoDecoder = this.createVideoDecoder(codec, 'H.265', token);
      this.videoCodec = codec;
      try { this.videoDecoder.configure(config.config); }
      catch {
        try { this.videoDecoder.close(); } catch {}
        this.videoDecoder = null;
        this.videoCodec = '';
        this.setMessage(`Não foi possível configurar o decoder H.265 ${codec}.`);
        this.setState('Codec incompatível');
        return;
      }
    } else if (this.videoCodec !== codec) {
      this.setMessage('O perfil H.265 mudou durante o stream; reinicie a câmera para reconfigurar o decoder.');
      this.setState('Codec incompatível');
      return;
    }

    let accessUnit = bytes;
    if (keyFrame) accessUnit = prependMissingHevcParameterSets(bytes, nals, this.hevcParameterSets);
    const timestamp = this.mediaTimestamp(epoch, 'video');
    try {
      if (this.videoDecoder.decodeQueueSize < 14) {
        this.videoDecoder.decode(new EncodedVideoChunk({ type: keyFrame ? 'key' : 'delta', timestamp, data: accessUnit }));
        if (keyFrame) this.hevcHasRandomAccess = true;
      }
    } catch {
      this.hevcHasRandomAccess = false;
      this.setMessage('O navegador rejeitou um frame H.265. Verifique o formato do stream e os parâmetros VPS/SPS/PPS.');
      this.setState('Codec incompatível');
    }
  }

  createVideoDecoder(codec, label, token) {
    const generation = ++this.videoDecoderGeneration;
    return new VideoDecoder({
      output: frame => {
        if (this.stopped || token !== this.requestToken || generation !== this.videoDecoderGeneration) { frame.close(); return; }
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
        }
        this.context.drawImage(frame, 0, 0, this.canvas.width, this.canvas.height);
        frame.close();
        this.frameCount += 1;
        this.setMessage('');
        this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
        this.tile.querySelector('.tile-codec').textContent = codec.toUpperCase();
      },
      error: () => {
        if (this.stopped || token !== this.requestToken || generation !== this.videoDecoderGeneration) return;
        this.clearVideoDecoder();
        this.setMessage(`O navegador não conseguiu decodificar o perfil ${label} desta câmera.`);
        this.setState('Codec incompatível');
      }
    });
  }

  clearVideoDecoder() {
    this.videoDecoderGeneration += 1;
    try { this.videoDecoder?.close(); } catch {}
    this.videoDecoder = null;
    this.videoCodec = '';
    this.hevcHasRandomAccess = false;
  }

  mediaTimestamp(epoch, kind) {
    if (epoch === null) return kind === 'video' ? (this.frameCount * 40000) : (this.audioCount * 20000);
    let base = kind === 'video' ? this.videoEpoch : this.audioEpoch;
    if (base === null) {
      base = state.mode === 'playback' && state.reviewStart ? (state.reviewEpoch ?? state.reviewStart) : epoch;
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
    const audioToken = this.audioStreamToken;
    const config = getG726Config(headers, type);
    this.g726DecodeChain = this.g726DecodeChain.then(async () => {
      if (this.stopped || token !== this.requestToken || audioToken !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
      if (!config.rate) {
        this.setMessage('O frame G.726 não informa uma taxa reconhecida (16, 24, 32 ou 40 kb/s).');
        this.setState('Taxa G.726 desconhecida');
        return;
      }
      const Decoder = await loadG726Decoder();
      if (this.stopped || token !== this.requestToken || audioToken !== this.audioStreamToken || !state.audioEnabled || state.focused !== this.name) return;
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
      this.setState(state.mode === 'live' ? 'Ao vivo' : 'Gravado');
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
    if (!state.audioContext || !state.audioEnabled || state.focused !== this.name) return;
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
      for (const recording of state.recordings.values()) {
        if (recording.camera === this.name && recording.destination) source.connect(recording.destination);
      }
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

function splitAnnexBNals(bytes) {
  const starts = [];
  for (let i = 0; i + 2 < bytes.length;) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push({ start: i, data: i + 3 });
      i += 3;
    } else if (i + 3 < bytes.length && bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
      starts.push({ start: i, data: i + 4 });
      i += 4;
    } else i += 1;
  }
  return starts.map((start, index) => {
    const end = starts[index + 1]?.start ?? bytes.length;
    let trimmedEnd = end;
    while (trimmedEnd > start.data && bytes[trimmedEnd - 1] === 0) trimmedEnd -= 1;
    return bytes.subarray(start.data, trimmedEnd);
  }).filter(nal => nal.length >= 2);
}

function normalizeHevcAnnexB(data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  for (let i = 0; i + 3 < bytes.length; i += 1) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && (bytes[i + 2] === 1 || (bytes[i + 2] === 0 && bytes[i + 3] === 1))) return bytes;
  }
  const nals = [];
  let offset = 0;
  let lengthPrefixed = bytes.length >= 6 && bytes[0] === 0 && bytes[1] === 0;
  while (lengthPrefixed && offset + 4 <= bytes.length) {
    const length = bytes[offset] * 0x1000000 + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
    offset += 4;
    if (!length || offset + length > bytes.length) { lengthPrefixed = false; break; }
    nals.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  if (lengthPrefixed && nals.length && offset === bytes.length) {
    const result = new Uint8Array(nals.reduce((total, nal) => total + 4 + nal.length, 0));
    let cursor = 0;
    for (const nal of nals) {
      result.set([0, 0, 0, 1], cursor);
      cursor += 4;
      result.set(nal, cursor);
      cursor += nal.length;
    }
    return result;
  }
  return normalizeAnnexB(bytes);
}

function hevcCodecString(sps) {
  if (sps.length < 4 || ((sps[0] >> 1) & 0x3f) !== 33 || (sps[0] & 0x80) !== 0 || (sps[1] & 0x07) === 0) throw new Error('Invalid HEVC SPS');
  const rbsp = [];
  let zeros = 0;
  for (const value of sps.subarray(2)) {
    if (zeros >= 2 && value === 3) { zeros = 0; continue; }
    rbsp.push(value);
    zeros = value === 0 ? zeros + 1 : 0;
  }
  let bitOffset = 0;
  const readBits = count => {
    if (bitOffset + count > rbsp.length * 8) throw new Error('Truncated HEVC SPS');
    let value = 0n;
    for (let i = 0; i < count; i += 1) {
      const byte = rbsp[bitOffset >> 3];
      const bit = (byte >> (7 - (bitOffset & 7))) & 1;
      value = (value << 1n) | BigInt(bit);
      bitOffset += 1;
    }
    return value;
  };
  const skipBits = count => { readBits(count); };

  skipBits(4); // sps_video_parameter_set_id
  const maxSubLayersMinus1 = Number(readBits(3));
  skipBits(1); // sps_temporal_id_nesting_flag
  const profileSpace = Number(readBits(2));
  const tierFlag = Number(readBits(1));
  const profileIdc = Number(readBits(5));
  const compatibilityBits = readBits(32);
  const constraintBits = readBits(48);
  const levelIdc = Number(readBits(8));
  const subLayerProfilePresent = [];
  const subLayerLevelPresent = [];
  for (let i = 0; i < maxSubLayersMinus1; i += 1) {
    subLayerProfilePresent.push(Number(readBits(1)) === 1);
    subLayerLevelPresent.push(Number(readBits(1)) === 1);
  }
  if (maxSubLayersMinus1 > 0) skipBits((8 - maxSubLayersMinus1) * 2);
  for (let i = 0; i < maxSubLayersMinus1; i += 1) {
    if (subLayerProfilePresent[i]) skipBits(2 + 1 + 5 + 32 + 48);
    if (subLayerLevelPresent[i]) skipBits(8);
  }

  const compatibility = compatibilityBits.toString(2).padStart(32, '0').split('').reverse().join('');
  const compatibilityHex = BigInt(`0b${compatibility}`).toString(16);
  const constraints = constraintBits.toString(16).padStart(12, '0').toUpperCase().replace(/(?:00)+$/, '');
  const spacePrefix = profileSpace === 0 ? '' : String.fromCharCode(64 + profileSpace);
  return `hev1.${spacePrefix}${profileIdc}.${compatibilityHex}.${tierFlag ? 'H' : 'L'}${levelIdc}${constraints ? `.${constraints}` : ''}`;
}

function prependMissingHevcParameterSets(bytes, nals, parameterSets) {
  const included = new Set(nals.map(nal => (nal[0] >> 1) & 0x3f));
  const missing = [32, 33, 34].filter(type => !included.has(type)).map(type => parameterSets.get(type)).filter(Boolean);
  if (!missing.length) return bytes;
  const prefixLength = missing.reduce((total, nal) => total + nal.length + 4, 0);
  const result = new Uint8Array(prefixLength + bytes.length);
  let offset = 0;
  for (const nal of missing) {
    result.set([0, 0, 0, 1], offset);
    offset += 4;
    result.set(nal, offset);
    offset += nal.length;
  }
  result.set(bytes, offset);
  return result;
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
  if (oldSource && oldSource !== newSource) state.tiles.get(oldSource)?.stopAudioStream();
  if (state.allStopped || !state.audioEnabled || !newSource || newSource === oldSource) return;
  await state.tiles.get(newSource)?.startAudioStream();
}

function clearTimeline() {
  state.timelineRequestId++;
  for (const controller of state.timelineControllers) controller.abort();
  state.timelineControllers = [];
  state.timelineData.clear();
  state.timelineStart = state.timelineEnd = null;
  elements.timelineNames.replaceChildren();
  elements.timelineTracks.replaceChildren();
  elements.timelineRuler.replaceChildren();
  elements.timelineDays.replaceChildren();
  elements.timelinePlayhead.hidden = true;
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

async function loadTimeline(camera) {
  const requestId = state.timelineRequestId;
  const controller = new AbortController();
  state.timelineControllers.push(controller);
  const start = epochToApi(state.timelineStart, state.server.timeZone);
  const end = epochToApi(state.timelineEnd, state.server.timeZone);
  const data = state.timelineData.get(camera);
  try {
    const response = await fetch(`/api/timeline?${query({ server: state.serverId, camera, startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time })}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw new Error('Não foi possível carregar a timeline.');
    let scheduled = false;
    await consumeMultipart(response, part => {
      if (requestId !== state.timelineRequestId) return;
      const parsed = parseTimelinePart(part);
      if (!parsed || !Number.isFinite(parsed.start) || !Number.isFinite(parsed.end) || parsed.end < parsed.start) return;
      data.push(parsed);
      if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; if (requestId === state.timelineRequestId) drawTimeline(); }); }
    });
    if (requestId === state.timelineRequestId) { drawTimeline(); elements.timelineStatus.textContent = `Disponibilidade carregada para ${camera}.`; }
  } catch (error) {
    if (requestId === state.timelineRequestId && error.name !== 'AbortError') { elements.timelineStatus.textContent = `Não foi possível carregar a timeline de ${camera}.`; toast(elements.timelineStatus.textContent, 'error'); }
  } finally { state.timelineControllers = state.timelineControllers.filter(item => item !== controller); }
}

let timelineDayCache = { key: '', days: [] };
function timelineDayBoundaries(start, end, timeZone) {
  const key = `${start}|${end}|${timeZone}`;
  if (timelineDayCache.key === key) return timelineDayCache.days;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const dayNumber = epoch => {
    const parts = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day) / 86400000;
  };
  const days = [];
  for (let day = dayNumber(start) + 1, last = dayNumber(end); day <= last; day++) {
    let low = start, high = end;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (dayNumber(middle) >= day) high = middle; else low = middle;
    }
    if (high > start && high <= end) days.push(high);
  }
  timelineDayCache = { key, days };
  return days;
}

function drawTimeline() {
  const start = state.timelineStart, end = state.timelineEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const span = end - start;
  elements.timelineNames.replaceChildren();
  for (const camera of state.timelineData.keys()) {
    const name = document.createElement('div'); name.className = 'timeline-camera-name'; name.textContent = camera; name.title = camera; elements.timelineNames.append(name);
  }
  elements.timelineContent.style.width = `${state.timelineZoom * 100}%`;
  elements.timelineRuler.replaceChildren();
  const ticks = Math.max(1, Math.floor(elements.timelineContent.clientWidth / 90));
  for (let tick = 0; tick <= ticks; tick++) {
    const mark = document.createElement('span'); mark.className = 'ruler-tick';
    if (!tick) mark.dataset.edge = 'start'; if (tick === ticks) mark.dataset.edge = 'end';
    mark.style.left = `${tick / ticks * 100}%`;
    mark.textContent = formatClock(start + span * tick / ticks);
    elements.timelineRuler.append(mark);
  }
  elements.timelineDays.replaceChildren();
  for (const epoch of timelineDayBoundaries(start, end, state.server.timeZone)) {
    const marker = document.createElement('span'); marker.className = 'timeline-day';
    marker.style.left = `${(epoch - start) / span * 100}%`;
    const label = document.createElement('span'); label.textContent = new Intl.DateTimeFormat('pt-BR', { timeZone: state.server.timeZone, day: '2-digit', month: '2-digit', year: 'numeric' }).format(epoch);
    marker.title = `Início de ${label.textContent}`; marker.append(label); elements.timelineDays.append(marker);
  }
  const dayRects = [...elements.timelineDays.querySelectorAll('.timeline-day > span')].map(label => label.getBoundingClientRect());
  for (const tick of elements.timelineRuler.children) {
    const rect = tick.getBoundingClientRect();
    if (dayRects.some(day => rect.left < day.right + 4 && rect.right > day.left - 4)) tick.style.visibility = 'hidden';
  }
  elements.timelineTracks.replaceChildren();
  for (const [camera, data] of state.timelineData) {
    const row = document.createElement('div'); row.className = 'timeline-camera-tracks';
    const video = document.createElement('div'), audio = document.createElement('div');
    video.className = 'track-lane'; audio.className = 'track-lane audio-lane';
    video.title = `Vídeo: ${camera}`; audio.title = `Áudio: ${camera}`;
    for (const item of data) {
      const lane = item.kind === 'video' ? video : item.kind === 'audio' ? audio : null;
      if (!lane || item.end < start || item.start > end) continue;
      const segment = document.createElement('span'); segment.className = `track-segment${item.kind === 'audio' ? ' audio' : ''}`;
      const left = Math.max(0, (item.start - start) / span * 100), right = Math.min(100, (item.end - start) / span * 100);
      segment.style.left = `${left}%`; segment.style.width = `${Math.max(0, right - left)}%`;
      segment.title = `${item.kind === 'audio' ? 'Áudio' : 'Vídeo'}: ${formatClock(item.start)}–${formatClock(item.end)}`;
      lane.append(segment);
    }
    for (const lane of [video, audio]) lane.addEventListener('click', event => { if (!state.timelineDragged) seekFromTimeline(event, lane); });
    row.append(video, audio); elements.timelineTracks.append(row);
  }
  updateTimelinePlayhead();
}
function seekFromTimeline(event, lane) {
  const rect = lane.getBoundingClientRect();
  seekReview(state.timelineStart + (state.timelineEnd - state.timelineStart) * Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
}
function updateTimelinePlayhead(epoch = state.reviewEpoch) {
  if (Number.isFinite(epoch) && Number.isFinite(state.reviewStart)) state.reviewEpoch = Math.max(state.reviewStart, Math.min(state.reviewLimitEnd ?? state.reviewEnd ?? state.timelineEnd ?? Date.now(), epoch));
  if (!Number.isFinite(epoch) || !Number.isFinite(state.timelineStart) || !Number.isFinite(state.timelineEnd) || state.timelineEnd <= state.timelineStart) { elements.timelinePlayhead.hidden = true; return; }
  state.reviewEpoch = Math.max(state.timelineStart, Math.min(state.timelineEnd, epoch));
  const fraction = (state.reviewEpoch - state.timelineStart) / (state.timelineEnd - state.timelineStart);
  elements.timelinePlayhead.style.left = `${fraction * 100}%`;
  elements.timelinePlayhead.title = `Gravação em ${formatClock(epoch)}`; elements.timelinePlayhead.hidden = false;
}
function setTimelineZoom(zoom, clientX) {
  const scroll = elements.timelineScroll;
  const pointerX = Math.max(0, Math.min(scroll.clientWidth, clientX - scroll.getBoundingClientRect().left));
  const fraction = (scroll.scrollLeft + pointerX) / scroll.scrollWidth;
  state.timelineZoom = Math.max(1, Math.min(32, zoom));
  scroll.classList.toggle('is-zoomed', state.timelineZoom > 1);
  drawTimeline();
  scroll.scrollLeft = state.timelineZoom === 1 ? 0 : fraction * scroll.scrollWidth - pointerX;
}
elements.timelineScroll.addEventListener('wheel', event => {
  if (!Number.isFinite(state.timelineStart) || !event.deltaY) return;
  event.preventDefault();
  setTimelineZoom(state.timelineZoom * (event.deltaY < 0 ? 1.25 : 1 / 1.25), event.clientX);
}, { passive: false });
let timelineDrag = null;
elements.timelineScroll.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !event.isPrimary) return;
  timelineDrag = { x: event.clientX, y: event.clientY, left: elements.timelineScroll.scrollLeft, pointerId: event.pointerId };
  state.timelineDragged = false;
  elements.timelineScroll.classList.add('is-pressed');
  timelineDrag.holdTimer = setTimeout(() => elements.timelineScroll.classList.add('is-holding'), 350);
});
window.addEventListener('pointermove', event => {
  if (!timelineDrag || event.pointerId !== timelineDrag.pointerId) return;
  const delta = event.clientX - timelineDrag.x;
  if (state.timelineZoom > 1 && !state.timelineDragged && Math.hypot(delta, event.clientY - timelineDrag.y) > 3) {
    state.timelineDragged = true;
    clearTimeout(timelineDrag.holdTimer);
    elements.timelineScroll.classList.add('is-dragging');
    elements.timelineScroll.setPointerCapture(event.pointerId);
  }
  if (state.timelineDragged) elements.timelineScroll.scrollLeft = timelineDrag.left - delta;
});
function endTimelineDrag(event) {
  if (!timelineDrag || event.pointerId !== timelineDrag.pointerId) return;
  clearTimeout(timelineDrag.holdTimer);
  timelineDrag = null;
  elements.timelineScroll.classList.remove('is-pressed', 'is-holding', 'is-dragging');
  setTimeout(() => { state.timelineDragged = false; }, 0);
}
window.addEventListener('pointerup', endTimelineDrag);
window.addEventListener('pointercancel', endTimelineDrag);
let thumbnailResizeTimer;
window.addEventListener('resize', () => {
  if (state.timelineVisible && state.mode === 'playback') drawTimeline();
  if (state.thumbnailActive) { clearTimeout(thumbnailResizeTimer); thumbnailResizeTimer = setTimeout(() => { if (!state.thumbnailActive) return; state.thumbnailAnchor = state.thumbnails[0] ?? state.thumbnailAnchor; void renderThumbnailPage(0); }, 150); }
});

function formatClock(epoch) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: state.server?.timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(epoch);
}

async function toggleAllStreams() {
  if (!state.tiles.size) return;
  if (!state.allStopped) {
    await Promise.all(requestStopRecordingSession());
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

function cancelThumbnailPage() {
  state.thumbnailRequestId += 1;
  for (const controller of state.thumbnailControllers) controller.abort();
  state.thumbnailControllers.clear();
  state.thumbnails = [];
  elements.thumbnailGrid.replaceChildren();
}

function clearThumbnails() {
  cancelThumbnailPage();
  for (const url of state.thumbnailCache.values()) URL.revokeObjectURL(url);
  state.thumbnailCache.clear();
  state.thumbnailAnchor = null;
  state.thumbnailPage = 0;
}

const THUMBNAIL_INTERVALS = [
  [5, '5 segundos'], [10, '10 segundos'], [30, '30 segundos'], [60, '1 minuto'], [300, '5 minutos'],
  [600, '10 minutos'], [1800, '30 minutos'], [3600, '1 hora'], [10800, '3 horas'], [18000, '5 horas']
];

function createThumbnailMenu(camera) {
  const menu = document.createElement('div'); menu.className = 'context-submenu'; menu.setAttribute('role', 'menu');
  for (const [size, label] of [['small', 'Pequeno'], ['medium', 'Médio'], ['large', 'Grande']]) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'context-item thumbnail-size-item'; item.setAttribute('role', 'menuitemradio'); item.setAttribute('aria-checked', String(state.thumbnailSize === size)); item.textContent = label;
    item.addEventListener('click', () => { if (state.thumbnailSize !== size) clearThumbnails(); state.thumbnailSize = size; for (const other of menu.querySelectorAll('[role="menuitemradio"]')) other.setAttribute('aria-checked', String(other === item)); }); menu.append(item);
  }
  const separator = document.createElement('div'); separator.className = 'context-separator'; separator.setAttribute('role', 'separator'); menu.append(separator);
  for (const [index, [seconds, label]] of THUMBNAIL_INTERVALS.entries()) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'context-item'; item.setAttribute('role', 'menuitem'); item.textContent = label;
    if (camera === state.focused) {
      const hint = document.createElement('span'); hint.className = 'context-shortcut'; hint.textContent = `Ctrl+Shift+Alt+${(index + 1) % 10}`; item.append(hint);
    }
    item.disabled = !state.reviewStart;
    item.addEventListener('click', () => { closeContextMenu(); void openThumbnailView(camera, seconds); }); menu.append(item);
  }
  return menu;
}
async function openThumbnailView(camera, interval) {
  if (!state.reviewStart || !state.tiles.has(camera)) return;
  await leaveFullscreen();
  if (state.thumbnailCamera !== camera || state.thumbnailInterval !== interval) clearThumbnails();
  state.thumbnailCamera = camera; state.thumbnailInterval = interval;
  if (state.thumbnailAnchor === null) state.thumbnailAnchor = Math.max(state.reviewStart, Math.min(state.reviewLimitEnd ?? state.reviewEnd ?? state.timelineEnd ?? Date.now(), state.reviewEpoch ?? state.reviewStart));
  if (!state.thumbnailActive) { state.thumbnailWasStopped = state.allStopped; state.thumbnailTimelineVisible = state.timelineVisible; }
  state.thumbnailActive = true; elements.stopAll.disabled = true;
  updateOverlayState();
  await Promise.all(requestStopRecordingSession());
  if (!state.thumbnailActive) return;
  for (const player of state.tiles.values()) player.stop(false);
  elements.viewerGrid.classList.add('showing-thumbnails'); elements.thumbnailPanel.hidden = false;
  void renderThumbnailPage(state.thumbnailPage);
}
function closeThumbnailView(resume = true) {
  if (!state.thumbnailActive) return;
  state.thumbnailActive = false; clearThumbnails(); elements.thumbnailPanel.hidden = true; elements.viewerGrid.classList.remove('showing-thumbnails');
  setDisplayVisibility({ timeline: state.thumbnailTimelineVisible }); updateViewHeader();
  if (resume && !state.thumbnailWasStopped && state.mode === 'playback') for (const player of state.tiles.values()) void player.start();
}
async function renderThumbnailPage(page) {
  if (!state.thumbnailActive || !state.server || !state.reviewStart || !state.tiles.has(state.thumbnailCamera)) return;
  const camera = state.thumbnailCamera;
  const [width, height] = THUMBNAIL_SIZES[state.thumbnailSize] || THUMBNAIL_SIZES.large;
  const rect = elements.viewerGrid.getBoundingClientRect();
  const columns = Math.max(1, Math.floor((rect.width + 4) / (width + 4)));
  const rows = Math.max(1, Math.floor((rect.height + 4) / (height + 28)));
  const count = Math.max(1, columns * rows);
  elements.thumbnailGrid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  elements.thumbnailGrid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  const interval = state.thumbnailInterval * 1000, end = state.reviewLimitEnd ?? state.reviewEnd ?? state.timelineEnd ?? Date.now();
  const first = state.thumbnailAnchor + page * count * interval;
  state.thumbnailPage = page;
  const pageItems = Array.from({length: count}, (_, i) => first + i * interval).filter(epoch => epoch >= state.reviewStart && epoch <= end);
  cancelThumbnailPage(); const requestId = state.thumbnailRequestId; state.thumbnails = pageItems;
  elements.thumbnailPrev.disabled = !pageItems.length || pageItems[0] - interval < state.reviewStart;
  elements.thumbnailNext.disabled = !pageItems.length || pageItems[pageItems.length - 1] + interval > end;
  elements.thumbnailStatus.textContent = `Carregando ${pageItems.length} miniaturas de ${camera}.`;
  const cards = pageItems.map(epoch => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'thumbnail-card';
    card.dataset.loadState = 'loading';
    card.setAttribute('aria-busy', 'true');
    card.setAttribute('aria-label', `Revisar ${camera} a partir de ${formatClock(epoch)}`);
    const media = document.createElement('span');
    media.className = 'thumbnail-media';
    media.setAttribute('aria-hidden', 'true');
    const spinner = document.createElement('span');
    spinner.className = 'thumbnail-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    const image = document.createElement('img');
    image.alt = '';
    image.hidden = true;
    const placeholder = document.createElement('span');
    placeholder.className = 'thumbnail-placeholder';
    placeholder.textContent = 'Miniatura indisponível';
    placeholder.hidden = true;
    media.append(spinner, image, placeholder);
    const label = document.createElement('span');
    label.textContent = formatClock(epoch);
    card.append(media, label);
    card.addEventListener('click', () => { closeThumbnailView(false); state.allStopped = false; seekReview(epoch); updateViewHeader(); });
    elements.thumbnailGrid.append(card);
    return { epoch, card, image, spinner, placeholder };
  });
  let cursor = 0;
  const finishCard = (item, success) => {
    if (requestId !== state.thumbnailRequestId) return;
    item.card.dataset.loadState = success ? 'loaded' : 'error';
    item.card.setAttribute('aria-busy', 'false');
    item.spinner.hidden = true;
    item.image.hidden = !success;
    item.placeholder.hidden = success;
    if (!success) {
      item.card.disabled = true;
      item.card.setAttribute('aria-label', `Miniatura indisponível para ${camera} às ${formatClock(item.epoch)}`);
    }
  };
  const workers = Array.from({ length: Math.min(4, cards.length) }, async () => {
    while (requestId === state.thumbnailRequestId && cursor < cards.length) {
      const item = cards[cursor++];
      const cached = state.thumbnailCache.get(item.epoch);
      if (cached) {
        item.image.src = cached;
        finishCard(item, true);
        continue;
      }
      const controller = new AbortController();
      state.thumbnailControllers.add(controller);
      const api = epochToApi(item.epoch, state.server.timeZone);
      try {
        const [width, height] = THUMBNAIL_SIZES[state.thumbnailSize] || THUMBNAIL_SIZES.large;
        const response = await fetch(`/api/snapshot?${query({ server: state.serverId, camera, date: api.date, time: api.time, width, height })}`, { cache: 'no-store', signal: controller.signal });
        if (requestId !== state.thumbnailRequestId) continue;
        if (!response.ok) { finishCard(item, false); continue; }
        const blob = await response.blob();
        if (requestId !== state.thumbnailRequestId) continue;
        if (!blob.size || (blob.type && !blob.type.startsWith('image/'))) { finishCard(item, false); continue; }
        const objectUrl = URL.createObjectURL(blob);
        if (requestId !== state.thumbnailRequestId) { URL.revokeObjectURL(objectUrl); continue; }
        await new Promise(resolve => {
          const finish = success => {
            controller.signal.removeEventListener('abort', cancelled);
            if (success && requestId === state.thumbnailRequestId) state.thumbnailCache.set(item.epoch, objectUrl);
            else URL.revokeObjectURL(objectUrl);
            finishCard(item, success); resolve();
          };
          const cancelled = () => { URL.revokeObjectURL(objectUrl); resolve(); };
          controller.signal.addEventListener('abort', cancelled, { once: true });
          item.image.addEventListener('load', () => finish(true), { once: true });
          item.image.addEventListener('error', () => finish(false), { once: true });
          if (controller.signal.aborted) cancelled(); else item.image.src = objectUrl;
        });
      } catch (error) {
        if (requestId === state.thumbnailRequestId && error.name !== 'AbortError') finishCard(item, false);
      } finally {
        state.thumbnailControllers.delete(controller);
      }
    }
  });
  await Promise.all(workers);
  if (requestId !== state.thumbnailRequestId) return;
  const loaded = cards.filter(card => card.card.dataset.loadState === 'loaded').length;
  const failed = cards.length - loaded;
  elements.thumbnailStatus.textContent = loaded
    ? `${loaded} miniaturas carregadas${failed ? ` · ${failed} indisponíveis` : ''} · clique em uma miniatura para revisar daquele instante.`
    : 'Nenhuma miniatura encontrada nesta página.';
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
for (const input of [elements.startDateTime, elements.endDateTime]) input.addEventListener('change', clearThumbnails);
elements.recordFormat.addEventListener('change', updateRecordFormatHelp);
elements.recordForm.addEventListener('submit', event => {
  if (event.submitter?.value !== 'start') return;
  event.preventDefault();
  const scope = state.pendingRecordingScope;
  state.pendingRecordingScope = null;
  elements.recordDialog.close();
  if (scope) void changeRecordingState(scope, 'start');
});
elements.recordDialog.addEventListener('close', () => { state.pendingRecordingScope = null; });
elements.stopAll.addEventListener('click', toggleAllStreams);
function selectMosaic(id) {
  const next = getMosaic(id);
  if (!mosaicAllowed(next)) {
    elements.mosaicSelect.value = state.mosaic;
    toast('Esse mosaico excede o limite de câmeras do servidor.', 'error');
    return;
  }
  if (state.tiles.size > next.capacity) {
    elements.mosaicSelect.value = state.mosaic;
    const camerasToClose = state.tiles.size - next.capacity;
    toast(`Esse mosaico comporta até ${next.capacity} câmeras. Feche ${camerasToClose} ${camerasToClose === 1 ? 'câmera' : 'câmeras'} para selecioná-lo.`, 'error');
    return;
  }
  state.mosaic = next.id; elements.mosaicSelect.value = next.id; applyMosaic();
}
elements.mosaicSelect.addEventListener('change', event => selectMosaic(event.target.value));
elements.resetGrid.addEventListener('click', async () => {
  if (!state.serverId) return;
  elements.resetGrid.disabled = true;
  try {
    await Promise.all(requestStopRecordingSession());
    await selectServer(state.serverId);
  } finally { elements.resetGrid.disabled = false; }
});
elements.overlayToggle.addEventListener('click', () => {
  const showAll = !(state.overlaysVisible && state.timelineVisible);
  setDisplayVisibility({ overlays: showAll, timeline: showAll });
});
elements.displayMenuToggle.addEventListener('click', () => elements.displayMenu.hidden ? openDisplayMenu() : closeDisplayMenu());
elements.toggleOverlayVisibility.addEventListener('click', () => { setDisplayVisibility({ overlays: !state.overlaysVisible }); closeDisplayMenu(true); });
elements.toggleTimelineVisibility.addEventListener('click', () => { setDisplayVisibility({ timeline: !state.timelineVisible }); closeDisplayMenu(true); });
elements.displayMenu.addEventListener('keydown', event => {
  const items = [...elements.displayMenu.querySelectorAll('[role="menuitemcheckbox"]')];
  const index = items.indexOf(event.target.closest('[role="menuitemcheckbox"]'));
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  }
  if (event.key === 'Escape') { event.preventDefault(); closeDisplayMenu(true); }
});
elements.surveillanceToggle.addEventListener('click', () => { void toggleSurveillance(); });
elements.audioSource.addEventListener('change', event => {
  focusCamera(event.target.value);
});
elements.audioToggle.addEventListener('click', async () => {
  if (!state.audioContext) state.audioContext = new AudioContext();
  try { await state.audioContext.resume(); } catch {}
  state.audioContextStart = state.audioContext.currentTime + 0.08;
  state.audioEnabled = !state.audioEnabled;
  updateAudioSources();
  const source = state.focused;
  if (!state.allStopped && source && state.tiles.has(source)) {
    const player = state.tiles.get(source);
    if (state.audioEnabled) await player.startAudioStream();
    else player.stopAudioStream();
  }
});
elements.thumbnailPrev.addEventListener('click', () => renderThumbnailPage(state.thumbnailPage - 1));
elements.thumbnailNext.addEventListener('click', () => renderThumbnailPage(state.thumbnailPage + 1));
const shortcutDialog = $('#shortcutDialog');
$('#openShortcuts').addEventListener('click', () => shortcutDialog.showModal());
for (const dialog of document.querySelectorAll('dialog')) {
  let backdropDown = false;
  const outside = event => { const rect = dialog.getBoundingClientRect(); return event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom); };
  dialog.addEventListener('pointerdown', event => { backdropDown = outside(event); });
  dialog.addEventListener('click', event => {
    if (!backdropDown || !outside(event)) return;
    backdropDown = false;
    if (dialog === elements.configDialog) void closeConfigDialog();
    else dialog.close();
  });
}

const controlShortcuts = [
  [elements.stopAll, 'Espaço', 'Space'], [elements.surveillanceToggle, 'V', 'V'],
  [elements.audioToggle, 'A', 'A'], [elements.liveMode, 'G', 'G'], [elements.reviewMode, 'G', 'G'],
  [elements.resetGrid, 'Ctrl+Alt+R', 'Control+Alt+R'], [elements.cameraSearch, '/', '/']
];
for (const [control, display, key] of controlShortcuts) {
  control.setAttribute('aria-keyshortcuts', key);
  control.setAttribute('aria-description', `Atalho: ${display}`);
  const label = control.title || control.textContent.trim() || control.getAttribute('aria-label') || 'Atalho';
  if (!label.includes(`· ${display}`)) control.title = `${label} · ${display}`;
}

document.addEventListener('keydown', event => {
  if (event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.code === 'KeyP') { event.preventDefault(); return; }
  if (event.key === 'Escape' && document.activeElement === elements.cameraSearch) {
    elements.cameraSearch.value = ''; drawCameraList(); elements.cameraSearch.blur(); return;
  }
  if (event.defaultPrevented || event.repeat || document.querySelector('dialog[open]') ||
      event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"])') ||
      !elements.displayMenu.hidden) return;
  if (event.ctrlKey && event.shiftKey && event.altKey && !event.metaKey && /^Digit[0-9]$/.test(event.code)) {
    const digit = Number(event.code.slice(-1));
    const interval = THUMBNAIL_INTERVALS[digit === 0 ? 9 : digit - 1];
    if (interval && state.mode === 'playback' && state.reviewStart && state.tiles.has(state.focused)) {
      event.preventDefault(); closeContextMenu(); void openThumbnailView(state.focused, interval[0]);
    }
    return;
  }
  if (event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey && !event.getModifierState('AltGraph')) {
    if (event.code === 'KeyR') { event.preventDefault(); closeContextMenu(); if (!elements.resetGrid.disabled) elements.resetGrid.click(); return; }
    const digit = /^Digit[0-9]$/.test(event.code) ? Number(event.code.slice(-1)) : null;
    const index = event.code === 'KeyA' ? 0 : digit === 0 ? 10 : digit;
    if (index !== null && MOSAICS[index]) { event.preventDefault(); selectMosaic(MOSAICS[index].id); }
    return;
  }
  if (event.target.closest('select')) return;
  if (event.ctrlKey && !event.altKey && !event.metaKey && /^Digit[0-9]$/.test(event.code)) {
    const camera = !elements.contextMenu.hidden && !event.shiftKey ? state.contextCamera : state.focused;
    if (!camera || (event.shiftKey && !state.tiles.has(camera))) return;
    const digit = Number(event.code.slice(-1));
    const entry = PLAYBACK_SHORTCUTS.filter(item => item && item[1] !== null)[digit === 0 ? 9 : digit - 1];
    if (!entry) return;
    event.preventDefault();
    closeContextMenu();
    void beginContextPlayback({ camera, all: event.shiftKey }, entry[1]);
    return;
  }
  if (event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'PrintScreen') {
    if (!state.focused) return;
    event.preventDefault();
    closeContextMenu();
    void captureFrames({ camera: state.focused, all: event.shiftKey });
    return;
  }
  if (!elements.contextMenu.hidden || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  if (state.thumbnailActive && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    const button = event.key === 'ArrowLeft' ? elements.thumbnailPrev : elements.thumbnailNext;
    event.preventDefault(); if (!button.disabled) button.click(); return;
  }
  if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
      (event.target === document.body || event.target === document.documentElement)) {
    const rows = [...elements.cameraList.querySelectorAll('.camera-row:not(:disabled)')];
    const row = event.key === 'ArrowDown' ? rows[0] : rows[rows.length - 1];
    if (row) { event.preventDefault(); row.focus(); }
    return;
  }
  // Space on a camera controls all streams; other controls retain native activation.
  if (event.key === ' ' && event.target.closest('button, [role="button"], a') && !event.target.closest('.camera-row')) return;
  const key = event.key.toLowerCase();
  const actions = {
    '/': () => elements.cameraSearch.focus(),
    ' ': () => { if (!elements.stopAll.disabled) elements.stopAll.click(); },
    v: () => elements.surveillanceToggle.click(),
    a: () => { if (!elements.audioToggle.disabled) elements.audioToggle.click(); },
    g: () => setMode(state.mode === 'live' ? 'playback' : 'live'),
    t: () => setDisplayVisibility({ timeline: !state.timelineVisible }),
    d: () => setDisplayVisibility({ overlays: !state.overlaysVisible }),
    f: () => { const names = [...elements.viewerGrid.querySelectorAll('.camera-tile')].map(tile => tile.dataset.camera); if (names.length) focusCamera(names[(names.indexOf(state.focused) + 1) % names.length]); }
  };
  if (actions[key]) { event.preventDefault(); actions[key](); }
});

setupMosaics();
updateOverlayState();
clockTick();
window.setInterval(clockTick, 1000);
initializeServers();

function setupDatePicker(input) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'date-picker-toggle';
  button.setAttribute('aria-label', `Escolher ${input.id === 'startDateTime' ? 'início' : 'fim'} da revisão`);
  button.setAttribute('aria-expanded', 'false'); button.textContent = '▦';
  input.insertAdjacentElement('afterend', button);
  const panel = document.createElement('div');
  panel.className = 'date-picker'; panel.hidden = true;
  panel.innerHTML = '<div class="date-picker-heading"><button type="button" data-shift="-1" aria-label="Mês anterior">‹</button><strong></strong><button type="button" data-shift="1" aria-label="Próximo mês">›</button></div><div class="date-picker-week" aria-hidden="true"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div><div class="date-picker-days"></div><div class="date-picker-footer"><div class="date-picker-time" role="group" aria-label="Horário"><input type="number" min="0" max="23" step="1" aria-label="Hora"><span aria-hidden="true">:</span><input type="number" min="0" max="59" step="1" aria-label="Minuto"><span aria-hidden="true">:</span><input type="number" min="0" max="59" step="1" aria-label="Segundo"></div><button type="button" class="date-picker-done">Confirmar</button></div><p class="date-picker-error" role="status"></p>';
  document.body.append(panel);
  let year, month, selected;
  const time = [...panel.querySelectorAll('.date-picker-time input')];
  const confirm = panel.querySelector('.date-picker-done');
  const error = panel.querySelector('.date-picker-error');
  const candidate = () => {
    if (!selected || time.some(field => field.value === '' || !field.validity.valid)) return '';
    return `${selected}T${time.map(field => field.value.padStart(2, '0')).join(':')}`;
  };
  const validate = () => {
    let message = '';
    const value = candidate();
    if (!value) message = 'Escolha uma data e um horário válidos.';
    else {
      try {
        const zone = state.server?.timeZone;
        const current = zone ? inputToEpoch(value, zone) : value;
        const otherValue = input === elements.endDateTime ? elements.startDateTime.value : elements.endDateTime.value;
        let other = null;
        if (otherValue) {
          try { other = zone ? inputToEpoch(otherValue, zone) : otherValue; } catch { /* Manual entry is validated when playing. */ }
        }
        if (other !== null && (input === elements.endDateTime ? current < other : current > other)) message = 'O fim não pode ser anterior ao início.';
      } catch (issue) { message = issue.message; }
    }
    error.textContent = message;
    confirm.disabled = Boolean(message);
    return !message;
  };
  const close = () => { panel.hidden = true; button.setAttribute('aria-expanded', 'false'); };
  const render = () => {
    panel.querySelector('strong').textContent = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month, 1)));
    const days = panel.querySelector('.date-picker-days'); days.replaceChildren();
    const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
    const count = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    for (let i = 0; i < first; i++) days.append(document.createElement('span'));
    for (let day = 1; day <= count; day++) {
      const item = document.createElement('button'); item.type = 'button'; item.textContent = day;
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      item.setAttribute('aria-label', `${day} de ${panel.querySelector('strong').textContent}`);
      const otherDate = (input === elements.endDateTime ? elements.startDateTime.value : elements.endDateTime.value).slice(0, 10);
      if (otherDate && (input === elements.endDateTime ? date < otherDate : date > otherDate)) item.disabled = true;
      if (date === selected) item.className = 'selected';
      item.addEventListener('click', () => { selected = date; render(); }); days.append(item);
    }
    validate();
  };
  button.addEventListener('click', () => {
    if (!panel.hidden) return close();
    selected = input.value.slice(0, 10) || '';
    const date = selected ? new Date(`${selected}T12:00:00`) : new Date(); year = date.getFullYear(); month = date.getMonth();
    const values = (input.value.slice(11, 19) || '00:00:00').split(':');
    time.forEach((field, index) => { field.value = values[index] || '00'; }); render(); panel.hidden = false;
    const rect = button.getBoundingClientRect(); panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`; panel.style.top = `${Math.min(rect.bottom + 5, innerHeight - panel.offsetHeight - 8)}px`;
    button.setAttribute('aria-expanded', 'true');
  });
  panel.querySelectorAll('[data-shift]').forEach(control => control.addEventListener('click', () => { const date = new Date(year, month + Number(control.dataset.shift), 1); year = date.getFullYear(); month = date.getMonth(); render(); }));
  time.forEach(field => { field.addEventListener('input', validate); field.addEventListener('blur', () => { if (field.value !== '' && field.validity.valid) field.value = field.value.padStart(2, '0'); }); });
  confirm.addEventListener('click', () => { if (!validate()) return; input.value = candidate(); input.dispatchEvent(new Event('change', { bubbles: true })); close(); button.focus(); });
  document.addEventListener('pointerdown', event => { if (!panel.hidden && !panel.contains(event.target) && event.target !== button) close(); });
  panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); close(); button.focus(); } });
}
setupDatePicker(elements.startDateTime);
setupDatePicker(elements.endDateTime);

// The server performs the network request once per process; the UI only reads its result.
void (async () => {
  try {
    const { update } = await (await fetch('/api/update')).json();
    if (!update) return;
    const dialog = $('#updateDialog');
    $('#updateVersion').textContent = update.version;
    $('#ignoreUpdate').addEventListener('click', () => { void fetch('/api/update', { method: 'POST' }).catch(() => {}); });
    $('#updateNotes').href = 'https://github.com/steffmartin/digifort/releases';
    const install = $('#downloadUpdate'), actions = $('#updateActions'), area = $('#updateProgressArea');
    const status = $('#updateStatus'), progress = $('#updateProgress');
    install.disabled = !update.canInstall;
    if (!update.canInstall) status.textContent = 'Instalação automática indisponível. Consulte a página da versão.';
    if (!update.canInstall) area.hidden = false;
    let downloading = false;
    dialog.addEventListener('cancel', event => { if (downloading) event.preventDefault(); });
    install.addEventListener('click', async () => {
      downloading = true; actions.hidden = true; area.hidden = false; status.textContent = 'Preparando download…'; progress.removeAttribute('value');
      try {
        const start = await fetch('/api/update/download', { method: 'POST' });
        if (!start.ok) throw new Error();
        while (true) {
          const response = await fetch('/api/update/download');
          if (!response.ok) throw new Error();
          const current = await response.json();
          if (current.status === 'error') throw new Error(current.error);
          if (current.status === 'ready') break;
          if (current.total > 0) { progress.value = Math.min(100, current.received * 100 / current.total); status.textContent = `Baixando atualização… ${Math.floor(progress.value)}%`; }
          else status.textContent = `Baixando atualização… ${(current.received / 1048576).toFixed(1)} MB`;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        progress.value = 100; status.textContent = 'Download verificado. Encerrando para instalar…';
        const apply = await fetch('/api/update/apply', { method: 'POST' });
        if (!apply.ok) throw new Error();
        while (true) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const response = await fetch('/api/update/download');
          if (!response.ok) throw new Error();
          const current = await response.json();
          if (current.status === 'error') throw new Error(current.error);
        }
      } catch (error) {
        downloading = false; actions.hidden = false; progress.removeAttribute('value');
        status.textContent = error.message || 'Não foi possível preparar a atualização. Tente novamente.';
      }
    });
    dialog.showModal();
  } catch { /* Update checks never interrupt normal use. */ }
})();
