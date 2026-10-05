// 產生 PWA 圖示：node tools/make-icons.mjs
// 不依賴任何套件，直接用 zlib 寫出 PNG。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

/* ---------- PNG 編碼 ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** rgb: Uint8Array，長度 = w*h*3 */
function png(w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy ? rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
      : Buffer.from(rgb.subarray(y * w * 3, (y + 1) * w * 3)).copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- 幾何（單位座標 0..1），以 3x3 超取樣抗鋸齒 ---------- */
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const SKY = hex('#7ec8f5'), BRAND = hex('#4f9ede'), WHITE = [255, 255, 255], INK = hex('#3d8fd0');

function inRoundRect(x, y, rx0, ry0, rx1, ry1, r) {
  if (x < rx0 || x > rx1 || y < ry0 || y > ry1) return false;
  const cx = Math.min(Math.max(x, rx0 + r), rx1 - r);
  const cy = Math.min(Math.max(y, ry0 + r), ry1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * 圖示內容：藍色圓角底 + 白色收據（底部鋸齒）+ 三條帳目線
 * @param scale 內容縮放（maskable 用 0.62 留安全區）
 */
function sample(x, y, scale) {
  // 背景：漸層 + 圓角（maskable 為滿版）
  const bg = mix(SKY, BRAND, y);
  const bleed = scale < 0.9;
  if (!bleed && !inRoundRect(x, y, 0, 0, 1, 1, 0.22)) return null; // 透明區→用背景色填滿避免灰邊

  // 把內容座標放大到中心
  const u = (x - 0.5) / scale + 0.5;
  const v = (y - 0.5) / scale + 0.5;

  const L = 0.26, R = 0.74, T = 0.17, B = 0.79;
  // 收據本體（底部鋸齒）
  if (u >= L && u <= R && v >= T) {
    const teeth = 6, amp = 0.035;
    const p = ((u - L) / (R - L)) * teeth;
    const tri = Math.abs((p % 1) - 0.5) * 2;          // 0..1
    const edge = B - amp * tri;
    if (v <= edge && inRoundRect(u, Math.min(v, B - amp), L, T, R, B, 0.06)) {
      // 帳目線
      for (let i = 0; i < 3; i++) {
        const ly = T + 0.13 + i * 0.14;
        const lw = [0.34, 0.28, 0.20][i];
        if (v >= ly && v <= ly + 0.055 && u >= L + 0.07 && u <= L + 0.07 + lw) return INK;
      }
      return WHITE;
    }
  }
  return bg;
}

function render(size, scale) {
  const buf = Buffer.alloc(size * size * 3);
  const SS = 3;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          const c = sample(x, y, scale) || [242, 246, 250];
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const i = (py * size + px) * 3, n = SS * SS;
      buf[i] = Math.round(r / n); buf[i + 1] = Math.round(g / n); buf[i + 2] = Math.round(b / n);
    }
  }
  return png(size, size, buf);
}

writeFileSync(join(OUT, 'icon-192.png'), render(192, 1));
writeFileSync(join(OUT, 'icon-512.png'), render(512, 1));
writeFileSync(join(OUT, 'icon-maskable-512.png'), render(512, 0.62));

/* ---------- SVG ---------- */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#7ec8f5"/><stop offset="1" stop-color="#4f9ede"/></linearGradient></defs>
  <rect width="512" height="512" rx="113" fill="url(#g)"/>
  <path fill="#fff" d="M133 118a31 31 0 0 1 31-31h184a31 31 0 0 1 31 31v288l-30.7-18-30.7 18-30.6-18-30.7 18-30.7-18-30.6 18-30.7-18-30.6 18z"/>
  <g fill="#3d8fd0">
    <rect x="169" y="153" width="174" height="28" rx="14"/>
    <rect x="169" y="225" width="143" height="28" rx="14"/>
    <rect x="169" y="297" width="102" height="28" rx="14"/>
  </g>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);
console.log('icons written to', OUT);
