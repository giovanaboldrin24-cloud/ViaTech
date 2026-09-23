// Gera os ícones PNG do app (sem dependências): quadrado arredondado com gradiente e um "check".
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function sample(u, v, rounded) {
  // u, v em [0,1]
  if (rounded) {
    const r = 0.22; const cx = Math.min(Math.max(u, r), 1 - r); const cy = Math.min(Math.max(v, r), 1 - r);
    if (Math.hypot(u - cx, v - cy) > r) return null;
  }
  const t = (u + v) / 2;
  const from = [67, 56, 202]; const to = [190, 41, 120];
  let col = from.map((c, i) => c + (to[i] - c) * t);
  // anel
  const d = Math.hypot(u - 0.5, v - 0.5);
  const ring = Math.abs(d - 0.28) < 0.035;
  // check
  const w = 0.045;
  const check = segDist(u, v, 0.37, 0.51, 0.47, 0.61) < w || segDist(u, v, 0.47, 0.61, 0.65, 0.41) < w;
  if (ring || check) col = [255, 255, 255];
  return col;
}
function icon(size, rounded) {
  const ss = 4;
  return png(size, (x, y) => {
    let r = 0; let g = 0; let b = 0; let a = 0;
    for (let i = 0; i < ss; i += 1) for (let j = 0; j < ss; j += 1) {
      const c = sample((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size, rounded);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
    }
    if (!a) return [0, 0, 0, 0];
    return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round((a / (ss * ss)) * 255)];
  });
}
mkdirSync(new URL("../public/icons/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/icons/icon-192.png", import.meta.url), icon(192, true));
writeFileSync(new URL("../public/icons/icon-512.png", import.meta.url), icon(512, false));
writeFileSync(new URL("../public/icons/apple-touch-icon.png", import.meta.url), icon(180, false));
console.log("Ícones gerados em public/icons/");
