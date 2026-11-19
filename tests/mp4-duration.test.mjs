import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finalizeMp4Duration } from '../server/mp4-duration.mjs';

const u32 = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
const u64 = value => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); return b; };
const box = (type, ...parts) => { const payload = Buffer.concat(parts); return Buffer.concat([u32(payload.length + 8), Buffer.from(type), payload]); };
const full = (type, version, flags, ...parts) => box(type, Buffer.from([version, flags >> 16 & 255, flags >> 8 & 255, flags & 255]), ...parts);
function fixture() {
  const mvhd = full('mvhd', 1, 0, u64(0), u64(0), u32(1000), u64(0));
  const track = (id, scale) => box('trak', full('tkhd', 1, 0, u64(0), u64(0), u32(id)), box('mdia', full('mdhd', 1, 0, u64(0), u64(0), u32(scale))));
  const trex = (id, duration) => full('trex', 0, 0, u32(id), u32(1), u32(duration), u32(0), u32(0));
  const traf = (id, base, durations) => box('traf', full('tfhd', 0, 0, u32(id)), full('tfdt', 1, 0, u64(base)), full('trun', 0, 0x100, u32(durations.length), ...durations.map(u32)));
  return Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', mvhd, track(1, 1000), track(2, 48000), box('mvex', trex(1, 0), trex(2, 0))), box('moof', traf(1, 1000, [400, 600]), traf(2, 96000, [24000, 24000])), box('mdat', Buffer.alloc(16))]);
}
test('finaliza duração a partir do último fragmento entre pistas com escalas diferentes', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mp4-duration-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'recording.mp4'), original = fixture(); await writeFile(file, original);
  assert.equal(await finalizeMp4Duration(file), true);
  const result = await readFile(file), offset = result.indexOf('mvhd') + 28;
  assert.equal(result.readBigUInt64BE(offset), 3000n);
  result.writeBigUInt64BE(0n, offset); assert.deepEqual(result, original);
});
test('não altera MP4 truncado ou estrutura que não pode ser interpretada', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mp4-duration-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'truncated.mp4'), bytes = fixture().subarray(0, fixture().length - 1); await writeFile(file, bytes);
  assert.equal(await finalizeMp4Duration(file), false); assert.deepEqual(await readFile(file), bytes);
});
