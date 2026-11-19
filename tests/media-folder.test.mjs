import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const start = source.indexOf("    if (url.pathname === '/api/media-folder')");
const end = source.indexOf("    if (req.method === 'POST' && ['/api/media-file'", start);
assert.ok(start >= 0 && end > start);

function harness({ platform = 'win32', failSpawn = false } = {}) {
  const launches = [];
  const context = vm.createContext({ HOST: '127.0.0.1', PORT: 4177, path, process: { platform },
    queryValue: (url, key) => url.searchParams.get(key), safeId: id => /^[a-z0-9_-]+$/i.test(id || ''),
    getConfig: async () => ({ screenshotFolder: 'synthetic-images', videoFolder: 'synthetic-videos' }),
    sendJson: (_res, status, body) => ({ status, body }),
    spawn: (command, args, options) => {
      const child = new EventEmitter(); child.unref = () => { child.unreferenced = true; };
      launches.push({ command, args, options, child });
      queueMicrotask(() => child.emit(failSpawn ? 'error' : 'spawn', ...(failSpawn ? [new Error('erro sintético')] : [])));
      return child;
    } });
  vm.runInContext(`async function handle(req, res, url) { ${source.slice(start, end)} }`, context);
  const request = (query, headers = {}, method = 'POST') => context.handle({ method, headers: { host: '127.0.0.1:4177', origin: 'http://127.0.0.1:4177', ...headers } }, {}, new URL(`http://127.0.0.1:4177/api/media-folder?${query}`));
  return { request, launches };
}

test('abre apenas a pasta configurada para cada tipo de mídia', async () => {
  const h = harness();
  for (const [kind, folder] of [['screenshot', 'synthetic-images'], ['video', 'synthetic-videos']]) {
    const result = await h.request(`server=synthetic&folder=${kind}&path=ignored`);
    assert.equal(result.status, 200);
    const launch = h.launches.at(-1);
    assert.equal(launch.command, 'explorer.exe');
    assert.equal(launch.args[0], path.resolve(folder));
    assert.equal(launch.options.windowsHide, false, 'a janela do Explorador deve ficar visível');
    assert.equal(launch.child.unreferenced, true);
  }
});

test('rejeita origem, método, servidor e tipo inválidos sem abrir processos', async () => {
  const h = harness();
  assert.equal((await h.request('server=synthetic&folder=video', { origin: 'http://evil.invalid' })).status, 403);
  assert.equal((await h.request('server=synthetic&folder=video', { host: 'evil.invalid' })).status, 403);
  assert.equal((await h.request('server=synthetic&folder=video', {}, 'GET')).status, 403);
  await assert.rejects(h.request('server=..%2Fprivate&folder=video'), /inválida/);
  await assert.rejects(h.request('server=synthetic&folder=..%2Fprivate'), /inválida/);
  assert.equal(h.launches.length, 0);
});

test('propaga falha ao iniciar o aplicativo de arquivos', async () => {
  const h = harness({ platform: 'linux', failSpawn: true });
  await assert.rejects(h.request('server=synthetic&folder=video'), /erro sintético/);
  assert.equal(h.launches[0].command, 'xdg-open');
});
