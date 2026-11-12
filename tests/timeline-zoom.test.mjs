import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function setTimelineZoom(');
const end = source.indexOf("elements.timelineScroll.addEventListener('wheel'", start);
assert.ok(start >= 0 && end > start);

test('zoom mantém o instante sob o cursor quando há espaço para rolagem', () => {
  const scroll = { clientWidth: 1000, scrollWidth: 1000, scrollLeft: 0, getBoundingClientRect: () => ({ left: 100 }), classList: { toggle() {} } };
  const state = { timelineZoom: 1 };
  const context = vm.createContext({ state, elements: { timelineScroll: scroll }, Math, drawTimeline: () => { scroll.scrollWidth = scroll.clientWidth * state.timelineZoom; } });
  vm.runInContext(source.slice(start, end), context);
  context.setTimelineZoom(2, 850);
  assert.equal(scroll.scrollLeft, 750);
  assert.equal((scroll.scrollLeft + 750) / scroll.scrollWidth, 0.75);
  context.setTimelineZoom(1, 850);
  assert.equal(scroll.scrollLeft, 0);
});
