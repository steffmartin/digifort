import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaCapture } from '../public/media/capture.js';

function harness(state, messages) {
  return createMediaCapture({ state, epochToInput: () => '2026-01-01T12:00:00', query: params => new URLSearchParams(params),
    toast: (message, kind, action) => messages.push({ message, kind, action }), scopedCameraNames: scope => scope.all ? [...state.tiles.keys()] : [scope.camera],
    recordingScopeKey: scope => scope.all ? 'all-cameras' : `camera:${scope.camera}`, stopPresenceWorker() {}, updateMediaControls() {} });
}

test('interface de captura salva PNGs de todas as câmeras sem sobreposição', async t => {
  const requests = [], messages = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, json: async () => ({}) };
  });
  const player = name => ({ name, canvas: { width: 10, height: 10, toBlob: callback => callback(new Blob(['synthetic'], { type: 'image/png' })) } });
  const state = { mode: 'live', serverId: 'synthetic', server: { timeZone: 'UTC', screenshotFolderConfigured: true },
    tiles: new Map([['A', player('A')], ['B', player('B')]]) };
  const capture = harness(state, messages);
  await capture.captureFrames({ all: true });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(item => item.url.startsWith('/api/media-file?') && item.options.body.type === 'image/png'));
  assert.match(messages[0].message, /2 screenshots salvos/);
  assert.deepEqual(messages[0].action, { folder: 'screenshot', server: 'synthetic' });
});

test('interface de gravação informa quando a API do navegador está ausente', async t => {
  const oldRecorder = globalThis.MediaRecorder;
  delete globalThis.MediaRecorder;
  t.after(() => { if (oldRecorder !== undefined) globalThis.MediaRecorder = oldRecorder; });
  const messages = [];
  const state = { server: { videoFolderConfigured: true }, tiles: new Map([['A', {}]]) };
  const capture = harness(state, messages);
  await capture.changeRecordingState({ camera: 'A' }, 'start');
  assert.equal(capture.recordings.size, 0);
  assert.equal(capture.session, null);
  assert.match(messages[0].message, /MP4/);
});
