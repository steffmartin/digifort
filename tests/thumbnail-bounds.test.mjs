import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function startReview()'), source.indexOf('function seekReview('));

test('limite final sem data manual permanece fixo após ocultar e recarregar a timeline', () => {
  let now = 100000;
  const state = { mode: 'playback', server: { timeZone: 'UTC' }, tiles: new Map([['A', { restart() {} }]]), timelineVisible: true, timelineData: new Map() };
  const elements = { startDateTime: { value: 'start' }, endDateTime: { value: '' } };
  const context = vm.createContext({ state, elements, Date: { now: () => now }, inputToEpoch: () => 1000, clearThumbnails() {}, clearTimeline() { state.timelineStart = state.timelineEnd = null; }, loadTimeline() {}, drawTimeline() {}, toast() {} });
  vm.runInContext(functions, context);
  context.startReview();
  assert.equal(state.timelineEnd, 100000);
  state.timelineVisible = false;
  context.clearTimeline();
  now = 200000;
  state.timelineVisible = true;
  context.loadFocusedTimeline();
  assert.equal(state.timelineEnd, 100000);
});

test('paginação respeita os dois limites, inclusive com timeline oculta', async () => {
  const render = source.slice(source.indexOf('async function renderThumbnailPage('), source.indexOf('function clockTick()'));
  const clear = source.slice(source.indexOf('function cancelThumbnailPage()'), source.indexOf('const THUMBNAIL_INTERVALS'));
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.children = []; }
    setAttribute() {} addEventListener() {} append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    getBoundingClientRect() { return { width: 300, height: 205 }; }
  }
  const state = { thumbnailActive: true, server: { timeZone: 'UTC' }, reviewStart: 1000, reviewEnd: null, reviewLimitEnd: 11000, timelineEnd: null, tiles: new Map([['A', {}]]), thumbnailCamera: 'A', thumbnailSize: 'large', thumbnailInterval: 5, thumbnailAnchor: 6000, thumbnailRequestId: 0, thumbnailControllers: new Set(), thumbnailCache: new Map([[1000, 'one'], [6000, 'two'], [11000, 'three']]), thumbnails: [] };
  const elements = Object.fromEntries(['viewerGrid', 'thumbnailGrid', 'thumbnailPrev', 'thumbnailNext', 'thumbnailStatus'].map(name => [name, new Element()]));
  const context = vm.createContext({ state, elements, THUMBNAIL_SIZES: { large: [300, 205] }, document: { createElement: () => new Element() }, URL, Promise, Math, Number, Set, Array, formatClock: String });
  vm.runInContext(clear + render, context);
  await context.renderThumbnailPage(-1);
  assert.deepEqual([...state.thumbnails], [1000]);
  assert.equal(elements.thumbnailPrev.disabled, true);
  assert.equal(elements.thumbnailNext.disabled, false);
  await context.renderThumbnailPage(1);
  assert.deepEqual([...state.thumbnails], [11000]);
  assert.equal(elements.thumbnailNext.disabled, true);
  assert.equal(elements.thumbnailPrev.disabled, false);
});
