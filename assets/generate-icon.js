'use strict';

/**
 * Dependency-free icon generator. Rasterizes a simple "blood drop" mark on a
 * dark rounded-square background into a real PNG (assets/icon.png).
 *
 * Run with:  node assets/generate-icon.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 1024;

// --- tiny RGBA canvas ---
const buf = Buffer.alloc(SIZE * SIZE * 4);
function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  const ia = a / 255;
  buf[i] = Math.round(buf[i] * (1 - ia) + r * ia);
  buf[i + 1] = Math.round(buf[i + 1] * (1 - ia) + g * ia);
  buf[i + 2] = Math.round(buf[i + 2] * (1 - ia) + b * ia);
  buf[i + 3] = Math.max(buf[i + 3], a);
}

// Background: rounded square (#0d1117).
const radius = 180;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const inX = x >= radius && x < SIZE - radius;
    const inY = y >= radius && y < SIZE - radius;
    let inside = inX || inY;
    if (!inside) {
      const cx = x < radius ? radius : SIZE - radius;
      const cy = y < radius ? radius : SIZE - radius;
      inside = (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
    }
    if (inside) setPx(x, y, 13, 17, 23, 255);
  }
}

// Blood drop: a circle (lower) + a tapering tip (upper), centered.
const cx = SIZE / 2;
const dropCy = SIZE * 0.6;
const dropR = SIZE * 0.26;
const tipY = SIZE * 0.2;

function dropColor(dist) {
  // Radial shade from bright (#ff5a5f) center to deep (#b3262b) edge.
  const t = Math.min(1, dist / dropR);
  const r = Math.round(255 - t * 76);
  const g = Math.round(90 - t * 52);
  const b = Math.round(95 - t * 52);
  return [r, g, b];
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - cx;
    const dyc = y - dropCy;
    const inCircle = dx * dx + dyc * dyc <= dropR * dropR;

    // Triangle tip above the circle: width shrinks to 0 at tipY.
    let inTip = false;
    if (y >= tipY && y <= dropCy) {
      const frac = (y - tipY) / (dropCy - tipY); // 0 at tip → 1 at circle center
      const halfW = frac * frac * dropR; // quadratic taper for a smooth drop
      inTip = Math.abs(dx) <= halfW;
    }

    if (inCircle || inTip) {
      const dist = Math.sqrt(dx * dx + dyc * dyc);
      const [r, g, b] = dropColor(dist);
      setPx(x, y, r, g, b, 255);
    }
  }
}

// Glossy highlight.
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const dx = x - (cx - dropR * 0.32);
    const dy = y - (dropCy - dropR * 0.34);
    if (dx * dx + dy * dy <= (dropR * 0.22) ** 2) setPx(x, y, 255, 255, 255, 70);
  }
}

// --- PNG encoding ---
function crc32(bytes) {
  let crc = ~0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

// Add a filter byte (0) per scanline.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, 'icon.png');
fs.writeFileSync(out, png);
console.log(`Wrote ${out} (${(png.length / 1024).toFixed(0)} KB, ${SIZE}x${SIZE})`);
