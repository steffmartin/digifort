import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('let updateDownload ='), source.indexOf('function safeId('));

test('download verifica o SHA-256 antes de disponibilizar o instalador', async () => {
  const payload = Buffer.from('instalador sintetico');
  const name = 'Digifort-Monitor-Setup-2.0.0.exe';
  const hash = createHash('sha256').update(payload).digest('hex');
  let expected = hash;
  const fetch = async url => url === 'sums'
    ? new Response(`${expected}  ${name}\n`)
    : new Response(payload, { headers: { 'content-length': String(payload.length) } });
  const context = vm.createContext({ fs, path, os, createHash, fetch, AbortSignal, console, Buffer });
  vm.runInContext(code + '\nthis.runDownload = downloadUpdate; this.result = () => ({ ...updateDownload, installer: updateInstaller });', context);
  const update = { name, checksumUrl: 'sums', assetUrl: 'installer' };
  await context.runDownload(update);
  const success = context.result();
  assert.equal(success.status, 'ready');
  assert.deepEqual(await fs.readFile(success.installer), payload);
  await fs.rm(path.dirname(success.installer), { recursive: true, force: true });
  expected = '0'.repeat(64);
  await context.runDownload(update);
  assert.equal(context.result().status, 'error');
});
