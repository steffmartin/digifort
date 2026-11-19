import test from 'node:test';
import assert from 'node:assert/strict';
import { createThumbnailReview } from '../public/review/thumbnails.js';

class Element {
  constructor() {
    this.style = { setProperty() {} };
    this.dataset = {};
    this.children = [];
    this.classList = { add() {}, remove() {} };
  }
  setAttribute() {}
  addEventListener() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  getBoundingClientRect() { return { width: 300, height: 205 }; }
}

test('interface de miniaturas cancela a página anterior e libera os pedidos ao fechar', async t => {
  const requests = [];
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  t.mock.method(globalThis, 'fetch', (_url, { signal }) => new Promise((_resolve, reject) => {
    const request = { aborted: false };
    requests.push(request);
    signal.addEventListener('abort', () => { request.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  }));
  const state = { server: { timeZone: 'UTC' }, serverId: 'test', reviewStart: 1000, reviewEnd: 20000,
    reviewLimitEnd: 20000, reviewEpoch: 1000, mode: 'playback', tiles: new Map([['A', { stop() {}, start() {} }]]) };
  const elements = Object.fromEntries(['viewerGrid', 'thumbnailPanel', 'thumbnailGrid', 'thumbnailPrev', 'thumbnailNext', 'thumbnailStatus', 'stopAll'].map(name => [name, new Element()]));
  const review = createThumbnailReview({ state, elements, leaveFullscreen: async () => {}, updateOverlayState() {},
    requestStopRecordingSession: () => [], setDisplayVisibility() {}, updateViewHeader() {}, seekReview() {}, closeContextMenu() {},
    epochToApi: epoch => ({ date: String(epoch), time: '00' }), query: params => new URLSearchParams(params), formatClock: String });
  await review.openThumbnailView('A', 5);
  assert.equal(review.active, true);
  assert.equal(requests.length, 1);
  const next = review.next();
  assert.equal(requests[0].aborted, true);
  assert.equal(requests.length, 2);
  review.closeThumbnailView(false);
  await next;
  assert.equal(requests[1].aborted, true);
  assert.equal(review.active, false);
});
