import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function isTileEnlarged('), source.indexOf('async function openCamera('));

function scenario() {
  const listeners = {};
  const flags = new Set();
  const tile = { classList: { contains: name => flags.has(name), add: name => flags.add(name), remove: name => flags.delete(name) }, resetZoom() {} };
  const root = { requestFullscreen: async () => { document.fullscreenElement = root; } };
  const state = { surveillance: true, thumbnailActive: false };
  const document = { documentElement: root, fullscreenElement: root, fullscreenEnabled: true,
    addEventListener: (type, fn) => { listeners[type] = fn; }, querySelector: () => null,
    exitFullscreen: async () => { document.fullscreenElement = null; listeners.fullscreenchange(); } };
  const elements = { viewerGrid: { querySelector: () => flags.has('is-enlarged') ? tile : null, querySelectorAll: () => [tile] } };
  const calls = [];
  const navigator = { keyboard: { lock: async keys => calls.push([...keys]), unlock: () => calls.push('unlock') } };
  const context = vm.createContext({ state, document, elements, navigator, updateSurveillance() {}, toast() {} });
  vm.runInContext(code, context);
  const key = key => { const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; listeners.keydown(event); return event; };
  return { context, state, document, tile, key, calls, navigator };
}

test('vigilância preserva tela cheia ao restaurar câmera por duplo clique ou Esc', async () => {
  const { context, state, document, tile, key } = scenario();
  await context.toggleTileFullscreen(tile, 'Entrada');
  assert.equal(tile.classList.contains('is-enlarged'), true);
  assert.equal(document.fullscreenElement, document.documentElement);
  await context.toggleTileFullscreen(tile, 'Entrada');
  assert.equal(tile.classList.contains('is-enlarged'), false);
  assert.equal(state.surveillance, true);
  assert.equal(document.fullscreenElement, document.documentElement);
  await context.toggleTileFullscreen(tile, 'Entrada');
  assert.equal(key('Escape').defaultPrevented, true);
  assert.equal(tile.classList.contains('is-enlarged'), false);
  assert.equal(state.surveillance, true);
  assert.equal(document.fullscreenElement, document.documentElement);
  key('Escape');
  await Promise.resolve();
  assert.equal(document.fullscreenElement, null);
  assert.equal(state.surveillance, false);
});

test('F11 é interceptado antes dos demais atalhos', () => {
  const { key } = scenario();
  const event = key('F11');
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.stopped, true);
});


test('vigilância solicita bloqueio apenas de Escape e o libera ao sair', async () => {
  const { context, state, document, calls } = scenario();
  state.surveillance = false;
  document.fullscreenElement = null;
  await context.toggleSurveillance();
  assert.deepEqual(calls[0], ['Escape']);
  assert.equal(state.surveillance, true);
  await context.toggleSurveillance();
  assert.equal(calls.includes('unlock'), true);
  assert.equal(state.surveillance, false);
});
