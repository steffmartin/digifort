import test from 'node:test';
import assert from 'node:assert/strict';
import { inputToEpoch } from '../public/review/time.js';

test('preserva milissegundos no horário do servidor', () => {
  for (const millis of ['000', '100', '249', '294', '999']) {
    const actual = inputToEpoch(`2018-03-13T13:00:00.${millis}`, 'America/Sao_Paulo');
    assert.equal(new Date(actual).toISOString(), `2018-03-13T16:00:00.${millis}Z`);
  }
});

test('rejeita horário inexistente na mudança de horário de verão', () => {
  assert.throws(() => inputToEpoch('2018-11-04T00:30:00.294', 'America/Sao_Paulo'));
});
