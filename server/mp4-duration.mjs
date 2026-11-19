import { open } from 'node:fs/promises';

// Inspect only MP4 metadata; media payloads may be many gigabytes long.
const MAX_METADATA = 16 * 1024 * 1024;
class InvalidMp4 extends Error {}
function boxes(buffer, start = 0, end = buffer.length) {
  const result = [];
  for (let pos = start; pos < end;) {
    if (pos + 8 > end) throw new InvalidMp4();
    let size = buffer.readUInt32BE(pos), header = 8;
    if (size === 1) { if (pos + 16 > end) throw new InvalidMp4(); size = Number(buffer.readBigUInt64BE(pos + 8)); header = 16; }
    if (size === 0) size = end - pos;
    if (!Number.isSafeInteger(size) || size < header || pos + size > end) throw new InvalidMp4();
    result.push({ type: buffer.toString('ascii', pos + 4, pos + 8), start: pos + header, end: pos + size });
    pos += size;
  }
  return result;
}
function one(items, type) { const found = items.filter(item => item.type === type); if (found.length !== 1) throw new InvalidMp4(); return found[0]; }
function children(buffer, parent) { return boxes(buffer, parent.start, parent.end); }
function field(buffer, box, offset, length = 4) { if (offset < 0 || box.start + offset + length > box.end) throw new InvalidMp4(); return box.start + offset; }
function u32(buffer, box, offset) { return buffer.readUInt32BE(field(buffer, box, offset)); }
function time(buffer, box, offset, version) { return version === 1 ? buffer.readBigUInt64BE(field(buffer, box, offset, 8)) : BigInt(u32(buffer, box, offset)); }
function version(buffer, box) { const value = buffer[field(buffer, box, 0, 1)]; if (value > 1) throw new InvalidMp4(); return value; }

function inspectMovie(buffer) {
  const root = one(boxes(buffer), 'moov'), entries = children(buffer, root), mvhd = one(entries, 'mvhd'), v = version(buffer, mvhd);
  const scale = u32(buffer, mvhd, v ? 20 : 12), offset = field(buffer, mvhd, v ? 24 : 16, v ? 8 : 4);
  if (!scale || time(buffer, mvhd, v ? 24 : 16, v) !== 0n) throw new InvalidMp4();
  const tracks = new Map();
  for (const trak of entries.filter(entry => entry.type === 'trak')) {
    const items = children(buffer, trak), tkhd = one(items, 'tkhd'), tkver = version(buffer, tkhd);
    const id = u32(buffer, tkhd, tkver ? 20 : 12), mdhd = one(children(buffer, one(items, 'mdia')), 'mdhd'), mdver = version(buffer, mdhd);
    const timescale = u32(buffer, mdhd, mdver ? 20 : 12);
    if (!id || !timescale || tracks.has(id)) throw new InvalidMp4();
    tracks.set(id, { timescale, defaultDuration: 0 });
  }
  for (const trex of children(buffer, one(entries, 'mvex')).filter(entry => entry.type === 'trex')) {
    const track = tracks.get(u32(buffer, trex, 4)); if (!track) throw new InvalidMp4();
    track.defaultDuration = u32(buffer, trex, 12);
  }
  if (!tracks.size) throw new InvalidMp4();
  return { scale, offset, version: v, tracks };
}

function fragmentEnd(buffer, movie) {
  let max = 0n;
  for (const traf of children(buffer, one(boxes(buffer), 'moof')).filter(item => item.type === 'traf')) {
    const entries = children(buffer, traf), tfhd = one(entries, 'tfhd'), tfdt = one(entries, 'tfdt');
    const flags = u32(buffer, tfhd, 0) & 0xffffff, track = movie.tracks.get(u32(buffer, tfhd, 4));
    if (!track) throw new InvalidMp4();
    let p = 8; if (flags & 1) p += 8; if (flags & 2) p += 4;
    const defaultDuration = flags & 8 ? u32(buffer, tfhd, p) : track.defaultDuration;
    const v = version(buffer, tfdt); let decode = time(buffer, tfdt, 4, v);
    const runs = entries.filter(entry => entry.type === 'trun'); if (!runs.length) throw new InvalidMp4();
    for (const run of runs) {
      const runVersion = version(buffer, run), runFlags = u32(buffer, run, 0) & 0xffffff, count = u32(buffer, run, 4);
      let pos = 8 + (runFlags & 1 ? 4 : 0) + (runFlags & 4 ? 4 : 0);
      const stride = (runFlags & 0x100 ? 4 : 0) + (runFlags & 0x200 ? 4 : 0) + (runFlags & 0x400 ? 4 : 0) + (runFlags & 0x800 ? 4 : 0);
      if (pos + count * stride > run.end - run.start || count > 1000000 || (!stride && count && !defaultDuration)) throw new InvalidMp4();
      for (let i = 0; i < count; i++) {
        const duration = runFlags & 0x100 ? u32(buffer, run, pos) : defaultDuration; if (!duration) throw new InvalidMp4();
        let cts = 0n;
        if (runFlags & 0x800) { const at = field(buffer, run, pos + stride - 4); cts = BigInt(runVersion ? buffer.readInt32BE(at) : buffer.readUInt32BE(at)); }
        const end = decode + cts + BigInt(duration);
        const scaled = (end * BigInt(movie.scale) + BigInt(track.timescale) - 1n) / BigInt(track.timescale);
        if (scaled > max) max = scaled;
        decode += BigInt(duration); pos += stride;
      }
    }
  }
  return max;
}

export async function finalizeMp4Duration(filename) {
  const file = await open(filename, 'r+');
  try {
    const { size } = await file.stat(); let pos = 0, movie, duration = 0n, movieOffset = 0, awaitingMedia = false;
    while (pos < size) {
      const header = Buffer.alloc(16), read = await file.read(header, 0, 8, pos); if (read.bytesRead !== 8) throw new InvalidMp4();
      let length = header.readUInt32BE(0), headerSize = 8;
      if (length === 1) { if ((await file.read(header, 8, 8, pos + 8)).bytesRead !== 8) throw new InvalidMp4(); length = Number(header.readBigUInt64BE(8)); headerSize = 16; }
      if (length === 0) length = size - pos;
      if (!Number.isSafeInteger(length) || length < headerSize || pos + length > size) throw new InvalidMp4();
      const type = header.toString('ascii', 4, 8);
      if (type === 'moof') { if (awaitingMedia) throw new InvalidMp4(); awaitingMedia = true; }
      if (type === 'mdat' && awaitingMedia) { if (length === headerSize) throw new InvalidMp4(); awaitingMedia = false; }
      if (type === 'moov' || type === 'moof') {
        if (length > MAX_METADATA) throw new InvalidMp4();
        const data = Buffer.alloc(length); if ((await file.read(data, 0, length, pos)).bytesRead !== length) throw new InvalidMp4();
        if (type === 'moov') { if (movie) throw new InvalidMp4(); movie = inspectMovie(data); movieOffset = pos; }
        else { if (!movie) throw new InvalidMp4(); const end = fragmentEnd(data, movie); if (end > duration) duration = end; }
      }
      pos += length;
    }
    if (!movie || awaitingMedia || duration <= 0n || (!movie.version && duration > 0xffffffffn) || duration > 0xffffffffffffffffn) throw new InvalidMp4();
    const value = Buffer.alloc(movie.version ? 8 : 4); if (movie.version) value.writeBigUInt64BE(duration); else value.writeUInt32BE(Number(duration));
    await file.write(value, 0, value.length, movieOffset + movie.offset);
    return true;
  } catch (error) { if (error instanceof InvalidMp4 || error instanceof RangeError) return false; throw error; }
  finally { await file.close(); }
}
