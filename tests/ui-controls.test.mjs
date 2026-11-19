import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { inputToEpoch } from '../public/review/time.js';

const playbackSource = readFileSync(new URL('../public/review/playback.js', import.meta.url), 'utf8');
const source = readFileSync(new URL('../public/monitor/shell.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Trecho ausente: ${start}`);
  return source.slice(from, to);
}

test('seleção de mosaico respeita o limite do servidor e as câmeras abertas', () => {
  const messages = [], applied = [];
  const state = { mosaic: 'auto', server: { maxCams: 8 }, tiles: new Map() };
  const elements = { mosaicSelect: { value: 'auto' } };
  const context = vm.createContext({ state, elements, toast: message => messages.push(message), applyMosaic: () => applied.push(state.mosaic) });
  vm.runInContext(section('const MOSAICS =', 'function setupMosaics(') + section('function selectMosaic(', "elements.mosaicSelect.addEventListener('change'"), context);
  context.selectMosaic('4x4-ten');
  assert.equal(state.mosaic, 'auto');
  assert.match(messages.pop(), /limite de câmeras/);
  for (let i = 0; i < 7; i++) state.tiles.set(String(i), {});
  context.selectMosaic('3x3-six');
  assert.equal(state.mosaic, 'auto');
  assert.match(messages.pop(), /Feche 1 câmera/);
  context.selectMosaic('4x4-eight');
  assert.equal(state.mosaic, '4x4-eight');
  assert.deepEqual(applied, ['4x4-eight']);
});

test('alternar revisão atualiza controles, perfis e transmissões', () => {
  const attrs = () => ({ classList: { toggle() {}, add() {}, remove() {} }, setAttribute(name, value) { this[name] = value; } });
  let restarts = 0, cleared = 0;
  const player = { profile: 'Visualization', lastLiveProfile: 'Visualization', tile: { querySelector: () => attrs() }, restart: () => restarts++ };
  const state = { mode: 'live', tiles: new Map([['A', player]]), recordings: new Map(), thumbnailActive: false };
  const elements = { liveMode: attrs(), reviewMode: attrs(), reviewFields: {}, timelineStatus: {} };
  const context = vm.createContext({ state, elements, updateOverlayState() {}, setDefaultReviewTimes() {}, clearTimeline: () => cleared++, updateViewHeader() {}, stopPresenceWorker() {}, playbackReview: { reset() {} } });
  vm.runInContext(section('function setMode(', 'function parseFrameEpoch('), context);
  context.setMode('playback');
  assert.equal(player.profile, 'Recording');
  assert.equal(elements.reviewFields.hidden, false);
  assert.equal(elements.reviewMode['aria-pressed'], 'true');
  context.setMode('live');
  assert.equal(player.profile, 'Visualization');
  assert.equal(elements.reviewFields.hidden, true);
  assert.equal(restarts, 2);
  assert.equal(cleared, 2);
});

test('revisão rejeita período invertido e não reinicia câmeras', () => {
  const messages = [];
  let restarts = 0;
  const state = { tiles: new Map([['A', { restart: () => restarts++ }]]), server: { timeZone: 'UTC' } };
  const elements = { startDateTime: { value: '2024-01-02T10:00' }, endDateTime: { value: '2024-01-02T09:00' } };
  const context = vm.createContext({ state, period: state, elements, Intl, Date, inputToEpoch, toast: message => messages.push(message), clearThumbnails() {}, loadFocusedTimeline() {}, updateViewHeader() {}, stopPresenceWorker() {} });
  vm.runInContext(playbackSource.slice(playbackSource.indexOf('function startReview('), playbackSource.indexOf('function loadFocusedTimeline(')), context);
  context.startReview();
  assert.match(messages[0], /fim precisa ser posterior/);
  assert.equal(restarts, 0);
  elements.endDateTime.value = '2024-01-02T11:00';
  context.startReview();
  assert.equal(state.reviewEpoch, Date.parse('2024-01-02T10:00:00Z'));
  assert.equal(restarts, 1);
});

test('ocultar e restaurar timeline limpa e recarrega suas faixas', () => {
  const calls = [];
  const state = { overlaysVisible: false, timelineVisible: true, mode: 'playback', reviewStart: 1, focused: 'A' };
  const elements = { timelineStatus: {} };
  const context = vm.createContext({ state, elements, clearTimeline: () => calls.push('limpar'), updateOverlayState: () => calls.push('atualizar'), loadFocusedTimeline: camera => calls.push(`carregar ${camera}`) });
  vm.runInContext(section('function setDisplayVisibility(', 'function closeDisplayMenu('), context);
  context.setDisplayVisibility({ timeline: false });
  assert.equal(state.timelineVisible, false);
  assert.equal(elements.timelineStatus.textContent, 'Timeline ocultada.');
  context.setDisplayVisibility({ timeline: true, overlays: true });
  assert.equal(state.overlaysVisible, true);
  assert.deepEqual(calls, ['limpar', 'atualizar', 'atualizar', 'carregar A']);
});

test('troca de fonte de áudio interrompe a anterior e respeita pausa', async () => {
  const calls = [];
  const state = { tiles: new Map([['A', { stopAudioStream: () => calls.push('parar A') }], ['B', { startAudioStream: async () => calls.push('iniciar B') }]]), allStopped: false, audioEnabled: true };
  const context = vm.createContext({ state });
  vm.runInContext(section('async function audioSourceChanged(', 'const playbackReview ='), context);
  await context.audioSourceChanged('A', 'B');
  assert.deepEqual(calls, ['parar A', 'iniciar B']);
  calls.length = 0;
  state.allStopped = true;
  await context.audioSourceChanged('A', 'B');
  assert.deepEqual(calls, ['parar A']);
  calls.length = 0;
  await context.audioSourceChanged('B', 'B');
  assert.deepEqual(calls, []);
});


test('mosaico de seis câmeras organiza duas grandes sobre quatro pequenas', () => {
  const context = vm.createContext({ state: {} });
  vm.runInContext(section('const MOSAICS =', 'function setupMosaics(') + '\nthis.mosaics = MOSAICS;', context);
  const mosaic = context.mosaics.find(item => item.id === '4x4-six');
  assert.equal(context.mosaics.indexOf(mosaic), 2);
  assert.deepEqual(Array.from(mosaic.slots, slot => Array.from(slot)), [[1,1,2,2],[1,3,2,2],[3,1,2,1],[3,2,2,1],[3,3,2,1],[3,4,2,1]]);
});
