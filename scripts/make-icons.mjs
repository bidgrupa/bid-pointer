// Generates icons/16.png, 48.png, 128.png without any image dependency:
// a dark rounded square with an orange "pointer" dot. Runs on every build.
// Also 512.png and 1024.png for Safari, whose Mac app takes its icon from the largest one, and
// store-128.png for the Chrome Web Store, which wants 96 px of art inside 16 px of transparent edge.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, pixelAt) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x + 0.5, y + 0.5);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** The icon drawn `art` px wide in the middle of a `size` px square. */
function icon(size, art = size) {
  const off = (size - art) / 2;
  const half = art / 2;
  const radius = art * 0.22;
  const dark = [17, 24, 39, 255];
  const orange = [255, 90, 31, 255];
  const white = [255, 255, 255, 255];
  return png(size, (px, py) => {
    const x = px - off;
    const y = py - off;
    // rounded square signed distance
    const qx = Math.abs(x - half) - (half - radius);
    const qy = Math.abs(y - half) - (half - radius);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
    const bg = clamp01(0.5 - d);
    let color = [0, 0, 0, 0];
    color = mix(color, dark, bg);
    const dist = Math.hypot(x - half, y - half);
    color = mix(color, orange, clamp01(0.5 - (dist - art * 0.3)));
    color = mix(color, white, clamp01(0.5 - (dist - art * 0.12)));
    return color.map(Math.round);
  });
}

mkdirSync('icons', { recursive: true });
for (const size of [16, 48, 128, 512, 1024]) writeFileSync(`icons/${size}.png`, icon(size));
writeFileSync('icons/store-128.png', icon(128, 96));
