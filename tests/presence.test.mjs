import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('const presenceWorkers = [];');
const end = source.indexOf('function updateAudioSources()', start);
assert.ok(start >= 0 && end > start);

test('modelo distribuído corresponde à versão licenciada do TensorFlow', () => {
  const model = readFileSync(new URL('../public/presence/model.tflite', import.meta.url));
  assert.equal(createHash('sha256').update(model).digest('hex'), '2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b');
});

function harness() {
  const workers = [], messages = [];
  let clock = 1000;
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) { this.sent = message; }
    terminate() { this.terminated = true; }
  }
  const button = { setAttribute() {}, dataset: {}, disabled: false };
  const state = { presenceEnabled: true, mode: 'live', recordingSession: null, allStopped: false,
    thumbnailActive: false, focused: 'A', tiles: new Map([['A', { stopped: false, presenceFrameAt: Date.now(), canvas: { width: 320, height: 180 } }]]) };
  const context = vm.createContext({ state, elements: { presenceToggle: button }, Worker, navigator: { hardwareConcurrency: 16 }, setTimeout() {},
    setMediaControlTitle() {}, toast: message => messages.push(message), Date,
    createImageBitmap: async () => ({ close() {} }), performance: { now: () => clock } });
  vm.runInContext(source.slice(start, end), context);
  return { context, state, workers, messages, advance: ms => { clock += ms; } };
}

test('alarme analisa somente ao vivo sem gravação e descarta worker ao suspender', async () => {
  const h = harness();
  await h.context.checkPresence();
  assert.equal(h.workers[0].sent.type, 'init');
  h.state.recordingSession = { status: 'paused' };
  await h.context.checkPresence();
  assert.equal(h.workers[0].terminated, true);
  h.state.recordingSession = null;
  h.state.mode = 'playback';
  await h.context.checkPresence();
  assert.equal(h.workers.length, 1);
  h.state.mode = 'live';
  await h.context.checkPresence();
  assert.equal(h.workers.length, 2);
});

test('falha do detector desativa o alarme e avisa', async () => {
  const h = harness();
  await h.context.checkPresence();
  h.workers[0].onmessage({ data: { type: 'error' } });
  assert.equal(h.state.presenceEnabled, false);
  assert.equal(h.workers[0].terminated, true);
  assert.match(h.messages[0], /desativado/i);
});

test('nova presença toca três vezes e presença contínua repete um toque após 15 segundos', async () => {
  const h = harness();
  const starts = [];
  let now = 100000;
  h.context.Date = { now: () => now };
  h.state.tiles.get('A').presenceFrameAt = now;
  h.context.audio = {
    state: 'running', currentTime: 5, destination: {},
    createOscillator: () => ({ frequency: {}, connect: gain => gain, start: time => starts.push(time), stop() {} }),
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} })
  };
  vm.runInContext('presenceAudio = audio', h.context);
  await h.context.checkPresence();
  const worker = h.workers[0];
  const result = found => { h.state.tiles.get('A').presenceFrameAt = now; vm.runInContext("presenceWorkers[0].busy = true; presenceWorkers[0].camera = 'A'", h.context); worker.onmessage({ data: { type: 'result', camera: 'A', found } }); };

  result(true);
  assert.deepEqual(starts, [5, 5.45, 5.9]);
  now += 14999; result(true);
  assert.equal(starts.length, 3);
  now += 1; result(true);
  assert.equal(starts.length, 4);
  now += 3000; result(false); now += 3000; result(true);
  assert.equal(starts.length, 4, 'uma ausência breve não deve ignorar o intervalo');
  now += 9000; result(true);
  assert.equal(starts.length, 5, 'uma falha breve de detecção mantém a presença contínua');
  now += 15000; result(false); result(true);
  assert.equal(starts.length, 8, 'uma nova presença após ausência confirmada toca três vezes');
});


test('multicâmera alterna de forma justa e ignora quadros antigos', async () => {
  const h = harness();
  h.state.presenceAll = true;
  h.state.tiles.set('B', { stopped: false, presenceFrameAt: Date.now(), canvas: { width: 320, height: 180 } });
  await h.context.checkPresence();
  const worker = h.workers[0];
  worker.onmessage({ data: { type: 'ready' } });
  await h.context.checkPresence();
  assert.equal(worker.sent.camera, 'A');
  worker.onmessage({ data: { type: 'result', camera: 'A', found: false } });
  h.advance(1500);
  await h.context.checkPresence();
  assert.equal(worker.sent.camera, 'B');
  worker.onmessage({ data: { type: 'result', camera: 'B', found: false } });
  h.state.tiles.get('A').presenceFrameAt = 0;
  h.advance(3000);
  await h.context.checkPresence();
  assert.equal(worker.sent.camera, 'B');
});


test('dezessete câmeras recebem análises distribuídas em ciclos sem fila', async () => {
  const h = harness();
  h.state.presenceAll = true;
  for (let i = 1; i < 17; i++) h.state.tiles.set(`C${i}`, { stopped: false, presenceFrameAt: Date.now(), canvas: { width: 320, height: 180 } });
  await h.context.checkPresence();
  const worker = h.workers[0];
  for (const item of h.workers) item.onmessage({ data: { type: 'ready' } });
  const received = [];
  for (let i = 0; i < 34; i++) {
    await h.context.checkPresence();
    const sent = worker.sent;
    received.push(sent.camera);
    await h.context.checkPresence();
    assert.equal(worker.sent, sent, 'worker ocupado não recebe outro quadro');
    worker.onmessage({ data: { type: 'result', camera: sent.camera, found: false } });
    h.advance(3000 / 17 + 0.01);
  }
  assert.equal(new Set(received.slice(0, 17)).size, 17);
  assert.deepEqual(received.slice(0, 17), received.slice(17));
});

test('câmera recém-aberta recebe análise sem repetir câmera recente', async () => {
  const h = harness();
  h.state.presenceAll = true;
  await h.context.checkPresence();
  const worker = h.workers[0];
  worker.onmessage({ data: { type: 'ready' } });
  await h.context.checkPresence();
  worker.onmessage({ data: { type: 'result', camera: 'A', found: false } });
  h.state.tiles.set('B', { stopped: false, presenceFrameAt: Date.now(), canvas: { width: 320, height: 180 } });
  h.advance(3000);
  await h.context.checkPresence();
  assert.equal(worker.sent.camera, 'B');
});


test('trinta câmeras usam três workers sem analisar a mesma câmera simultaneamente', async () => {
  const h = harness();
  h.state.presenceAll = true;
  for (let i = 1; i < 30; i++) h.state.tiles.set(`C${i}`, { stopped: false, presenceFrameAt: Date.now(), canvas: { width: 320, height: 180 } });
  await h.context.checkPresence();
  assert.equal(h.workers.length, 3);
  for (const worker of h.workers) worker.onmessage({ data: { type: 'ready' } });
  await h.context.checkPresence();
  h.advance(101);
  await h.context.checkPresence();
  h.advance(101);
  await h.context.checkPresence();
  const names = h.workers.map(worker => worker.sent.camera);
  assert.equal(new Set(names).size, 3);
  h.workers[2].onmessage({ data: { type: 'result', camera: names[2], found: false } });
  h.workers[0].onmessage({ data: { type: 'result', camera: names[0], found: false } });
  h.advance(101);
  await h.context.checkPresence();
  assert.notEqual(h.workers[0].sent.camera, names[1], 'câmera ainda em processamento não é reenviada');
  h.state.recordingSession = { status: 'paused' };
  await h.context.checkPresence();
  assert.ok(h.workers.every(worker => worker.terminated));
});

test('quantidade de workers é limitada a quatro', async () => {
  const h = harness();
  h.state.presenceAll = true;
  for (let i = 1; i < 60; i++) h.state.tiles.set(`C${i}`, { stopped: false, presenceFrameAt: Date.now(), canvas: { width: 320, height: 180 } });
  await h.context.checkPresence();
  assert.equal(h.workers.length, 4);
});

test('borda identifica a câmera alertada com o número de sinais correspondente', async () => {
  const h = harness();
  const added = [];
  h.state.tiles.get('A').tile = { offsetWidth: 100, classList: { add: value => added.push(value), remove() {} } };
  let now = 100000;
  h.context.Date = { now: () => now };
  h.state.tiles.get('A').presenceFrameAt = now;
  await h.context.checkPresence();
  const worker = h.workers[0];
  function result() {
    h.state.tiles.get('A').presenceFrameAt = now;
    vm.runInContext("presenceWorkers[0].busy = true; presenceWorkers[0].camera = 'A'", h.context);
    worker.onmessage({ data: { type: 'result', camera: 'A', found: true } });
  }
  result(); now += 15000; result();
  assert.deepEqual(added, ['presence-alert-three', 'presence-alert-once']);
});


test('desativação encerra todos os workers e descarta bitmap e resultado tardios', async () => {
  const h = harness();
  h.state.presenceAll = true;
  for (let i = 1; i < 11; i++) h.state.tiles.set(`C${i}`, { stopped: false, presenceFrameAt: Date.now(), canvas: { width: 320, height: 180 } });
  await h.context.checkPresence();
  assert.equal(h.workers.length, 2);
  for (const worker of h.workers) worker.onmessage({ data: { type: 'ready' } });
  let resolveBitmap;
  let closed = false;
  h.context.createImageBitmap = () => new Promise(resolve => { resolveBitmap = resolve; });
  const pending = h.context.checkPresence();
  h.state.presenceEnabled = false;
  h.context.stopPresenceWorker();
  assert.ok(h.workers.every(worker => worker.terminated));
  resolveBitmap({ close() { closed = true; } });
  await pending;
  assert.equal(closed, true);
  assert.equal(h.workers[0].sent.type, 'init', 'bitmap tardio não deve ser enviado');
  h.workers[0].onmessage({ data: { type: 'result', camera: 'A', found: true } });
  assert.equal(vm.runInContext('presenceWorkers.length', h.context), 0);
  assert.equal(vm.runInContext('presenceInFlight.size + presenceCameras.size + presenceLastSample.size', h.context), 0);
});
