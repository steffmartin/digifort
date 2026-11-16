import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('function seekReview('), source.indexOf('function epochToApi('));

test('salta pelo intervalo configurado, sincroniza câmeras e respeita limites', () => {
  let restarts = 0, playhead;
  const state = { mode: 'playback', reviewStart: 100000, reviewLimitEnd: 200000, reviewEpoch: 150000,
    server: { seekSeconds: 30 }, tiles: new Map([['A', { restart() { restarts++; } }], ['B', { restart() { restarts++; } }]]) };
  const context = vm.createContext({ state, clearThumbnails() {}, updateTimelinePlayhead: value => { playhead = value; } });
  vm.runInContext(code, context);
  context.skipReview(1);
  assert.equal(state.reviewEpoch, 180000);
  assert.equal(playhead, 180000);
  context.skipReview(1);
  assert.equal(state.reviewEpoch, 200000);
  context.skipReview(-1);
  assert.equal(state.reviewEpoch, 170000);
  context.skipReview(-1); context.skipReview(-1); context.skipReview(-1);
  assert.equal(state.reviewEpoch, 100000);
  assert.equal(restarts, 12);
  state.mode = 'live'; context.skipReview(1);
  assert.equal(restarts, 12);
});

test('usa quinze segundos por padrão', () => {
  const state = { mode: 'playback', reviewStart: 100000, reviewLimitEnd: 200000, reviewEpoch: 150000, server: {}, tiles: new Map([['A', { restart() {} }]]) };
  const context = vm.createContext({ state, clearThumbnails() {}, updateTimelinePlayhead() {} });
  vm.runInContext(code, context);
  context.skipReview(-1);
  assert.equal(state.reviewEpoch, 135000);
});
