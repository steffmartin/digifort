import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackReview } from '../public/review/playback.js';
import { epochToInput, inputToEpoch } from '../public/review/time.js';

test('interface da revisão fixa o fim, sincroniza saltos e limpa o período', t => {
  let now = 100000, restarts = 0;
  t.mock.method(Date, 'now', () => now);
  const ranges = [], playheads = [];
  const state = { mode: 'playback', timelineVisible: true, server: { timeZone: 'UTC', seekSeconds: 30 },
    tiles: new Map([['A', { restart() { restarts++; } }], ['B', { restart() { restarts++; } }]]) };
  const elements = { startDateTime: { value: '1970-01-01T00:00:10' }, endDateTime: { value: '' } };
  const review = createPlaybackReview({ state, elements, epochToInput, inputToEpoch, toast() {}, closeThumbnailView() {}, clearThumbnails() {},
    timelineReview: { openTimeline: (...args) => ranges.push(args) }, updateTimelinePlayhead: value => playheads.push(value), updateViewHeader() {} });
  review.startReview();
  assert.equal(review.start, 10000);
  assert.equal(review.limitEnd, 100000);
  now = 200000;
  review.loadFocusedTimeline();
  assert.deepEqual(ranges.map(range => range.slice(0, 2)), [[10000, 100000], [10000, 100000]]);
  review.skipReview(1);
  assert.equal(review.epoch, 40000);
  review.seekReview(300000);
  assert.equal(review.epoch, 100000);
  assert.deepEqual(playheads, [40000, 100000]);
  assert.equal(restarts, 6);
  review.reset();
  assert.equal(review.start, null);
  assert.equal(review.limitEnd, null);
});
