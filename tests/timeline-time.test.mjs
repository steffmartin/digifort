import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function inputToEpoch(');
const end = source.indexOf('function parseFrameEpoch(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ Intl, Date });
vm.runInContext(source.slice(start, end), context);

test('preserva milissegundos no horário do servidor', () => {
  for (const millis of ['000', '100', '249', '294', '999']) {
    const actual = context.inputToEpoch(`2018-03-13T13:00:00.${millis}`, 'America/Sao_Paulo');
    assert.equal(new Date(actual).toISOString(), `2018-03-13T16:00:00.${millis}Z`);
  }
});

test('rejeita horário inexistente na mudança de horário de verão', () => {
  assert.throws(() => context.inputToEpoch('2018-11-04T00:30:00.294', 'America/Sao_Paulo'));
});
