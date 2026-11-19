import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/media/player.js', import.meta.url), 'utf8');
const method = source.slice(source.indexOf('  retryStream(token) {'), source.indexOf('  async restart()', source.indexOf('  retryStream(token) {')));

test('reconexão progride até cinco minutos e para após essa tentativa', () => {
  const timers = [];
  const context = vm.createContext({ state: { mode: 'live' }, presenceAlarm: { streamUnavailable() {} }, toast() {}, setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; } });
  const Player = vm.runInContext(`(class { ${method} })`, context);
  const player = new Player();
  Object.assign(player, { stopped: false, requestToken: 1, retryDelay: 0, setMessage(value) { this.message = value; }, setState() {}, stop() { this.requestToken++; this.retryDelay = 0; }, start() {} });
  const expected = [0, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 300000];
  for (const delay of expected) {
    player.retryStream(player.requestToken);
    const timer = timers.shift();
    assert.equal(timer.delay, delay);
    timer.fn();
  }
  player.retryStream(player.requestToken);
  assert.equal(timers.length, 0);
  assert.match(player.message, /Não foi possível reconectar/);
});

test('tentativa antiga ou câmera parada não agenda reconexão', () => {
  let scheduled = 0;
  const context = vm.createContext({ state: { mode: 'live' }, setTimeout() { scheduled++; } });
  const Player = vm.runInContext(`(class { ${method} })`, context);
  const player = new Player();
  Object.assign(player, { stopped: false, requestToken: 2 });
  player.retryStream(1);
  player.stopped = true;
  player.retryStream(2);
  assert.equal(scheduled, 0);
});
