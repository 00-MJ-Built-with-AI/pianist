// Draws the app icons (a small piano on a dark tile) as PNGs, with no dependencies.
// Run: node tools/make-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const insideRound = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** Colour of a point in unit coordinates (0–1); `maskable` keeps the art inside the safe zone. */
function shade(u, v, maskable) {
  const bg = hex('#151923');
  const ivory = hex('#f4f1ea');
  const gold = hex('#ffd166');
  if (!maskable && !insideRound(u, v, 0, 0, 1, 1, 0.22)) return null;
  // Scale the piano into the central 70 % for maskable icons.
  const s = maskable ? 0.78 : 1;
  const x = 0.5 + (u - 0.5) / s;
  const y = 0.5 + (v - 0.5) / s;
  const top = 0.24;
  const bottom = 0.76;
  if (insideRound(x, y, 0.15, top, 0.85, bottom, 0.05)) {
    // black keys
    for (const kx of [0.29, 0.47, 0.65]) if (x >= kx - 0.045 && x <= kx + 0.045 && y <= top + 0.3) return bg;
    // gaps between white keys below the black keys
    for (const gx of [0.29, 0.47, 0.65]) if (Math.abs(x - gx) < 0.007 && y > top + 0.3) return bg;
    return ivory;
  }
  // a gold line under the keyboard
  if (y > bottom + 0.05 && y < bottom + 0.075 && x > 0.3 && x < 0.7) return gold;
  return bg;
}

function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const ss = 4; // supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, maskable);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = ss * ss;
      const i = (py * size + px) * 4;
      const cov = a / 255;
      buf[i] = cov ? r / cov : 0;
      buf[i + 1] = cov ? g / cov : 0;
      buf[i + 2] = cov ? b / cov : 0;
      buf[i + 3] = a / n;
    }
  }
  return png(size, buf);
}

mkdirSync('public/icons', { recursive: true });
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, draw(size, false));
writeFileSync('public/icons/icon-maskable-512.png', draw(512, true));
writeFileSync('public/icons/apple-touch-icon.png', draw(180, true));
console.log('icons written');
