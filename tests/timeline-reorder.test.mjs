import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function reorderTiles()');
const end = source.indexOf('function updateSurveillance()', start);
assert.ok(start >= 0 && end > start);

test('reordenar a grade preserva os dados e os controladores da timeline', () => {
  const first = [{ kind: 'video' }], second = [{ kind: 'audio' }];
  const controller = new AbortController();
  const state = { tiles: new Map([['A', {}], ['B', {}]]), timelineData: new Map([['A', first], ['B', second]]), timelineControllers: [controller], timelineRequestId: 7, mode: 'playback', timelineVisible: true, timelineStart: 1 };
  const elements = { viewerGrid: { querySelectorAll: () => [{ dataset: { camera: 'B' } }, { dataset: { camera: 'A' } }] } };
  let drawn = 0;
  const context = vm.createContext({ state, elements, Map, drawTimeline: () => drawn++, applyMosaic() {}, updateAudioSources() {} });
  vm.runInContext(source.slice(start, end), context);
  context.reorderTiles();
  assert.deepEqual([...state.timelineData.keys()], ['B', 'A']);
  assert.equal(state.timelineData.get('A'), first);
  assert.equal(state.timelineData.get('B'), second);
  assert.equal(controller.signal.aborted, false);
  assert.equal(state.timelineRequestId, 7);
  assert.equal(drawn, 1);
});
