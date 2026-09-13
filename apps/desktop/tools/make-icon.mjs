// Zero-dependency icon generator: renders the evogen mark (ascending arrow on
// a dark rounded square) and writes the PNG/ICO set Tauri needs.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'icons');
mkdirSync(outDir, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // no filter
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x / (size - 1), y / (size - 1));
      raw.writeUInt8(r, row + 1 + x * 4);
      raw.writeUInt8(g, row + 2 + x * 4);
      raw.writeUInt8(b, row + 3 + x * 4);
      raw.writeUInt8(a, row + 4 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function roundedRect(x, y, radius) {
  // SDF of a rounded square in unit space.
  const qx = Math.abs(x - 0.5) - (0.5 - radius);
  const qy = Math.abs(y - 0.5) - (0.5 - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
  return Math.hypot(px - (ax + abx * t), py - (ay + aby * t));
}

function pixel(x, y) {
  const coverage = Math.min(1, Math.max(0, 0.5 - roundedRect(x + 0.5 / 256, y + 0.5 / 256, 0.18) * 256 * 2));
  if (coverage <= 0) return [0, 0, 0, 0];

  // ascending arrow: shaft + head, mint gradient
  const shaft = distToSegment(x, y, 0.26, 0.72, 0.62, 0.36);
  const head =
    distToSegment(x, y, 0.44, 0.24, 0.76, 0.24) < 999 &&
    distToSegment(x, y, 0.76, 0.24, 0.76, 0.56) < 999 &&
    x + y >= 1.02; // triangle region above the diagonal
  const inHead = head && x >= 0.42 && x <= 0.8 && y >= 0.2 && y <= 0.6 && x - 0.42 + (y - 0.2) <= 0.42;
  const onArrow = shaft < 0.055 || inHead;
  const t = (1 - x) * 0.7;
  const accent = [Math.round(79 + t * 40), Math.round(214 - t * 30), Math.round(168 + t * 40)];

  const base = [Math.round(13 + (1 - y) * 6), Math.round(20 + (1 - y) * 10), Math.round(40 + (1 - y) * 15)];
  const color = onArrow ? accent : base;
  return [...color, Math.round(255 * coverage)];
}

writeFileSync(join(outDir, '32x32.png'), png(32, pixel));
writeFileSync(join(outDir, '128x128.png'), png(128, pixel));
writeFileSync(join(outDir, 'icon.png'), png(512, pixel));

// ICO wrapping the 256px PNG (valid on Windows Vista+)
const size = 256;
const image = png(size, pixel);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2); // icon
header.writeUInt16LE(1, 4); // one image
const entry = Buffer.alloc(16);
entry[0] = 0; // 256
entry[1] = 0;
entry[2] = 0;
entry[3] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(image.length, 8);
entry.writeUInt32LE(22, 12);
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, entry, image]));

console.log('icons written to', outDir);
