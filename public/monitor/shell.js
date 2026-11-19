import { createMediaToolbar, setMediaControlTitle, updateMediaControls as updateToolbarControls } from './media-toolbar.js';

export function mountMonitor({ createCameraPlayerClass, consumeMultipart, createMediaCapture, createPlaybackReview, createTimelineReview, createThumbnailReview, epochToApi, epochToInput, inputToEpoch, createPresenceAlarm }) {
const $ = selector => document.querySelector(selector);
const state = {
  servers: [], serverId: '', server: null, cameras: [], tiles: new Map(), desktopWindow: false,
  cameraStatuses: new Map(), statusTimer: null, statusRequestId: 0, statusRefreshing: false,
  mode: 'live', focused: '', audioEnabled: false,
  allStopped: false, captureAll: false, mosaic: 'auto', overlaysVisible: false, timelineVisible: true, surveillance: false,
  audioContext: null
};

// Each module receives only the monitor properties it uses. Values owned by
// another module are exposed through the monitor's read-only accessors.
function monitorPort(fields, writable = []) {
  const port = Object.create(null);
  for (const field of fields) {
    Object.defineProperty(port, field, {
      get: () => state[field],
      ...(writable.includes(field) ? { set: value => { state[field] = value; } } : {})
    });
  }
  return Object.preventExtensions(port);
}

const elements = {
  serverSelect: $('#serverSelect'), connectionState: $('#connectionState'), connectionLabel: $('#connectionLabel'),
  cameraSearch: $('#cameraSearch'), cameraList: $('#cameraList'), cameraListEmpty: $('#cameraListEmpty'),
  cameraCount: $('#cameraCount'), availableCount: $('#availableCount'),
  liveMode: $('#liveMode'), reviewMode: $('#reviewMode'), reviewFields: $('#reviewFields'),
  startDateTime: $('#startDateTime'), endDateTime: $('#endDateTime'), playReview: $('#playReview'),
  audioSource: $('#audioSource'), audioToggle: $('#audioToggle'), presenceToggle: $('#presenceToggle'), viewerGrid: $('#viewerGrid'), emptyMonitor: $('#emptyMonitor'),
  mediaToolbar: $('#mediaToolbar'), mediaToolbarHandle: $('#mediaToolbarHandle'),
  seekBack: $('#seekBack'), seekForward: $('#seekForward'), seekBackWrap: $('#seekBackWrap'), seekForwardWrap: $('#seekForwardWrap'),
  captureFrame: $('#captureFrame'), recordToggle: $('#recordToggle'), finishRecording: $('#finishRecording'), captureAllSwitch: $('#captureAllSwitch'),
  viewSubtitle: $('#viewSubtitle'), stopAll: $('#stopAll'),
  reviewPanel: $('#reviewPanel'), timelineRuler: $('#timelineRuler'), timelineTracks: $('#timelineTracks'), timelineNames: $('#timelineNames'), timelineScroll: $('#timelineScroll'), timelineContent: $('#timelineContent'), timelineDays: $('#timelineDays'),
  timelinePlayhead: $('#timelinePlayhead'), timelineStatus: $('#timelineStatus'),
  thumbnailPanel: $('#thumbnailPanel'), thumbnailGrid: $('#thumbnailGrid'), thumbnailStatus: $('#thumbnailStatus'),
  thumbnailPrev: $('#thumbnailPrev'),
  mosaicSelect: $('#mosaicSelect'), saveGrid: $('#saveGrid'), resetGrid: $('#resetGrid'), mosaicPreview: $('#mosaicPreview'), overlayToggle: $('#overlayToggle'), displayControl: $('#displayControl'), displayMenuToggle: $('#displayMenuToggle'), displayMenu: $('#displayMenu'),
  toggleOverlayVisibility: $('#toggleOverlayVisibility'), toggleTimelineVisibility: $('#toggleTimelineVisibility'),
  surveillanceToggle: $('#surveillanceToggle'), contextMenu: $('#contextMenu'),
  thumbnailNext: $('#thumbnailNext'),
  configDialog: $('#configDialog'), configDialogMessage: $('#configDialogMessage'), closeConfigApp: $('#closeConfigApp'),
  toastRegion: $('#toastRegion')
};

const contextMenuHome = elements.contextMenu.parentElement;

// The current thumbnail grid starts at 150px wide; request half, current, and double size.
const MOSAICS = [
  { id: 'auto', name: 'Grade automática', columns: 0, capacity: Infinity, previewCapacity: 8 },
  { id: '3x3-six', name: '3 × 3 · 6 câmeras', columns: 3, capacity: 6, slots: [[1,1,2,2],[1,3,1,1],[2,3,1,1],[3,1,1,1],[3,2,1,1],[3,3,1,1]] },
  { id: '4x4-six', name: '4 × 4 · 6 câmeras', columns: 4, capacity: 6, slots: [[1,1,2,2],[1,3,2,2],[3,1,2,1],[3,2,2,1],[3,3,2,1],[3,4,2,1]] },
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
  elements.mediaToolbar.hidden = state.thumbnailActive;
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
  timelineReview.reorder(ordered.map(([camera]) => camera));
  applyMosaic();
  updateAudioSources();
}

function updateSurveillance() {
  document.body.classList.toggle('is-surveillance', state.surveillance);
  const fullTile = document.fullscreenElement?.classList?.contains('camera-tile');
  const enlarged = elements.viewerGrid.querySelector('.camera-tile.is-enlarged');
  const exitingCamera = Boolean(fullTile || enlarged);
  const exiting = exitingCamera || state.surveillance;
  const surveillanceAction = exitingCamera ? 'Sair da tela cheia da câmera' : state.surveillance ? 'Sair do modo vigilância' : 'Ativar modo vigilância';
  elements.surveillanceToggle.setAttribute('aria-pressed', String(exiting));
  elements.surveillanceToggle.setAttribute('aria-label', surveillanceAction);
  elements.surveillanceToggle.title = `${surveillanceAction} · V`;
  elements.surveillanceToggle.querySelector('path').setAttribute('d', exiting
    ? 'M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5'
    : 'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5');
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

function contextSeparator() {
  const separator = document.createElement('div');
  separator.className = 'context-separator'; separator.setAttribute('role', 'separator');
  return separator;
}

function createCameraScopeMenu(scope) {
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
  const fullTile = document.fullscreenElement?.classList?.contains('camera-tile') ? document.fullscreenElement : elements.viewerGrid.querySelector('.camera-tile.is-enlarged');
  (fullTile || contextMenuHome).append(root);
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

const mediaCapture = createMediaCapture({ state: monitorPort(['mode', 'reviewEpoch', 'reviewStart', 'server', 'serverId', 'tiles', 'allStopped', 'audioContext'], ['audioContext']), epochToInput, query, toast, scopedCameraNames, recordingScopeKey, stopPresenceWorker: (...args) => stopPresenceWorker(...args), updateMediaControls });
const { captureFrames, recordingMime, changeRecordingState, requestStopRecordingSession } = mediaCapture;
Object.defineProperties(state, { recordings: { get: () => mediaCapture.recordings }, recordingSession: { get: () => mediaCapture.session } });

function closeContextMenu(restoreFocus = false) {
  const invoker = state.contextInvoker;
  elements.contextMenu.hidden = true; elements.contextMenu.replaceChildren();
  contextMenuHome.append(elements.contextMenu);
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
    playbackReview.reset();
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

function toast(message, kind = 'info', action = null) {
  const node = document.createElement(action ? 'button' : 'div');
  if (action) {
    node.type = 'button';
    node.title = 'Abrir pasta onde a mídia foi salva';
    node.addEventListener('click', async () => {
      try {
        const response = await fetch(`/api/media-folder?${query(action)}`, { method: 'POST' });
        if (!response.ok) throw new Error();
      } catch { toast('Não foi possível abrir a pasta da mídia.', 'error'); }
    });
  }
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
    configForm.elements.seekSeconds.value = fields.seekSeconds ?? 15;
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
  const fields = { name: f.name.value, serverAddress: f.serverAddress.value, userAgent: f.userAgent.value, username: f.username.value, timeZone: f.timeZone.value, mediaFolder: f.mediaFolder.value, screenshotFolder: f.screenshotFolder.value, videoFolder: f.videoFolder.value, initialMosaic: f.initialMosaic.value, maxCams: Number(f.maxCams.value), seekSeconds: Number(f.seekSeconds.value), useBasicAuth: f.useBasicAuth.checked, initialCameras };
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
  playbackReview.reset();
  state.surveillance = false; updateSurveillance();
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
        <div class="tile-topline"><div class="tile-camera-meta"><span class="tile-camera-name"></span><span class="tile-camera-description"></span></div><span class="tile-state"><span class="tile-state-text">Conectando</span></span></div>
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
  tile.addEventListener('contextmenu', event => { if (event.target.closest('.context-menu')) return; event.preventDefault(); openContextMenu(event.clientX, event.clientY, { camera: cameraName, all: false }, { camera: cameraName, all: true }); });
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
  tile.classList.toggle('is-review', state.mode === 'playback');
  return tile;
}

function isTileEnlarged(tile) { return document.fullscreenElement === tile || tile.classList.contains('is-enlarged'); }

function placeMediaToolbar(tile = null) { mediaToolbar.place(tile); }

function closeSurveillanceTile() {
  const tile = elements.viewerGrid.querySelector('.camera-tile.is-enlarged');
  if (!tile) return false;
  closeContextMenu();
  tile.classList.remove('is-enlarged');
  placeMediaToolbar();
  tile.resetZoom?.();
  updateSurveillance();
  return true;
}

async function toggleTileFullscreen(tile, cameraName) {
  if (state.surveillance && document.fullscreenElement === document.documentElement) {
    const wasEnlarged = tile.classList.contains('is-enlarged');
    closeSurveillanceTile();
    if (!wasEnlarged) { tile.classList.add('is-enlarged'); placeMediaToolbar(tile); }
    updateSurveillance();
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
  if (state.surveillance && closeSurveillanceTile()) return;
  if (state.surveillance) { await leaveFullscreen(); return; }
  if (document.fullscreenElement?.classList?.contains('camera-tile')) {
    try { await document.exitFullscreen(); }
    catch { toast('Não foi possível sair da tela cheia da câmera.', 'error'); }
    return;
  }
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
  const fullTile = document.fullscreenElement?.classList?.contains('camera-tile') ? document.fullscreenElement : null;
  closeContextMenu();
  placeMediaToolbar(fullTile);
  for (const tile of elements.viewerGrid.querySelectorAll('.camera-tile')) if (!isTileEnlarged(tile)) tile.resetZoom?.();
  if (!document.fullscreenElement && state.surveillance) { navigator.keyboard?.unlock?.(); closeSurveillanceTile(); state.surveillance = false; }
  updateSurveillance();
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
  if (document.fullscreenElement === player.tile) {
    try { await document.exitFullscreen(); }
    catch { toast('Não foi possível sair da tela cheia da câmera.', 'error'); return; }
  } else if (player.tile.classList.contains('is-enlarged')) closeSurveillanceTile();
  const recording = state.recordings.get(cameraName);
  if (recording) {
    await Promise.all(requestStopRecordingSession());
  }
  const wasFocused = state.focused === cameraName;
  player.stop();
  stopPresenceWorker();
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
    presenceAlarm.deactivate();
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
  presenceAlarm.deactivate();
  state.allStopped = false;
  updateAudioSources();
  drawCameraList();
  updateViewHeader();
}

function focusCamera(cameraName) {
  if (!state.tiles.has(cameraName)) return;
  const previousFocus = state.focused;
  if (previousFocus !== cameraName) { clearThumbnails(); presenceAlarm.focusChanged(); }
  state.focused = cameraName;
  mediaCapture.focusChanged(cameraName);
  for (const [name, player] of state.tiles) {
    player.tile.classList.toggle('is-focused', name === cameraName);
  }
  updateAudioSources();
  updateViewHeader();
  if (state.audioEnabled && previousFocus !== cameraName) void audioSourceChanged(previousFocus, cameraName);

}

const presenceAlarm = createPresenceAlarm({ state: monitorPort(['mode', 'recordingSession', 'allStopped', 'thumbnailActive', 'tiles', 'focused']), elements, setMediaControlTitle, toast });
const { stopPresenceWorker, updatePresenceControl } = presenceAlarm;
const CameraPlayer = createCameraPlayerClass({ state: monitorPort(['serverId', 'mode', 'reviewStart', 'reviewEpoch', 'reviewEnd', 'server', 'audioEnabled', 'focused', 'allStopped', 'recordings', 'audioContext', 'audioContextStart']), query, epochToApi, parseFrameEpoch, toast, presenceAlarm, updateTimelinePlayhead: (...args) => updateTimelinePlayhead(...args) });

function updateAudioSources() {
  updatePresenceControl();
  elements.audioSource.replaceChildren();
  if (!state.tiles.size) {
    elements.audioSource.add(new Option('Nenhuma câmera aberta', ''));
    elements.audioSource.disabled = true;
    elements.audioToggle.disabled = true;
    elements.audioToggle.setAttribute('aria-pressed', 'false');
    elements.audioToggle.setAttribute('aria-label', 'Ativar áudio');
    setMediaControlTitle(elements.audioToggle, 'Ativar áudio · A');
    return;
  }
  for (const name of state.tiles.keys()) elements.audioSource.add(new Option(name, name));
  elements.audioSource.value = state.focused;
  elements.audioSource.disabled = false;
  elements.audioToggle.disabled = false;
  elements.audioToggle.setAttribute('aria-pressed', String(state.audioEnabled));
  const audioAction = state.audioEnabled ? 'Desativar áudio' : 'Ativar áudio';
  elements.audioToggle.setAttribute('aria-label', audioAction);
  setMediaControlTitle(elements.audioToggle, `${audioAction} · A`);
}

function updateViewHeader() {
  const count = state.tiles.size;
  elements.cameraCount.textContent = String(count);
  elements.stopAll.disabled = count === 0;
  const stopAction = state.allStopped ? 'Retomar todas as câmeras' : 'Parar todas as câmeras';
  setMediaControlTitle(elements.stopAll, `${stopAction} · Espaço`);
  elements.stopAll.setAttribute('aria-label', stopAction);
  elements.stopAll.setAttribute('aria-pressed', String(state.allStopped));
  elements.stopAll.dataset.state = state.allStopped ? 'stopped' : 'active';
  elements.viewSubtitle.textContent = state.focused ? `${state.focused}${state.mode === 'live' ? ' · transmissão instantânea' : ' · horário sincronizado'}` : 'Escolha uma câmera para começar.';
  updateMediaControls();
}

function updateMediaControls() {
  updateToolbarControls({ state, elements, recordingMime });
}

function setMode(mode) {
  if (state.mode === mode) return;
  if (state.mode === 'playback' && mode !== 'playback' && state.recordings.size) requestStopRecordingSession();
  if (state.thumbnailActive) closeThumbnailView(false);
  state.mode = mode;
  stopPresenceWorker();
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
    playbackReview.reset();
    for (const player of state.tiles.values()) {
      player.profile = 'Recording';
      player.tile.classList.add('is-review');
    }
  } else {
    elements.timelineStatus.textContent = 'Timeline disponível durante as gravações.';
    for (const player of state.tiles.values()) {
      player.profile = player.lastLiveProfile || 'Visualization';
      player.tile.classList.remove('is-review');
    }
  }
  clearTimeline();
  for (const player of state.tiles.values()) player.restart();
  updateViewHeader();
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

async function audioSourceChanged(oldSource, newSource) {
  if (oldSource && oldSource !== newSource) state.tiles.get(oldSource)?.stopAudioStream();
  if (state.allStopped || !state.audioEnabled || !newSource || newSource === oldSource) return;
  await state.tiles.get(newSource)?.startAudioStream();
}

const playbackReview = createPlaybackReview({ state: monitorPort(['server', 'tiles', 'thumbnailActive', 'allStopped', 'mode', 'timelineVisible', 'timelineEnd'], ['allStopped']), elements, epochToInput, inputToEpoch, toast, closeThumbnailView: (...args) => closeThumbnailView(...args), clearThumbnails: (...args) => clearThumbnails(...args), timelineReview: { openTimeline: (...args) => timelineReview.openTimeline(...args) }, updateTimelinePlayhead: (...args) => updateTimelinePlayhead(...args), updateViewHeader });
const { setDefaultReviewTimes, startReview, loadFocusedTimeline, seekReview, skipReview } = playbackReview;
Object.defineProperties(state, {
  reviewStart: { get: () => playbackReview.start }, reviewEnd: { get: () => playbackReview.end },
  reviewLimitEnd: { get: () => playbackReview.limitEnd }, reviewEpoch: { get: () => playbackReview.epoch }
});
const timelineReview = createTimelineReview({ state: monitorPort(['server', 'serverId', 'reviewEpoch', 'reviewStart', 'reviewLimitEnd', 'reviewEnd', 'mode', 'timelineVisible']), elements, query, consumeMultipart, parseApiTimestamp, toast, seekReview, formatClock, setReviewEpoch: epoch => playbackReview.setEpoch(epoch) });
const { clearTimeline, drawTimeline, updateTimelinePlayhead } = timelineReview;
Object.defineProperty(state, 'timelineEnd', { get: () => timelineReview.end });
let thumbnailResizeTimer;
window.addEventListener('resize', () => {
  if (state.timelineVisible && state.mode === 'playback') drawTimeline();
  if (state.thumbnailActive) { clearTimeout(thumbnailResizeTimer); thumbnailResizeTimer = setTimeout(() => { if (!state.thumbnailActive) return; thumbnailReview.resize(); }, 150); }
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
      player.setMessage('Transmissão parada. Use a barra de multimídia para retomar.');
    }
    state.allStopped = true;
  } else {
    state.allStopped = false;
    for (const player of state.tiles.values()) await player.start();
  }
  updateViewHeader();
}

const thumbnailReview = createThumbnailReview({ state: monitorPort(['focused', 'reviewStart', 'tiles', 'reviewLimitEnd', 'reviewEnd', 'reviewEpoch', 'timelineEnd', 'allStopped', 'timelineVisible', 'mode', 'server', 'serverId'], ['allStopped']), elements, leaveFullscreen, updateOverlayState, requestStopRecordingSession, setDisplayVisibility, updateViewHeader, seekReview, closeContextMenu, epochToApi, query, formatClock });
const { clearThumbnails, createThumbnailMenu, openThumbnailView, closeThumbnailView, THUMBNAIL_INTERVALS } = thumbnailReview;
Object.defineProperty(state, 'thumbnailActive', { get: () => thumbnailReview.active });

function clockTick() {
  const now = new Date();
  $('#clockTime').textContent = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
  $('#clockDate').textContent = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now);
}

const mediaToolbar = createMediaToolbar({
  state: monitorPort(['thumbnailActive', 'captureAll', 'focused', 'recordingSession'], ['captureAll']),
  elements, updateMediaControls, captureFrames, changeRecordingState
});

elements.serverSelect.addEventListener('change', event => selectServer(event.target.value));
elements.cameraSearch.addEventListener('input', drawCameraList);
elements.liveMode.addEventListener('click', () => setMode('live'));
elements.reviewMode.addEventListener('click', () => setMode('playback'));
elements.playReview.addEventListener('click', startReview);
elements.seekBack.addEventListener('click', () => skipReview(-1));
elements.seekForward.addEventListener('click', () => skipReview(1));
for (const input of [elements.startDateTime, elements.endDateTime]) input.addEventListener('change', clearThumbnails);
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
elements.saveGrid.addEventListener('click', async () => {
  if (!state.serverId || !state.server) return;
  const serverId = state.serverId;
  const initialMosaic = state.mosaic;
  const initialCameras = Object.fromEntries([...state.tiles].map(([name, player]) => [name, state.mode === 'playback' ? player.lastLiveProfile || 'Visualization' : player.profile]));
  elements.saveGrid.disabled = true;
  try {
    const response = await fetch(`/api/grid?${query({ server: serverId })}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ initialCameras, initialMosaic }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível salvar a grade.');
    if (state.serverId === serverId && state.server) Object.assign(state.server, { initialCameras, initialMosaic });
    toast('Grade salva na configuração do servidor.');
  } catch (error) { toast(error.message, 'error'); }
  finally { elements.saveGrid.disabled = false; }
});
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
elements.presenceToggle.addEventListener('click', () => presenceAlarm.toggle());
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
elements.thumbnailPrev.addEventListener('click', () => thumbnailReview.previous());
elements.thumbnailNext.addEventListener('click', () => thumbnailReview.next());
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
  [elements.audioToggle, 'A', 'A'], [elements.presenceToggle, 'P', 'P'], [elements.audioSource, 'F', 'F'], [elements.mediaToolbarHandle, 'B', 'B'],
  [elements.recordToggle, 'R', 'R'], [elements.finishRecording, 'Shift+R', 'Shift+R'], [elements.captureAllSwitch, 'C', 'C'],
  [elements.liveMode, 'G', 'G'], [elements.reviewMode, 'G', 'G'],
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
  if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.code === 'KeyR') {
    if (!state.thumbnailActive && elements.contextMenu.hidden && !elements.finishRecording.disabled) { event.preventDefault(); elements.finishRecording.click(); }
    return;
  }
  if (!elements.contextMenu.hidden || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
  if (state.thumbnailActive && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    const button = event.key === 'ArrowLeft' ? elements.thumbnailPrev : elements.thumbnailNext;
    event.preventDefault(); if (!button.disabled) button.click(); return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    const button = event.key === 'ArrowLeft' ? elements.seekBack : elements.seekForward;
    if (!button.disabled && !button.closest('[hidden]')) { event.preventDefault(); button.click(); }
    return;
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
    p: () => { if (!elements.presenceToggle.disabled) elements.presenceToggle.click(); },
    g: () => setMode(state.mode === 'live' ? 'playback' : 'live'),
    t: () => setDisplayVisibility({ timeline: !state.timelineVisible }),
    d: () => setDisplayVisibility({ overlays: !state.overlaysVisible }),
    b: () => { if (!state.thumbnailActive) mediaToolbar.focus(); },
    c: () => { if (!state.thumbnailActive) elements.captureAllSwitch.click(); },
    r: () => { if (!state.thumbnailActive && !elements.recordToggle.disabled) elements.recordToggle.click(); },
    f: () => { const names = [...elements.viewerGrid.querySelectorAll('.camera-tile')].map(tile => tile.dataset.camera); if (names.length) focusCamera(names[(names.indexOf(state.focused) + 1) % names.length]); }
  };
  if (actions[key]) { event.preventDefault(); actions[key](); }
});

setupMosaics();
updateOverlayState();
updateMediaControls();
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

}
