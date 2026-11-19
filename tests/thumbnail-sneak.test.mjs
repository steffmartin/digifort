import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/review/thumbnails.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function cancelThumbnailPage()'), source.indexOf('const THUMBNAIL_INTERVALS')) + source.slice(source.indexOf('async function renderThumbnailPage('), source.indexOf('function resize()'));

class Element {
  constructor(tag = '') { this.tag = tag; this.style = { setProperty(name, value) { this[name] = value; } }; this.dataset = {}; this.children = []; this.events = {}; }
  setAttribute() {}
  addEventListener(type, fn) { (this.events[type] ||= []).push(fn); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  getBoundingClientRect() { return { width: 604, height: 233 }; }
  set src(value) { this._src = value; queueMicrotask(() => this.fire('load')); }
  fire(type) { return Promise.all((this.events[type] || []).map(fn => fn({}))); }
}

test('prévia intermediária é sob demanda, usa cache e navega ao ponto médio mesmo sem imagem', async () => {
  const requests = [], revoked = [], seeks = [];
  let fail = false;
  const state = { thumbnailActive: true, server: { timeZone: 'UTC' }, serverId: 'test', reviewStart: 1000, reviewEnd: 100000, tiles: new Map([['A', {}]]), thumbnailCamera: 'A', thumbnailSize: 'large', thumbnailInterval: 5, thumbnailAnchor: 1000, thumbnailRequestId: 0, thumbnailControllers: new Set(), thumbnailCache: new Map() };
  const elements = Object.fromEntries(['viewerGrid', 'thumbnailGrid', 'thumbnailPrev', 'thumbnailNext', 'thumbnailStatus'].map(name => [name, new Element()]));
  const urlApi = { createObjectURL: () => 'blob:preview', revokeObjectURL: value => revoked.push(value) };
  const context = vm.createContext({ state, thumb: state, elements, THUMBNAIL_SIZES: { large: [300, 205] }, document: { createElement: tag => new Element(tag) }, AbortController, URL: urlApi, Promise, Math, Number, Set, Array,
    epochToApi: epoch => ({ date: String(epoch), time: '00' }), query: params => new URLSearchParams(params), formatClock: String,
    closeThumbnailView() {}, seekReview: epoch => seeks.push(epoch), updateViewHeader() {},
    fetch: (url, options) => { requests.push(String(url)); if (String(url).includes('width=150')) return Promise.resolve(fail ? { ok: false } : { ok: true, blob: async () => ({ size: 1, type: 'image/jpeg' }) }); return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))); }
  });
  vm.runInContext(code, context);
  let page = context.renderThumbnailPage(0);
  let sneak = elements.thumbnailGrid.children.find(item => item.className === 'thumbnail-sneak');
  assert.ok(sneak);
  assert.equal(requests.length, 2);
  await sneak.fire('pointerenter');
  assert.match(requests[2], /date=3500/);
  assert.match(requests[2], /width=150&height=103/);
  assert.equal(sneak.dataset.loadState, 'loaded');
  assert.equal(state.thumbnailCache.size, 1);
  await sneak.fire('click'); assert.deepEqual(seeks, [3500]);
  context.cancelThumbnailPage(); await page;
  page = context.renderThumbnailPage(0);
  sneak = elements.thumbnailGrid.children.find(item => item.className === 'thumbnail-sneak');
  await sneak.fire('pointerenter');
  assert.equal(requests.filter(url => url.includes('width=150')).length, 1);
  context.clearThumbnails(); await page;
  assert.deepEqual(revoked, ['blob:preview']);
  state.thumbnailAnchor = 1000; fail = true;
  page = context.renderThumbnailPage(0);
  sneak = elements.thumbnailGrid.children.find(item => item.className === 'thumbnail-sneak');
  await sneak.fire('pointerenter');
  assert.equal(sneak.dataset.loadState, 'error');
  await sneak.fire('click'); assert.deepEqual(seeks, [3500, 3500]);
  context.clearThumbnails(); await page;
});
