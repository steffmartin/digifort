import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('let timelineDrag = null;');
const end = source.indexOf('let thumbnailResizeTimer;', start);
assert.ok(start >= 0 && end > start);

test('captura o ponteiro só depois de distinguir arraste de clique', () => {
  const scrollHandlers = {}, windowHandlers = {}, captures = [], classes = new Set();
  const scroll = { scrollLeft: 100, classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)) }, addEventListener: (name, fn) => { scrollHandlers[name] = fn; }, setPointerCapture: id => captures.push(id) };
  const state = { timelineZoom: 2 };
  const context = vm.createContext({ state, elements: { timelineScroll: scroll }, window: { addEventListener: (name, fn) => { windowHandlers[name] = fn; } }, Math, setTimeout: (fn, delay) => { if (!delay) fn(); return 1; }, clearTimeout: () => {} });
  vm.runInContext(source.slice(start, end), context);
  const pointer = (x, y = 10) => ({ pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y });
  scrollHandlers.pointerdown(pointer(100));
  assert.equal(classes.has('is-pressed'), true);
  assert.equal(classes.has('is-dragging'), false);
  windowHandlers.pointermove(pointer(102));
  windowHandlers.pointerup(pointer(102));
  assert.deepEqual(captures, []);
  assert.equal(scroll.scrollLeft, 100);
  assert.equal(classes.has('is-dragging'), false);
  scrollHandlers.pointerdown(pointer(100));
  windowHandlers.pointermove(pointer(80));
  assert.deepEqual(captures, [1]);
  assert.equal(scroll.scrollLeft, 120);
  assert.equal(state.timelineDragged, true);
  assert.equal(classes.has('is-dragging'), true);
  windowHandlers.pointerup(pointer(80));
  assert.equal(classes.has('is-dragging'), false);
});
