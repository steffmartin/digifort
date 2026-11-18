import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('let presenceWorker = null;');
const end = source.indexOf('function updateAudioSources()', start);
assert.ok(start >= 0 && end > start);

test('modelo distribuído corresponde à versão licenciada do TensorFlow', () => {
  const model = readFileSync(new URL('../public/presence/model.tflite', import.meta.url));
  assert.equal(createHash('sha256').update(model).digest('hex'), '2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b');
});

function harness() {
  const workers = [], messages = [];
  class Worker {
    constructor() { workers.push(this); }
    postMessage(message) { this.sent = message; }
    terminate() { this.terminated = true; }
  }
  const button = { setAttribute() {}, disabled: false };
  const state = { presenceEnabled: true, mode: 'live', recordingSession: null, allStopped: false,
    thumbnailActive: false, focused: 'A', tiles: new Map([['A', { stopped: false, canvas: { width: 320, height: 180 } }]]) };
  const context = vm.createContext({ state, elements: { presenceToggle: button }, Worker, setInterval() {},
    setMediaControlTitle() {}, toast: message => messages.push(message), Date,
    createImageBitmap: async () => ({ close() {} }) });
  vm.runInContext(source.slice(start, end), context);
  return { context, state, workers, messages };
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
  h.context.audio = {
    state: 'running', currentTime: 5, destination: {},
    createOscillator: () => ({ frequency: {}, connect: gain => gain, start: time => starts.push(time), stop() {} }),
    createGain: () => ({ gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} })
  };
  vm.runInContext('presenceAudio = audio', h.context);
  await h.context.checkPresence();
  const worker = h.workers[0];
  const result = found => worker.onmessage({ data: { type: 'result', camera: 'A', found } });

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
