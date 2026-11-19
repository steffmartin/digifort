import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/monitor/shell.js', import.meta.url), 'utf8');
const thumbnailSource = readFileSync(new URL('../public/review/thumbnails.js', import.meta.url), 'utf8');
const timelineSource = readFileSync(new URL('../public/review/timeline.js', import.meta.url), 'utf8');
const playbackSource = readFileSync(new URL('../public/review/playback.js', import.meta.url), 'utf8');
const functions = playbackSource.slice(playbackSource.indexOf('function startReview()'), playbackSource.indexOf('function seekReview('));

test('limite final sem data manual permanece fixo após ocultar e recarregar a timeline', () => {
  let now = 100000;
  const state = { mode: 'playback', server: { timeZone: 'UTC' }, tiles: new Map([['A', { restart() {} }]]), timelineVisible: true, timelineData: new Map() };
  const elements = { startDateTime: { value: 'start' }, endDateTime: { value: '' } };
  const context = vm.createContext({ state, period: state, timeline: state, thumb: state, elements, Date: { now: () => now }, inputToEpoch: () => 1000, clearThumbnails() {}, clearTimeline() { state.timelineStart = state.timelineEnd = null; }, loadTimeline() {}, drawTimeline() {}, updateViewHeader() {}, toast() {} });
  vm.runInContext(timelineSource.slice(timelineSource.indexOf('function openTimeline('), timelineSource.indexOf('function reorder(cameras)')), context);
  context.timelineReview = { openTimeline: context.openTimeline };
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
  const render = thumbnailSource.slice(thumbnailSource.indexOf('async function renderThumbnailPage('), thumbnailSource.indexOf('function resize()'));
  const clear = thumbnailSource.slice(thumbnailSource.indexOf('function cancelThumbnailPage()'), thumbnailSource.indexOf('const THUMBNAIL_INTERVALS'));
  class Element {
    constructor() { this.style = {}; this.dataset = {}; this.children = []; }
    setAttribute() {} addEventListener() {} append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    getBoundingClientRect() { return { width: 300, height: 205 }; }
  }
  const state = { thumbnailActive: true, server: { timeZone: 'UTC' }, reviewStart: 1000, reviewEnd: null, reviewLimitEnd: 11000, timelineEnd: null, tiles: new Map([['A', {}]]), thumbnailCamera: 'A', thumbnailSize: 'large', thumbnailInterval: 5, thumbnailAnchor: 6000, thumbnailRequestId: 0, thumbnailControllers: new Set(), thumbnailCache: new Map([[1000, 'one'], [6000, 'two'], [11000, 'three']]), thumbnails: [] };
  const elements = Object.fromEntries(['viewerGrid', 'thumbnailGrid', 'thumbnailPrev', 'thumbnailNext', 'thumbnailStatus'].map(name => [name, new Element()]));
  const context = vm.createContext({ state, thumb: state, elements, THUMBNAIL_SIZES: { large: [300, 205] }, document: { createElement: () => new Element() }, URL, Promise, Math, Number, Set, Array, formatClock: String });
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
