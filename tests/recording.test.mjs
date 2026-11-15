import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Trecho ausente: ${start}`);
  return source.slice(from, to);
}

function recordingHarness({ supported = true, failStart = false } = {}) {
  const requests = [], messages = [], sources = [], streams = [], recorders = [], extensions = [];
  class FakeAudioContext {
    createMediaStreamDestination() {
      const destination = { sources: new Set(), disconnected: false, disconnect() { this.disconnected = true; } };
      const track = { kind: 'audio', stopped: false, stop() { this.stopped = true; },
        get continuous() { return [...destination.sources].some(source => source.started); } };
      destination.stream = { getAudioTracks: () => [track] };
      return destination;
    }
    createConstantSource() {
      const source = { offset: { value: 1 }, started: false, stopped: false,
        connect(destination) { this.destination = destination; destination.sources.add(this); },
        disconnect() { this.destination?.sources.delete(this); },
        start() { this.started = true; },
        stop() { this.stopped = true; this.started = false; } };
      sources.push(source);
      return source;
    }
  }
  class FakeRecorder {
    static isTypeSupported(type) { return supported && type.startsWith('video/mp4'); }
    constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; this.handlers = {}; recorders.push(this); }
    addEventListener(type, callback) { this.handlers[type] = callback; }
    start() {
      if (failStart) throw new Error('falha sintética');
      this.audioFlowingAtStart = this.stream.getAudioTracks()[0]?.continuous;
      this.state = 'recording';
    }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.handlers.dataavailable?.({ data: { size: 5 } });
      this.handlers.stop?.();
    }
  }
  const badge = { classList: { toggle() {} } };
  const player = { stopped: false, name: 'Câmera sintética', tile: { querySelector: () => badge }, setState() {},
    canvas: { width: 640, height: 360, captureStream() {
      const video = { kind: 'video', stopped: false, stop() { this.stopped = true; } };
      const stream = { tracks: [video], addTrack(track) { this.tracks.push(track); },
        getTracks() { return this.tracks; }, getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); } };
      streams.push(stream); return stream;
    } } };
  const state = { server: { videoFolderConfigured: true }, serverId: 'sintetico', mode: 'live', allStopped: false,
    audioContext: null, tiles: new Map([[player.name, player]]), recordings: new Map(), recordingSession: null };
  const elements = { recordFormat: { value: 'mp4' } };
  const context = vm.createContext({ state, elements, MediaRecorder: FakeRecorder, AudioContext: FakeAudioContext,
    scopedCameraNames: scope => scope.all ? [...state.tiles.keys()] : [scope.camera].filter(name => state.tiles.has(name)),
    recordingScopeKey: scope => scope.all ? 'all-cameras' : `camera:${scope.camera}`,
    mediaEpoch: () => 1, mediaFilenames: (names, extension) => { extensions.push(extension); return names.map(() => `sintetico${extension}`); },
    postMedia: async (_path, params) => { requests.push(params.action); return {}; }, toast: message => messages.push(message) });
  vm.runInContext(section('function recordingMime(', 'function closeContextMenu('), context);
  return { context, state, elements, player, requests, messages, sources, streams, recorders, extensions };
}

test('inicia MP4 com áudio silencioso fluindo e conserva pausa e retomada', async () => {
  const h = recordingHarness(), scope = { camera: h.player.name };
  await h.context.changeRecordingState(scope, 'start');
  const recording = h.state.recordings.get(h.player.name);
  assert.ok(recording);
  assert.deepEqual(h.extensions, ['.mp4']);
  assert.equal(h.recorders[0].audioFlowingAtStart, true, 'a trilha de áudio deve produzir silêncio desde o início');
  assert.equal(h.sources[0].offset.value, 0);
  await h.context.changeRecordingState(scope, 'pause');
  assert.equal(recording.status, 'paused');
  await h.context.changeRecordingState(scope, 'resume');
  assert.equal(recording.status, 'recording');
  await h.context.changeRecordingState(scope, 'stop');
  await recording.finished;
  assert.deepEqual(h.requests, ['start', 'chunk', 'finish']);
  assert.equal(h.sources[0].stopped, true);
  assert.ok(h.streams[0].getTracks().every(track => track.stopped));
  assert.equal(h.state.recordingSession, null);
});

test('inicia sem consultar um seletor de formato', async () => {
  const h = recordingHarness();
  delete h.elements.recordFormat;
  await h.context.changeRecordingState({ camera: h.player.name }, 'start');
  const recording = h.state.recordings.get(h.player.name);
  assert.ok(recording);
  await h.context.changeRecordingState({ camera: h.player.name }, 'stop');
  await recording.finished;
});

test('informa indisponibilidade de MP4 sem criar uma gravação', async () => {
  const h = recordingHarness({ supported: false });
  await h.context.changeRecordingState({ camera: h.player.name }, 'start');
  assert.equal(h.recorders.length, 0);
  assert.match(h.messages[0], /MP4/i);
});

test('trata ausência da API de gravação', async () => {
  const h = recordingHarness();
  delete h.context.MediaRecorder;
  await h.context.changeRecordingState({ camera: h.player.name }, 'start');
  assert.equal(h.state.recordings.size, 0);
  assert.match(h.messages[0], /MP4/i);
});

test('libera fonte e trilhas quando o navegador falha ao iniciar', async () => {
  const h = recordingHarness({ failStart: true });
  await h.context.changeRecordingState({ camera: h.player.name }, 'start');
  assert.equal(h.state.recordings.size, 0);
  assert.equal(h.state.recordingSession, null);
  assert.equal(h.sources[0]?.stopped, true);
  assert.ok(h.streams[0].getTracks().every(track => track.stopped));
});

test('o comando do menu inicia diretamente, sem abrir diálogo', () => {
  const calls = [], buttons = [];
  const state = { tiles: new Map([['Câmera sintética', {}]]), recordingSession: null, recordings: new Map() };
  const document = { createElement: () => ({ setAttribute() {}, addEventListener(_type, callback) { this.click = callback; } }) };
  const context = vm.createContext({ state, document, closeContextMenu() {}, recordingMime: () => 'video/mp4',
    changeRecordingState: (scope, action) => calls.push([scope.camera, action]), openRecordingDialog: () => calls.push(['diálogo']) });
  vm.runInContext(section('function scopedCameraNames(', 'function addContextTitle('), context);
  context.appendRecordingActions({ append: item => buttons.push(item) }, { camera: 'Câmera sintética' });
  buttons.find(button => button.textContent === 'Iniciar gravação').click();
  assert.deepEqual(calls, [['Câmera sintética', 'start']]);
});

test('o menu explica quando MP4 está indisponível', () => {
  const buttons = [];
  const state = { tiles: new Map([['Câmera sintética', {}]]), recordingSession: null, recordings: new Map() };
  const document = { createElement: () => ({ setAttribute() {}, addEventListener() {} }) };
  const context = vm.createContext({ state, document, recordingMime: () => '' });
  vm.runInContext(section('function scopedCameraNames(', 'function addContextTitle('), context);
  context.appendRecordingActions({ append: item => buttons.push(item) }, { camera: 'Câmera sintética' });
  const start = buttons.find(button => button.textContent?.includes('MP4'));
  assert.equal(start.disabled, true);
  assert.match(start.title, /MP4/);
});

test('áudio ativado durante a gravação também chega ao destino do arquivo', () => {
  const connections = [], speakers = {}, destination = {};
  const audioContext = { currentTime: 10, destination: speakers,
    createBuffer: (_channels, frames) => ({ getChannelData: () => new Float32Array(frames) }),
    createBufferSource: () => ({ connect: node => connections.push(node), start() {} }) };
  const state = { audioContext, audioContextStart: 10, audioEnabled: true, focused: 'Câmera sintética',
    recordings: new Map([['Câmera sintética', { camera: 'Câmera sintética', destination }]]) };
  const context = vm.createContext({ state, Float32Array });
  vm.runInContext(section('class CameraPlayer {', 'function findNal(') + '\nglobalThis.TestPlayer = CameraPlayer;', context);
  const player = Object.create(context.TestPlayer.prototype);
  player.name = 'Câmera sintética';
  player.schedulePcm(new Float32Array([0.25, -0.25]), 8000, 1, 0);
  assert.deepEqual(connections, [speakers, destination]);
  connections.length = 0;
  state.audioEnabled = false;
  player.schedulePcm(new Float32Array([0.25]), 8000, 1, 0);
  assert.deepEqual(connections, []);
});
