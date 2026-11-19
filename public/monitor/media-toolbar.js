export function setMediaControlTitle(control, title) {
  control.title = title;
  if (control.parentElement?.classList.contains('media-control-hit')) control.parentElement.title = title;
}

export function updateMediaControls({ state, elements, recordingMime }) {
  const session = state.recordingSession;
  const all = state.captureAll;
  const mp4Available = Boolean(recordingMime());
  const seekReady = state.mode === 'playback' && Number.isFinite(state.reviewStart) && state.tiles.size > 0;
  const seekSeconds = state.server?.seekSeconds ?? 15;
  for (const [button, wrap, action, key] of [[elements.seekBack, elements.seekBackWrap, 'Retroceder', '←'], [elements.seekForward, elements.seekForwardWrap, 'Avançar', '→']]) {
    wrap.hidden = state.mode !== 'playback';
    button.disabled = !seekReady;
    const label = `${action} ${seekSeconds} ${seekSeconds === 1 ? 'segundo' : 'segundos'}`;
    button.setAttribute('aria-label', label);
    setMediaControlTitle(button, `${label} · ${key}`);
  }
  const available = all ? Boolean(state.tiles.size) : state.tiles.has(state.focused);
  const belongs = session && session.all === all;
  const active = belongs && session.cameras.some(name => state.recordings.has(name));
  const status = belongs ? session.status : 'idle';
  const target = belongs && !all ? `de ${session.cameras[0]}` : all ? 'de todas as câmeras' : 'da câmera em foco';
  const captureLabel = all ? 'Capturar quadros de todas as câmeras' : 'Capturar quadro da câmera em foco';
  const captureShortcut = all ? 'Ctrl+Shift+PrintScreen' : 'Ctrl+PrintScreen';
  elements.captureFrame.disabled = !available;
  elements.captureFrame.setAttribute('aria-label', captureLabel);
  elements.captureFrame.setAttribute('aria-keyshortcuts', all ? 'Control+Shift+PrintScreen' : 'Control+PrintScreen');
  setMediaControlTitle(elements.captureFrame, `${captureLabel} · ${captureShortcut}`);
  elements.mediaToolbar.dataset.captureAll = String(all);
  elements.captureAllSwitch.setAttribute('aria-checked', String(all));
  elements.captureAllSwitch.title = `${all ? 'Capturar somente a câmera em foco' : 'Capturar todas as câmeras'} · C`;
  const action = status === 'recording' ? 'Pausar' : status === 'paused' ? 'Retomar' : 'Iniciar';
  let label = `${action} gravação ${target}`;
  if (!session && !mp4Available) label += ' (MP4 indisponível)';
  if (session && !belongs) label += ' (volte ao escopo da gravação atual)';
  elements.recordToggle.setAttribute('aria-label', label);
  setMediaControlTitle(elements.recordToggle, `${label} · R`);
  elements.recordToggle.dataset.state = status;
  elements.recordToggle.disabled = session ? !belongs || !active || !['recording', 'paused'].includes(status)
    : !mp4Available || !available;
  const finishLabel = `Finalizar gravação ${target}`;
  elements.finishRecording.setAttribute('aria-label', finishLabel);
  setMediaControlTitle(elements.finishRecording, `${finishLabel} · Shift+R`);
  elements.finishRecording.disabled = !active || !['recording', 'paused'].includes(status);
}

export function createMediaToolbar({ state, elements, updateMediaControls, captureFrames, changeRecordingState }) {
const TOOLBAR_POSITION_KEY = 'digifort.mediaToolbarPosition';
let toolbarPosition = null, toolbarDrag = null, toolbarHideTimer = null, toolbarKeyboardFocus = false, lastInputWasKeyboard = false;
try {
  const saved = JSON.parse(sessionStorage.getItem(TOOLBAR_POSITION_KEY));
  if (Number.isFinite(saved?.x) && Number.isFinite(saved?.y)) toolbarPosition = saved;
} catch {}

function positionMediaToolbar() {
  if (elements.mediaToolbar.hidden) return;
  const surface = document.fullscreenElement?.classList?.contains('camera-tile') ? document.fullscreenElement : elements.viewerGrid.querySelector('.camera-tile.is-enlarged') || elements.viewerGrid;
  const grid = surface.getBoundingClientRect();
  const bar = elements.mediaToolbar.getBoundingClientRect();
  const desired = toolbarPosition || { x: grid.left + (grid.width - bar.width) / 2, y: grid.bottom - bar.height - 16 };
  const x = Math.max(8, Math.min(desired.x, innerWidth - bar.width - 8));
  const y = Math.max(8, Math.min(desired.y, innerHeight - bar.height - 8));
  elements.mediaToolbar.style.left = `${x}px`;
  elements.mediaToolbar.style.top = `${y}px`;
}

function saveMediaToolbarPosition(x, y) {
  toolbarPosition = { x, y };
  positionMediaToolbar();
  toolbarPosition = { x: parseFloat(elements.mediaToolbar.style.left), y: parseFloat(elements.mediaToolbar.style.top) };
  try { sessionStorage.setItem(TOOLBAR_POSITION_KEY, JSON.stringify(toolbarPosition)); } catch {}
}

function scheduleMediaToolbarHide() {
  clearTimeout(toolbarHideTimer);
  toolbarHideTimer = setTimeout(() => {
    if (!toolbarDrag && !(toolbarKeyboardFocus && elements.mediaToolbar.contains(document.activeElement))) {
      elements.mediaToolbar.classList.remove('is-visible');
    }
  }, 2500);
}

function showMediaToolbar() {
  if (state.thumbnailActive) return;
  positionMediaToolbar();
  elements.mediaToolbar.classList.add('is-visible');
  scheduleMediaToolbarHide();
}

for (const surface of [elements.viewerGrid, elements.reviewPanel]) {
  surface.addEventListener('pointermove', event => {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') showMediaToolbar();
  });
  surface.addEventListener('pointerleave', scheduleMediaToolbarHide);
}
elements.mediaToolbar.addEventListener('pointermove', showMediaToolbar);
document.addEventListener('keydown', () => { lastInputWasKeyboard = true; }, true);
document.addEventListener('pointerdown', () => { lastInputWasKeyboard = false; toolbarKeyboardFocus = false; }, true);
elements.mediaToolbar.addEventListener('focusin', () => {
  toolbarKeyboardFocus = lastInputWasKeyboard;
  showMediaToolbar();
});
elements.mediaToolbar.addEventListener('focusout', () => {
  queueMicrotask(() => {
    if (!elements.mediaToolbar.contains(document.activeElement)) {
      toolbarKeyboardFocus = false;
      scheduleMediaToolbarHide();
    }
  });
});
elements.mediaToolbarHandle.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  const bar = elements.mediaToolbar.getBoundingClientRect();
  toolbarDrag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, left: bar.left, top: bar.top };
  elements.mediaToolbarHandle.setPointerCapture(event.pointerId);
  event.preventDefault();
  showMediaToolbar();
});
elements.mediaToolbarHandle.addEventListener('pointermove', event => {
  if (!toolbarDrag || event.pointerId !== toolbarDrag.pointerId) return;
  saveMediaToolbarPosition(toolbarDrag.left + event.clientX - toolbarDrag.x, toolbarDrag.top + event.clientY - toolbarDrag.y);
  showMediaToolbar();
});
function endMediaToolbarDrag(event) {
  if (!toolbarDrag || event.pointerId !== toolbarDrag.pointerId) return;
  toolbarDrag = null;
  scheduleMediaToolbarHide();
}
elements.mediaToolbarHandle.addEventListener('pointerup', endMediaToolbarDrag);
elements.mediaToolbarHandle.addEventListener('pointercancel', endMediaToolbarDrag);
elements.mediaToolbarHandle.addEventListener('keydown', event => {
  const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[event.key];
  if (!direction) return;
  event.preventDefault();
  const bar = elements.mediaToolbar.getBoundingClientRect();
  const step = event.shiftKey ? 40 : 10;
  saveMediaToolbarPosition(bar.left + direction[0] * step, bar.top + direction[1] * step);
  showMediaToolbar();
});
window.addEventListener('resize', positionMediaToolbar);
window.addEventListener('scroll', positionMediaToolbar, true);
if (typeof ResizeObserver === 'function') new ResizeObserver(positionMediaToolbar).observe(elements.viewerGrid);

elements.captureAllSwitch.addEventListener('click', () => { state.captureAll = !state.captureAll; updateMediaControls(); });
elements.captureFrame.addEventListener('click', () => { void captureFrames({ camera: state.focused, all: state.captureAll }); });
function selectedRecordingScope() {
  const camera = !state.captureAll && state.recordingSession?.all === false ? state.recordingSession.cameras[0] : state.focused;
  return { all: state.captureAll, camera };
}
elements.recordToggle.addEventListener('click', () => {
  const status = state.recordingSession?.status;
  void changeRecordingState(selectedRecordingScope(), status === 'recording' ? 'pause' : status === 'paused' ? 'resume' : 'start');
});
elements.finishRecording.addEventListener('click', () => { void changeRecordingState(selectedRecordingScope(), 'stop'); });

function place(tile = null) {
  (tile || elements.viewerGrid).append(elements.mediaToolbar);
  positionMediaToolbar();
}
function focus() {
  toolbarKeyboardFocus = true;
  showMediaToolbar();
  elements.mediaToolbarHandle.focus();
}
return { place, focus, show: showMediaToolbar, position: positionMediaToolbar };
}
