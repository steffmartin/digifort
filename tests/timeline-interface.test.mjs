import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineReview } from '../public/review/timeline.js';

class Element {
  constructor() {
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.clientWidth = 800;
    this.scrollWidth = 800;
    this.scrollLeft = 0;
  }
  addEventListener() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, right: 0 }; }
}

test('interface da timeline reordena faixas sem cancelar consultas e cancela ao limpar', async t => {
  const oldDocument = globalThis.document, oldWindow = globalThis.window;
  globalThis.document = { createElement: () => new Element() };
  globalThis.window = { addEventListener() {} };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument;
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    requests.push(signal);
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const state = { mode: 'playback', timelineVisible: true, server: { timeZone: 'UTC' }, serverId: 'test', reviewStart: 1000, reviewLimitEnd: 20000 };
  const elements = Object.fromEntries(['timelineNames', 'timelineTracks', 'timelineRuler', 'timelineDays', 'timelinePlayhead', 'timelineContent', 'timelineScroll', 'timelineStatus'].map(name => [name, new Element()]));
  const timeline = createTimelineReview({ state, elements, query: params => new URLSearchParams(params), consumeMultipart() {}, parseApiTimestamp() {}, toast() {}, seekReview() {}, formatClock: String });
  timeline.openTimeline(1000, 20000, ['A', 'B']);
  assert.deepEqual(elements.timelineNames.children.map(item => item.textContent), ['A', 'B']);
  timeline.reorder(['B', 'A']);
  assert.deepEqual(elements.timelineNames.children.map(item => item.textContent), ['B', 'A']);
  assert.ok(requests.every(signal => !signal.aborted));
  timeline.clearTimeline();
  assert.ok(requests.every(signal => signal.aborted));
  assert.equal(timeline.end, null);
});
