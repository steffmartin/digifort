import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, createWriteStream, promises as fs } from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const source = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const start = source.indexOf('async function finishRecording('), end = source.indexOf('async function handleMediaPost(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ fs, once });
vm.runInContext(source.slice(start, end), context);

test('finalização preserva somente blocos completos ao recuperar gravação', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'digifort-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const partPath = path.join(folder, 'sintetico.mp4.part'), finalPath = path.join(folder, 'sintetico.mp4');
  const stream = createWriteStream(partPath);
  await once(stream, 'open');
  await new Promise((resolve, reject) => stream.write('completo-incompleto', error => error ? reject(error) : resolve()));
  await context.finishRecording({ stream, partPath, finalPath, completedBytes: 8 }, true);
  assert.equal(await fs.readFile(finalPath, 'utf8'), 'completo');
  await assert.rejects(fs.stat(partPath), { code: 'ENOENT' });
});

test('recuperação descarta gravação sem blocos completos', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'digifort-test-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const partPath = path.join(folder, 'vazio.mp4.part'), finalPath = path.join(folder, 'vazio.mp4');
  const stream = createWriteStream(partPath);
  await once(stream, 'open');
  await context.finishRecording({ stream, partPath, finalPath, completedBytes: 0 }, true);
  await assert.rejects(fs.stat(partPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(finalPath), { code: 'ENOENT' });
});
