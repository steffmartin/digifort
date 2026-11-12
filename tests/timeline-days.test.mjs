import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('let timelineDayCache');
const end = source.indexOf('function drawTimeline()', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ Intl, Date, Math });
vm.runInContext(source.slice(start, end), context);
const boundaries = (start, end, zone) => Array.from(context.timelineDayBoundaries(Date.parse(start), Date.parse(end), zone), value => new Date(value).toISOString());

test('marca mudanças de dia no fuso configurado', () => {
  assert.deepEqual(boundaries('2026-11-10T20:00:00Z', '2026-11-12T05:00:00Z', 'America/Sao_Paulo'), ['2026-11-11T03:00:00.000Z', '2026-11-12T03:00:00.000Z']);
});

test('marca a mudança de dia quando meia-noite não existe no fuso', () => {
  assert.deepEqual(boundaries('2018-11-03T12:00:00Z', '2018-11-04T12:00:00Z', 'America/Sao_Paulo'), ['2018-11-04T03:00:00.000Z']);
});

test('não adiciona marca ao período que começa no início do dia', () => {
  assert.deepEqual(boundaries('2026-11-11T03:00:00Z', '2026-11-11T12:00:00Z', 'America/Sao_Paulo'), []);
});
