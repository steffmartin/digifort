import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function isTileEnlarged('), source.indexOf('async function openCamera('));

function scenario() {
  const listeners = {};
  const flags = new Set();
  const tile = { classList: { contains: name => name === 'camera-tile' || flags.has(name), add: name => flags.add(name), remove: name => flags.delete(name) }, resetZoom() {} };
  const root = { requestFullscreen: async () => { document.fullscreenElement = root; } };
  const state = { surveillance: true, thumbnailActive: false };
  const document = { documentElement: root, fullscreenElement: root, fullscreenEnabled: true,
    addEventListener: (type, fn) => { listeners[type] = fn; }, querySelector: () => null,
    exitFullscreen: async () => { document.fullscreenElement = null; listeners.fullscreenchange(); } };
  tile.requestFullscreen = async () => { document.fullscreenElement = tile; };
  const elements = { viewerGrid: { querySelector: () => flags.has('is-enlarged') ? tile : null, querySelectorAll: () => [tile] } };
  const calls = [];
  const navigator = { keyboard: { lock: async keys => calls.push([...keys]), unlock: () => calls.push('unlock') } };
  const context = vm.createContext({ state, document, elements, navigator, updateSurveillance() {}, closeContextMenu() {}, toast() {} });
  vm.runInContext(code, context);
  const key = key => { const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { this.stopped = true; } }; listeners.keydown(event); return event; };
  return { context, state, document, tile, key, calls, navigator };
}

test('fora da vigilância, duplo clique ou Esc fecha a câmera em tela cheia', async () => {
  const { context, state, document, tile, key } = scenario();
  state.surveillance = false;
  document.fullscreenElement = null;
  await context.toggleTileFullscreen(tile, 'Entrada');
  assert.equal(document.fullscreenElement, tile);
  await context.toggleTileFullscreen(tile, 'Entrada');
  assert.equal(document.fullscreenElement, null);
  await context.toggleTileFullscreen(tile, 'Entrada');
  assert.equal(document.fullscreenElement, tile);
  key('Escape');
  await Promise.resolve();
  assert.equal(document.fullscreenElement, null);
  assert.equal(state.surveillance, false);
});

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

test('controle de vigilância restaura a grade antes de encerrar a tela cheia', async () => {
  const { context, state, document, tile } = scenario();
  await context.toggleTileFullscreen(tile, 'Entrada');
  assert.equal(tile.classList.contains('is-enlarged'), true);
  await context.toggleSurveillance();
  assert.equal(tile.classList.contains('is-enlarged'), false);
  assert.equal(document.fullscreenElement, document.documentElement);
  assert.equal(state.surveillance, true);
  await context.toggleSurveillance();
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


test('controle encerra apenas a tela cheia de uma câmera fora da vigilância', async () => {
  const { context, state, document, tile } = scenario();
  state.surveillance = false;
  document.fullscreenElement = tile;
  await context.toggleSurveillance();
  assert.equal(document.fullscreenElement, null);
  assert.equal(state.surveillance, false);
});

test('rótulo e ícone refletem a câmera ampliada e o modo vigilância', () => {
  const section = source.slice(source.indexOf('function updateSurveillance()'), source.indexOf('const PLAYBACK_SHORTCUTS'));
  const attributes = {}, path = { setAttribute: (_key, value) => { attributes.path = value; } };
  const tile = { classList: { contains: name => name === 'camera-tile' } };
  let enlarged = null;
  const state = { surveillance: false };
  const document = { fullscreenElement: null, body: { classList: { toggle() {} } } };
  const elements = { viewerGrid: { querySelector: () => enlarged }, surveillanceToggle: { setAttribute: (key, value) => { attributes[key] = value; }, querySelector: () => path } };
  const context = vm.createContext({ state, document, elements });
  vm.runInContext(section, context);
  context.updateSurveillance();
  assert.equal(attributes['aria-label'], 'Ativar modo vigilância');
  const enterIcon = attributes.path;
  document.fullscreenElement = tile;
  context.updateSurveillance();
  assert.equal(attributes['aria-label'], 'Sair da tela cheia da câmera');
  assert.notEqual(attributes.path, enterIcon);
  document.fullscreenElement = null; state.surveillance = true;
  context.updateSurveillance();
  assert.equal(attributes['aria-label'], 'Sair do modo vigilância');
  enlarged = tile;
  context.updateSurveillance();
  assert.equal(attributes['aria-label'], 'Sair da tela cheia da câmera');
});

test('menu de contexto acompanha a câmera ampliada e retorna ao local original', () => {
  const open = source.slice(source.indexOf('function openContextMenu('), source.indexOf('function safeMediaFilename('));
  const close = source.slice(source.indexOf('function closeContextMenu('), source.indexOf('async function beginContextPlayback('));
  const root = { style: {}, scrollHeight: 20, replaceChildren() {}, removeAttribute() {}, append() {}, querySelector() { return null; } };
  const home = { append(node) { node.parent = home; } };
  const tile = { classList: { contains: value => value === 'camera-tile' }, append(node) { node.parent = tile; } };
  let enlarged = null;
  const document = { fullscreenElement: tile, activeElement: null };
  const state = {};
  const elements = { contextMenu: root, viewerGrid: { querySelector: () => enlarged } };
  const context = vm.createContext({ state, elements, document, contextMenuHome: home, innerWidth: 800, innerHeight: 600, Math, createContextBranch: () => ({}) });
  vm.runInContext(open + close, context);
  context.openContextMenu(30, 30, { camera: 'A' }, { camera: 'A', all: true });
  assert.equal(root.parent, tile);
  context.closeContextMenu();
  assert.equal(root.parent, home);
  document.fullscreenElement = null; enlarged = tile;
  context.openContextMenu(30, 30, { camera: 'A' }, { camera: 'A', all: true });
  assert.equal(root.parent, tile);
  context.closeContextMenu();
  enlarged = null;
  context.openContextMenu(30, 30, { camera: 'A' }, { camera: 'A', all: true });
  assert.equal(root.parent, home);
});
