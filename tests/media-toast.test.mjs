import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/monitor/shell.js', import.meta.url), 'utf8');
const start = source.indexOf('function toast(message,');
const end = source.indexOf('function setConnection(', start);
assert.ok(start >= 0 && end > start);

test('aviso de mídia é um botão que abre a pasta e informa falhas', async () => {
  const nodes = [], requests = [];
  let ok = true;
  const context = vm.createContext({
    document: { createElement: tag => ({ tag, addEventListener(type, fn) { this[type] = fn; }, remove() { this.removed = true; } }) },
    elements: { toastRegion: { append: node => nodes.push(node) } },
    window: { setTimeout() {} }, query: data => new URLSearchParams(data),
    fetch: async (url, options) => { requests.push({ url, options }); return { ok }; }
  });
  vm.runInContext(source.slice(start, end), context);
  for (const folder of ['screenshot', 'video']) {
    context.toast('Salvo', 'info', { folder, server: 'sintetico' });
    const button = nodes.at(-1);
    assert.equal(button.tag, 'button');
    assert.equal(button.type, 'button');
    await button.click();
    const url = new URL(requests.at(-1).url, 'http://localhost');
    assert.equal(url.pathname, '/api/media-folder');
    assert.equal(url.searchParams.get('folder'), folder);
    assert.equal(url.searchParams.get('server'), 'sintetico');
    assert.equal(requests.at(-1).options.method, 'POST');
  }
  ok = false;
  await nodes[0].click();
  assert.equal(nodes.at(-1).tag, 'div');
  assert.match(nodes.at(-1).textContent, /Não foi possível abrir/);
  assert.match(nodes.at(-1).className, /error/);
});
