export function createPresenceAlarm({ state, elements, setMediaControlTitle, toast }) {
const presenceWorkers = [];
const presenceInFlight = new Set();
let presenceAudio = null;
let lastPresenceSound = null;
const presenceCameras = new Map();
const presenceLastSample = new Map();
let presenceNextDispatch = 0;
const PRESENCE_INTERVAL_MS = 3000;

function presenceAvailable() {
  return state.presenceEnabled && state.mode === 'live' && !state.recordingSession &&
    !state.allStopped && !state.thumbnailActive && [...state.tiles.values()].some(player => !player.stopped);
}
function updatePresenceControl() {
  const button = elements.presenceToggle;
  button.disabled = !state.tiles.size;
  button.setAttribute('aria-pressed', String(state.presenceEnabled));
  button.dataset.presenceAll = String(state.presenceEnabled && state.presenceAll);
  const label = state.presenceEnabled ? (state.presenceAll ? 'Alarme de presença: todas as câmeras' : 'Alarme de presença: câmera em foco') : 'Alarme de presença: desativado';
  button.setAttribute('aria-label', label);
  setMediaControlTitle(button, `${label} · P`);
}
function stopPresenceWorker() {
  for (const slot of presenceWorkers) slot.worker.terminate();
  presenceWorkers.length = 0;
  presenceInFlight.clear();
  presenceCameras.clear();
  presenceLastSample.clear();
  presenceNextDispatch = 0;
}
function failPresence() {
  stopPresenceWorker();
  state.presenceEnabled = false;
  updatePresenceControl();
  toast('Não foi possível executar o alarme de presença. Alarme desativado.', 'error');
}
function soundPresence(count = 1) {
  if (!presenceAudio || presenceAudio.state !== 'running') return;
  for (let i = 0; i < count; i++) {
    const now = presenceAudio.currentTime + i * 0.45;
    const oscillator = presenceAudio.createOscillator();
    const gain = presenceAudio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    oscillator.connect(gain).connect(presenceAudio.destination);
    oscillator.start(now); oscillator.stop(now + 0.31);
  }
}
function flashPresence(camera, count) {
  const tile = state.tiles.get(camera)?.tile;
  if (!tile) return;
  const className = count === 3 ? 'presence-alert-three' : 'presence-alert-once';
  tile.classList.remove('presence-alert-once', 'presence-alert-three');
  void tile.offsetWidth;
  tile.classList.add(className);
  setTimeout(() => tile.classList.remove(className), count * 450 + 100);
}
function presenceEligibleCameras() {
  return [...state.tiles].filter(([name, player]) => !player.stopped && player.presenceFrameAt &&
    Date.now() - player.presenceFrameAt < 15000 && (state.presenceAll || name === state.focused) &&
    player.canvas?.width && player.canvas.height).map(([name]) => name);
}
function presenceWorkerLimit() {
  const logical = Number(navigator.hardwareConcurrency) || 2;
  return Math.min(4, Math.max(1, Math.floor(logical / 2)));
}
function reconcilePresenceWorkers() {
  const wanted = Math.min(presenceWorkerLimit(), state.presenceAll ? Math.ceil(state.tiles.size / 10) : 1);
  while (presenceWorkers.length > wanted) {
    const index = presenceWorkers.findLastIndex(slot => !slot.busy);
    if (index < 0) break;
    presenceWorkers[index].worker.terminate();
    presenceWorkers.splice(index, 1);
  }
  while (presenceWorkers.length < wanted) {
    const worker = new Worker('/presence/worker.js', { type: 'module' });
    const slot = { worker, ready: false, busy: false, camera: null };
    presenceWorkers.push(slot);
    worker.onerror = () => { if (presenceWorkers.includes(slot)) failPresence(); };
    worker.onmessage = event => {
      if (!presenceWorkers.includes(slot)) return;
      const result = event.data;
      if (result.type === 'error') return failPresence();
      if (result.type === 'ready') { slot.ready = true; return; }
      if (result.type !== 'result' || !slot.busy || slot.camera !== result.camera) return;
      presenceInFlight.delete(slot.camera);
      slot.busy = false;
      slot.camera = null;
      if (!presenceAvailable() || !state.tiles.has(result.camera) || state.tiles.get(result.camera).stopped || !state.tiles.get(result.camera).presenceFrameAt || Date.now() - state.tiles.get(result.camera).presenceFrameAt >= 15000 || (!state.presenceAll && state.focused !== result.camera)) return;
      const now = Date.now();
      const cameraState = presenceCameras.get(result.camera) || { detected: false, pending: false, lastSeen: null };
      presenceCameras.set(result.camera, cameraState);
      if (!result.found) {
        if (cameraState.lastSeen !== null && now - cameraState.lastSeen >= 15000) {
          cameraState.detected = false;
          cameraState.pending = false;
          cameraState.lastSeen = null;
        }
        return;
      }
      if (!cameraState.detected) cameraState.pending = true;
      cameraState.detected = true;
      cameraState.lastSeen = now;
      if (lastPresenceSound === null || now - lastPresenceSound >= 15000) {
        const count = cameraState.pending ? 3 : 1;
        soundPresence(count);
        flashPresence(result.camera, count);
        lastPresenceSound = now;
        cameraState.pending = false;
      }
    };
    worker.postMessage({ type: 'init' });
  }
}
async function checkPresence() {
  if (!presenceAvailable()) { stopPresenceWorker(); return; }
  try { reconcilePresenceWorkers(); } catch { failPresence(); return; }
  const slot = presenceWorkers.find(item => item.ready && !item.busy);
  if (!slot) return;
  const cameras = presenceEligibleCameras();
  const candidates = cameras.filter(camera => !presenceInFlight.has(camera));
  if (!candidates.length) return;
  const now = performance.now();
  if (now < presenceNextDispatch) return;
  // Cada worker recebe apenas o quadro atual da câmera há mais tempo sem análise.
  const camera = candidates.reduce((oldest, name) =>
    (presenceLastSample.get(name) ?? -Infinity) < (presenceLastSample.get(oldest) ?? -Infinity) ? name : oldest);
  const last = presenceLastSample.get(camera);
  if (last !== undefined && now - last < PRESENCE_INTERVAL_MS) return;
  const canvas = state.tiles.get(camera).canvas;
  slot.busy = true;
  slot.camera = camera;
  presenceInFlight.add(camera);
  presenceLastSample.set(camera, now);
  presenceNextDispatch = now + PRESENCE_INTERVAL_MS / cameras.length;
  try {
    const scale = Math.min(1, 320 / Math.max(canvas.width, canvas.height));
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const bitmap = await createImageBitmap(canvas, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' });
    if (!presenceWorkers.includes(slot) || !presenceAvailable() || (!state.presenceAll && camera !== state.focused) || !state.tiles.has(camera) || state.tiles.get(camera).stopped || !state.tiles.get(camera).presenceFrameAt || Date.now() - state.tiles.get(camera).presenceFrameAt >= 15000) {
      bitmap.close();
      if (presenceWorkers.includes(slot)) { slot.busy = false; slot.camera = null; presenceInFlight.delete(camera); }
      return;
    }
    slot.worker.postMessage({ type: 'detect', camera, bitmap, width, height }, [bitmap]);
  } catch { if (presenceWorkers.includes(slot)) failPresence(); }
}
async function schedulePresenceCheck() {
  await checkPresence();
  let wait = 250;
  if (presenceAvailable() && presenceWorkers.some(slot => slot.ready && !slot.busy)) {
    const cameras = presenceEligibleCameras();
    if (cameras.length) {
      const earliest = Math.min(...cameras.filter(camera => !presenceInFlight.has(camera)).map(camera => (presenceLastSample.get(camera) ?? -Infinity) + PRESENCE_INTERVAL_MS));
      wait = Math.max(10, Math.min(1000, Math.max(presenceNextDispatch, earliest) - performance.now()));
    }
  } else if (presenceWorkers.some(slot => slot.busy)) wait = 25;
  setTimeout(() => { void schedulePresenceCheck(); }, wait);
}
void schedulePresenceCheck();


function toggle() {
  if (!state.presenceEnabled) { state.presenceEnabled = true; state.presenceAll = false; }
  else if (!state.presenceAll) { state.presenceAll = true; stopPresenceWorker(); }
  else { state.presenceEnabled = false; state.presenceAll = false; }
  if (state.presenceEnabled) {
    if (!presenceAudio) presenceAudio = new AudioContext();
    void presenceAudio.resume().catch(failPresence);
  } else stopPresenceWorker();
  updatePresenceControl();
}

function deactivate() {
  state.presenceEnabled = false;
  stopPresenceWorker();
  updatePresenceControl();
}

function focusChanged() {
  if (!state.presenceAll) stopPresenceWorker();
}

function streamUnavailable(camera, wasReceiving) {
  if (wasReceiving && state.presenceEnabled && (state.presenceAll || state.focused === camera)) {
    toast(`${camera}: alarme de presença suspenso enquanto a transmissão está indisponível.`, 'error');
  }
}

return { stopPresenceWorker, updatePresenceControl, toggle, deactivate, focusChanged, streamUnavailable };
}
