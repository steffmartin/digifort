import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const clear = source.slice(source.indexOf('function cancelThumbnailPage()'), source.indexOf('const THUMBNAIL_INTERVALS'));
const render = source.slice(source.indexOf('async function renderThumbnailPage('), source.indexOf('function clockTick()'));

class Element {
  constructor() { this.style = {}; this.dataset = {}; this.children = []; }
  setAttribute() {}
  addEventListener() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  getBoundingClientRect() { return { width: 800, height: 600 }; }
}

test('ao mudar de página cancela requisições antigas e não inicia outras antigas', async () => {
  const requests = [];
  const state = { thumbnailActive: true, server: { timeZone: 'UTC' }, serverId: 'test', reviewStart: 1000, timelineEnd: 10000000, reviewEnd: 10000000, tiles: new Map([['test', {}]]), thumbnailCamera: 'test', thumbnailSize: 'small', thumbnailInterval: 5, thumbnailAnchor: 1000, thumbnailRequestId: 0, thumbnailControllers: new Set(), thumbnailCache: new Map(), thumbnails: [] };
  const elements = Object.fromEntries(['viewerGrid', 'thumbnailGrid', 'thumbnailPrev', 'thumbnailNext', 'thumbnailStatus'].map(name => [name, new Element()]));
  const context = vm.createContext({ state, elements, THUMBNAIL_SIZES: { small: [75, 51], large: [300, 205] }, document: { createElement: () => new Element() }, AbortController, URL, Promise, Math, Number, Set, Array, epochToApi: epoch => ({ date: String(epoch), time: '00' }), query: params => new URLSearchParams(params), formatClock: String, fetch: (url, options) => new Promise((resolve, reject) => { const request = { url, aborted: false }; requests.push(request); options.signal.addEventListener('abort', () => { request.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); }) });
  vm.runInContext(clear + render, context);
  const first = context.renderThumbnailPage(0);
  assert.equal(requests.length, 4);
  const second = context.renderThumbnailPage(1);
  await first;
  assert.equal(requests.length, 8);
  assert.ok(requests.slice(0, 4).every(request => request.aborted));
  assert.ok(requests.slice(4).every(request => !request.aborted));
  context.clearThumbnails();
  await second;
  assert.equal(requests.length, 8);
});
