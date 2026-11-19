import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/monitor/shell.js', import.meta.url), 'utf8');
const from = source.indexOf("document.addEventListener('keydown', event => {", source.indexOf('const controlShortcuts ='));
const to = source.indexOf('\nsetupMosaics();', from);
assert.ok(from >= 0 && to > from);

function shortcuts() {
  const calls = [];
  let listener;
  const button = name => ({ disabled: false, click: () => calls.push(name) });
  const elements = { contextMenu: { hidden: true }, displayMenu: { hidden: true },
    recordToggle: button('gravar'), finishRecording: button('finalizar'), captureAllSwitch: button('escopo') };
  const state = { thumbnailActive: false };
  const document = { addEventListener: (_type, fn) => { listener = fn; }, querySelector: () => null };
  vm.runInContext(source.slice(from, to), vm.createContext({ state, elements, document }));
  const press = (key, options = {}) => {
    const event = { key, code: `Key${key.toUpperCase()}`, target: { closest: () => false },
      ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, repeat: false,
      preventDefault() { this.defaultPrevented = true; }, ...options };
    listener(event);
    return event;
  };
  return { calls, elements, state, press };
}

test('atalhos de captura alternam escopo, gravação e finalização', () => {
  const h = shortcuts();
  assert.equal(h.press('c').defaultPrevented, true);
  assert.equal(h.press('r').defaultPrevented, true);
  assert.equal(h.press('R', { shiftKey: true }).defaultPrevented, true);
  assert.deepEqual(h.calls, ['escopo', 'gravar', 'finalizar']);
});

test('atalhos respeitam controles desabilitados, miniaturas e menu aberto', () => {
  const h = shortcuts();
  h.elements.finishRecording.disabled = true;
  h.press('R', { shiftKey: true });
  h.elements.recordToggle.disabled = true;
  h.press('r');
  h.state.thumbnailActive = true;
  h.press('c');
  h.state.thumbnailActive = false;
  h.elements.finishRecording.disabled = false;
  h.elements.contextMenu.hidden = false;
  h.press('R', { shiftKey: true });
  assert.deepEqual(h.calls, []);
});
