// Regenerates icons/icon{16,32,48,128}.png. Run with `npm run icons`.
//
// Zero dependencies: shapes are rasterized into a supersampled RGBA buffer,
// box-downsampled for antialiasing, then written as PNG using only node:zlib.
// Edit the palette/geometry below and re-run to restyle the icon.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 8;
const OUT_DIR = path.join(__dirname, "..", "icons");

// Matches the extension's accent green (see the .fab / .btn.primary rules).
const GREEN = [0x1b, 0x7f, 0x4d];
const GREEN_DARK = [0x14, 0x60, 0x3a];
const WHITE = [0xff, 0xff, 0xff];

// ── Geometry, in normalized 0..1 units of the icon ──────────────────────
const TILE_RADIUS = 0.22; // rounded-square corner radius
const CARD = { x: 0.19, y: 0.17, w: 0.62, h: 0.66, r: 0.06 };

// Small icons need coarser, chunkier features to survive downsampling: a
// thicker header band and fatter grid lines, or the card renders as a white
// blob in the toolbar. Grid lines are dropped entirely at 16px.
function styleFor(size) {
  if (size <= 16) return { headerH: 0.22, lineWidth: 0.10, cols: 1, rows: 1 };
  if (size <= 32) return { headerH: 0.19, lineWidth: 0.075, cols: 1, rows: 1 };
  return { headerH: 0.17, lineWidth: 0.035, cols: 1, rows: 2 };
}

// ── Rasterizing ─────────────────────────────────────────────────────────
function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  r = Math.min(r, w / 2, h / 2);
  // Only the four corner boxes need the radius test.
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px;
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py;
  if (cx === px && cy === py) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// Paint every sample the predicate accepts. Shapes are opaque, so painting is
// an assignment and draw order alone decides what ends up on top.
function paint(buf, res, color, predicate) {
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      // Sample at pixel centers, in normalized units.
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
  const res = size * SUPERSAMPLE;
  const hi = new Uint8ClampedArray(res * res * 4); // transparent by default
  const { headerH, lineWidth, cols, rows } = styleFor(size);

  // 1) Green rounded tile.
  paint(hi, res, GREEN, (u, v) => insideRoundRect(u, v, 0, 0, 1, 1, TILE_RADIUS));

  // 2) White spreadsheet card.
  const { x, y, w, h, r } = CARD;
  paint(hi, res, WHITE, (u, v) => insideRoundRect(u, v, x, y, w, h, r));

  // 3) Darker header band across the top of the card (clipped to the card so
  //    it inherits the card's rounded top corners).
  paint(
    hi,
    res,
    GREEN_DARK,
    (u, v) => insideRoundRect(u, v, x, y, w, h, r) && v <= y + headerH
  );

  // 4) Grid lines, evenly dividing the card body below the header.
  if (lineWidth > 0 && (cols > 0 || rows > 0)) {
    const bodyTop = y + headerH;
    const bodyH = y + h - bodyTop;
    const rowYs = Array.from({ length: rows }, (_, i) => bodyTop + (bodyH * (i + 1)) / (rows + 1));
    const colXs = Array.from({ length: cols }, (_, i) => x + (w * (i + 1)) / (cols + 1));
    paint(hi, res, GREEN, (u, v) => {
      if (!insideRoundRect(u, v, x, y, w, h, r) || v < bodyTop) return false;
      if (colXs.some((cx) => Math.abs(u - cx) <= lineWidth / 2)) return true;
      return rowYs.some((ry) => Math.abs(v - ry) <= lineWidth / 2);
    });
  }

  // Box-downsample the supersampled buffer to the target size.
  const out = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const i = ((y * SUPERSAMPLE + sy) * res + (x * SUPERSAMPLE + sx)) * 4;
          const a = hi[i + 3] / 255;
          // Weight color by alpha so transparent samples don't darken the edge.
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
      out[o + 3] = Math.round((as / n) * 255);
    }
  }
  return out;
}

// ── Minimal PNG encoder (RGBA8, filter type 0) ──────────────────────────
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
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Main ────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT_DIR, `icon${size}.png`);
  const png = encodePNG(size, renderIcon(size));
  fs.writeFileSync(file, png);
  console.log(`wrote ${path.relative(path.join(__dirname, ".."), file)} (${png.length} bytes)`);
}
