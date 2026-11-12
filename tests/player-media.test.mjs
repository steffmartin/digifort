import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Trecho ausente: ${start}`);
  return source.slice(from, to);
}
const context = vm.createContext({ Uint8Array, TextEncoder, TextDecoder });
vm.runInContext(section('function getG726Config(', 'const state =') + section('function findNal(', 'async function audioSourceChanged('), context);

test('G.726 reconhece taxa e ordem explícitas e assume LSB quando omitida', () => {
  const explicit = context.getG726Config({ 'dgf-bitrate': '24000', 'bit-order': 'big-endian' }, 'audio/g726');
  assert.equal(explicit.rate, 24);
  assert.equal(explicit.bitOrder, 'msb');
  assert.equal(explicit.assumedBitOrder, false);
  const fallback = context.getG726Config({}, 'audio/g726-32');
  assert.equal(fallback.rate, 32);
  assert.equal(fallback.bitOrder, 'lsb');
  assert.equal(fallback.assumedBitOrder, true);
});

test('normaliza quadros HEVC com prefixos de tamanho', () => {
  const bytes = new Uint8Array([0, 0, 0, 2, 0x40, 1, 0, 0, 0, 2, 0x42, 1]);
  assert.deepEqual([...context.normalizeHevcAnnexB(bytes)], [0, 0, 0, 1, 0x40, 1, 0, 0, 0, 1, 0x42, 1]);
});

test('extrai cabeçalho AAC ADTS e rejeita dados inválidos', () => {
  const parsed = context.parseAdts(new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0, 0, 0, 0xaa]));
  assert.equal(parsed.sampleRate, 44100);
  assert.equal(parsed.channels, 2);
  assert.deepEqual([...parsed.description], [0x12, 0x10]);
  assert.deepEqual([...parsed.payload], [0xaa]);
  assert.equal(context.parseAdts(new Uint8Array([0xff, 0xf1])), null);
});

test('multipart aceita limites divididos entre blocos e preserva o frame', async () => {
  const bytes = new TextEncoder().encode('--camera\r\nContent-Length: 3\r\nDgf-Codec: H264\r\n\r\nabc\r\n--camera--\r\n');
  let offset = 0;
  const response = { headers: { get: () => 'multipart/mixed; boundary="camera"' }, body: { getReader: () => ({ async read() { if (offset >= bytes.length) return { done: true }; const value = bytes.slice(offset, offset += 3); return { value, done: false }; } }) } };
  const parts = [];
  await context.consumeMultipart(response, part => parts.push(part));
  assert.equal(parts.length, 1);
  assert.equal(parts[0].headers['dgf-codec'], 'H264');
  assert.equal(new TextDecoder().decode(parts[0].data), 'abc');
});
