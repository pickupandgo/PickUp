'use strict';
const { deflateSync, inflateSync } = require('node:zlib');
function crc32(b) {
  let n = 0xffffffff;
  for (const x of b) {
    n ^= x;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(name, b) {
  const t = Buffer.from(name),
    l = Buffer.alloc(4),
    c = Buffer.alloc(4);
  l.writeUInt32BE(b.length);
  c.writeUInt32BE(crc32(Buffer.concat([t, b])));
  return Buffer.concat([l, t, b, c]);
}
function photo(red = 17, text = 'synthetic-clean') {
  const h = Buffer.alloc(13);
  h.writeUInt32BE(1, 0);
  h.writeUInt32BE(1, 4);
  h[8] = 8;
  h[9] = 6;
  return Buffer.concat([
    signature,
    chunk('IHDR', h),
    chunk('tEXt', Buffer.from('Comment\0' + text)),
    chunk(
      'IDAT',
      deflateSync(Buffer.from([0, red, 33, 44, 255]), { level: 0 }),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
function inspect(b) {
  if (!b.subarray(0, 8).equals(signature)) return null;
  let at = 8,
    header = false,
    end = false,
    idat = [];
  while (at < b.length) {
    if (at + 12 > b.length) return null;
    const n = b.readUInt32BE(at),
      t = b.subarray(at + 4, at + 8),
      d = b.subarray(at + 8, at + 8 + n);
    if (
      at + 12 + n > b.length ||
      crc32(Buffer.concat([t, d])) !== b.readUInt32BE(at + 8 + n)
    )
      return null;
    const k = t.toString();
    if (k === 'IHDR') {
      if (
        header ||
        n !== 13 ||
        d.readUInt32BE(0) !== 1 ||
        d.readUInt32BE(4) !== 1 ||
        d[8] !== 8 ||
        d[9] !== 6
      )
        return null;
      header = true;
    }
    if (k === 'IDAT') idat.push(d);
    if (k === 'IEND') {
      end = true;
      if (n !== 0 || at + 12 !== b.length) return null;
    }
    at += n + 12;
  }
  try {
    const pixels = inflateSync(Buffer.concat(idat), { maxOutputLength: 1024 });
    if (!header || !end || pixels.length !== 5 || pixels[0] !== 0) return null;
  } catch {
    return null;
  }
  return {
    contentType: 'image/png',
    infected: b.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')),
  };
}
module.exports = { photo, inspect, crc32 };
