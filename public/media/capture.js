export function createMediaCapture({ state, epochToInput, query, toast, scopedCameraNames, recordingScopeKey, stopPresenceWorker, updateMediaControls }) {
const capture = { recordings: new Map(), recordingSession: null };

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
    toast(players.length === 1 ? 'Screenshot salvo sem sobreposições.' : `${players.length} screenshots salvos.`, 'info', { folder: 'screenshot', server: state.serverId });
  } catch (error) {
    if (error.name !== 'AbortError') toast(error.message || 'Não foi possível salvar o screenshot.', 'error');
  }
}

function recordingMime() {
  if (typeof MediaRecorder !== 'function' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  const candidates = ['video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4'];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || '';
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
  if (!player || capture.recordings.has(camera)) return;
  if (player.stopped || state.allStopped || !player.canvas.width || !player.canvas.height) throw new Error(`Aguarde a chegada do vídeo de ${camera} antes de gravar.`);
  if (typeof player.canvas.captureStream !== 'function') throw new Error('Este navegador não permite capturar os quadros exibidos.');
  const stream = player.canvas.captureStream(30);
  let destination, silence;
  let opened = false;
  const cleanup = () => {
    for (const track of stream.getTracks()) track.stop();
    if (silence) { try { silence.stop(); } catch {} silence.disconnect(); }
    destination?.disconnect();
  };
  try {
    if (!state.audioContext) state.audioContext = new AudioContext();
    destination = state.audioContext.createMediaStreamDestination();
    // Keep audio flowing even when no camera is audible; otherwise the MP4 muxer can discard the initial video.
    silence = state.audioContext.createConstantSource();
    silence.offset.value = 0;
    silence.connect(destination);
    silence.start();
    stream.addTrack(destination.stream.getAudioTracks()[0]);
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
        session.saved.push(filename);
      } catch (error) {
        if (opened) await postMedia('/api/media-recording', { filename, action: 'abort' }).catch(() => {});
        if (error.name !== 'AbortError') toast(error.message || 'Não foi possível finalizar o arquivo de gravação.', 'error');
      } finally {
        cleanup();
        capture.recordings.delete(camera);
        setRecordingOverlay(camera, 'stopped');
        if (capture.recordingSession === session && session.status !== 'starting' &&
            session.cameras.every(name => !capture.recordings.has(name))) {
          capture.recordingSession = null;
          if (session.saved.length) toast(session.saved.length === 1 ? `Gravação salva: ${session.saved[0]}` : `${session.saved.length} gravações salvas.`, 'info', { folder: 'video', server: session.serverId });
        }
        updateMediaControls();
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
    capture.recordings.set(camera, recording);
    setRecordingOverlay(camera, 'recording');
    return recording;
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function changeRecordingState(scope, action) {
  const names = scopedCameraNames(scope);
  if (action === 'start') {
    if (!state.server?.videoFolderConfigured) {
      return toast('Defina videoFolder ou mediaFolder no arquivo de configuração do servidor.', 'error');
    }
    if (capture.recordingSession) return toast('Finalize a gravação atual antes de iniciar outra.', 'error');
    if (!names.length) return toast('Abra uma câmera antes de iniciar a gravação.', 'error');
    const mimeType = recordingMime();
    if (!mimeType) return toast('A gravação em MP4 não é suportada por este navegador.', 'error');
    const session = { key: recordingScopeKey(scope), all: Boolean(scope.all), cameras: names.slice(), status: 'starting', saved: [], serverId: state.serverId };
    const started = [];
    capture.recordingSession = session;
    stopPresenceWorker();
    updateMediaControls();
    try {
      const filenames = mediaFilenames(session.cameras, '.mp4', mediaEpoch());
      for (const [index, camera] of session.cameras.entries()) {
        const recording = startRecording(camera, filenames[index], mimeType, session);
        if (recording) started.push(recording);
      }
      session.status = 'recording';
      if (session.cameras.every(name => !capture.recordings.has(name))) capture.recordingSession = null;
    } catch (error) {
      if (started.length) {
        session.status = 'stopping';
        for (const recording of started) if (recording.recorder.state !== 'inactive') recording.recorder.stop();
        await Promise.all(started.map(recording => recording.finished));
      }
      if (capture.recordingSession === session) capture.recordingSession = null;
      if (error.name !== 'AbortError') toast(error.message || 'Não foi possível iniciar a gravação.', 'error');
    }
    updateMediaControls();
    return;
  }
  const session = capture.recordingSession;
  if (!session || session.key !== recordingScopeKey(scope)) return;
  if (session.status === 'starting') {
    if (action === 'stop') requestStopRecordingSession();
    return;
  }
  for (const camera of session.cameras) {
    const recording = capture.recordings.get(camera);
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
  updateMediaControls();
}

function requestStopRecordingSession() {
  const session = capture.recordingSession;
  if (!session) return [];
  session.status = 'stopping';
  const active = session.cameras.map(camera => capture.recordings.get(camera)).filter(Boolean);
  for (const recording of active) {
    recording.status = 'stopping';
    if (recording.recorder.state !== 'inactive') recording.recorder.stop();
  }
  if (!active.length && capture.recordingSession === session) capture.recordingSession = null;
  updateMediaControls();
  return active.map(recording => recording.finished);
}


return { captureFrames, recordingMime, changeRecordingState, requestStopRecordingSession,
  get recordings() { return capture.recordings; }, get session() { return capture.recordingSession; } };
}
