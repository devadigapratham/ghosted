// Regenerates icons/icon{16,32,48,128}.png. Run: npm run icons
//
// No dependencies; shapes get rasterized into a supersampled buffer, box
// averaged down for antialiasing, and written out with node:zlib. Tweak the
// constants below and re-run.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZES = [16, 32, 48, 128];
const SS = 8; // supersample factor
const OUT_DIR = path.join(__dirname, "..", "icons");

const GREEN = [0x1b, 0x7f, 0x4d];
const DARK = [0x11, 0x4f, 0x30];
const WHITE = [0xff, 0xff, 0xff];

const TILE_RADIUS = 0.22;
const GHOST = {
  cx: 0.5,
  r: 0.25, // head radius, and half the body width
  headCy: 0.42,
  bottom: 0.79,
};
const EYE = { dx: 0.098, cy: 0.385, r: 0.052 };
const MOUTH = { cy: 0.545, r: 0.036 };

function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  r = Math.min(r, w / 2, h / 2);
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  if (cx === px && cy === py) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

const insideCircle = (px, py, cx, cy, r) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

// Round head, straight sides, three scalloped bumps for the hem.
function insideGhost(u, v) {
  const { cx, r, headCy, bottom } = GHOST;
  const bumpR = r / 3;
  const hemTop = bottom - bumpR;

  if (v < headCy) return insideCircle(u, v, cx, headCy, r);
  if (v < hemTop) return Math.abs(u - cx) <= r;

  for (let i = 0; i < 3; i++) {
    const bx = cx - r + (2 * i + 1) * bumpR;
    if (insideCircle(u, v, bx, hemTop, bumpR)) return true;
  }
  return false;
}

// Every shape is opaque, so draw order alone decides what wins.
function paint(buf, res, color, predicate) {
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const u = (x + 0.5) / res;
      const v = (y + 0.5) / res;
      if (!predicate(u, v)) continue;
      const i = (y * res + x) * 4;
      buf[i] = color[0];
      buf[i + 1] = color[1];
      buf[i + 2] = color[2];
      buf[i + 3] = 255;
    }
  }
}

function renderIcon(size) {
  const res = size * SS;
  const hi = new Uint8ClampedArray(res * res * 4);

  paint(hi, res, GREEN, (u, v) => insideRoundRect(u, v, 0, 0, 1, 1, TILE_RADIUS));
  paint(hi, res, WHITE, insideGhost);
  paint(
    hi,
    res,
    DARK,
    (u, v) =>
      insideCircle(u, v, GHOST.cx - EYE.dx, EYE.cy, EYE.r) ||
      insideCircle(u, v, GHOST.cx + EYE.dx, EYE.cy, EYE.r)
  );
  // The mouth turns to mud below 32px, so it only shows on the larger icons.
  if (size >= 32) {
    paint(hi, res, DARK, (u, v) => insideCircle(u, v, GHOST.cx, MOUTH.cy, MOUTH.r));
  }

  const out = Buffer.alloc(size * size * 4);
  const samples = SS * SS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * res + (x * SS + sx)) * 4;
          const a = hi[i + 3] / 255;
          // Weight by alpha, or transparent samples darken the tile's edge.
          rs += hi[i] * a;
          gs += hi[i + 1] * a;
          bs += hi[i + 2] * a;
          as += a;
        }
      }
      const o = (y * size + x) * 4;
      if (as > 0) {
        out[o] = Math.round(rs / as);
        out[o + 1] = Math.round(gs / as);
        out[o + 2] = Math.round(bs / as);
      }
      out[o + 3] = Math.round((as / samples) * 255);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(file, encodePNG(size, renderIcon(size)));
  console.log(`wrote icons/icon${size}.png`);
}
