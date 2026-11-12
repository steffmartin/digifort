import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const clear = source.slice(source.indexOf('function cancelThumbnailPage()'), source.indexOf('const THUMBNAIL_INTERVALS'));
const openClose = source.slice(source.indexOf('async function openThumbnailView('), source.indexOf('async function renderThumbnailPage('));

test('sair limpa o cache e reabrir ancora a página zero no novo horário', async () => {
  const pages = [], revoked = [];
  const state = { reviewStart: 1000, reviewEnd: 100000, reviewEpoch: 2000, mode: 'playback', tiles: new Map([['A', { stop() {}, start() {} }]]), thumbnailCamera: '', thumbnailInterval: 300, thumbnailAnchor: null, thumbnailPage: 0, thumbnailActive: false, thumbnailCache: new Map(), thumbnailControllers: new Set(), thumbnailRequestId: 0 };
  const elements = { stopAll: {}, viewerGrid: { classList: { add() {}, remove() {} } }, thumbnailPanel: {}, thumbnailGrid: { replaceChildren() {} } };
  const context = vm.createContext({ state, elements, URL: { revokeObjectURL: url => revoked.push(url) }, Promise, Math, Date, updateOverlayState() {}, updateViewHeader() {}, setDisplayVisibility() {}, requestStopRecordingSession: () => [], renderThumbnailPage: page => pages.push(page) });
  vm.runInContext(clear + openClose, context);
  await context.openThumbnailView('A', 30);
  assert.equal(state.thumbnailAnchor, 2000);
  state.thumbnailPage = 2;
  state.thumbnailCache.set(2000, 'blob:cached');
  context.closeThumbnailView(false);
  assert.equal(state.thumbnailCache.size, 0);
  assert.deepEqual(revoked, ['blob:cached']);
  assert.equal(state.thumbnailAnchor, null);
  state.reviewEpoch = 32000;
  await context.openThumbnailView('A', 30);
  assert.equal(state.thumbnailAnchor, 32000);
  assert.deepEqual(pages, [0, 0]);
});
