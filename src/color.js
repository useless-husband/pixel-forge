// 顏色以 32 位元整數儲存：0xAABBGGRR（與 little-endian 的 RGBA 位元組相同）。
// 所有轉換都用位移完成，不依賴機器的位元組順序。

export const pack = (r, g, b, a = 255) =>
  ((a & 255) << 24 | (b & 255) << 16 | (g & 255) << 8 | (r & 255)) >>> 0;

export const unpack = (c) => [c & 255, (c >>> 8) & 255, (c >>> 16) & 255, c >>> 24];

/** 解析 #rgb / #rrggbb / #rrggbbaa，失敗回傳 null。 */
export function parseHex(str) {
  if (typeof str !== 'string') return null;
  let m = str.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(m)) m = m.split('').map((x) => x + x).join('');
  if (/^[0-9a-f]{6}$/i.test(m)) m += 'ff';
  if (!/^[0-9a-f]{8}$/i.test(m)) return null;
  const n = parseInt(m, 16);
  return pack((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
}

export function toHex(c, withAlpha = false) {
  const [r, g, b, a] = unpack(c);
  const h = (v) => v.toString(16).padStart(2, '0');
  return '#' + h(r) + h(g) + h(b) + (withAlpha ? h(a) : '');
}

/** 以 alpha 混合（source over），兩者皆為非預乘 alpha。opacity 為 0..1 的圖層不透明度。 */
export function blendPacked(dst, src, opacity = 1) {
  const sa0 = src >>> 24;
  if (sa0 === 0) return dst >>> 0;
  const sa = (sa0 / 255) * opacity;
  if (sa <= 0) return dst >>> 0;
  const da = (dst >>> 24) / 255;
  const sr = src & 255, sg = (src >>> 8) & 255, sb = (src >>> 16) & 255;
  if (da === 0) return pack(sr, sg, sb, Math.round(sa * 255));
  if (sa >= 1) return pack(sr, sg, sb, 255);
  const oa = sa + da * (1 - sa);
  const k = da * (1 - sa);
  const dr = dst & 255, dg = (dst >>> 8) & 255, db = (dst >>> 16) & 255;
  return pack(
    Math.round((sr * sa + dr * k) / oa),
    Math.round((sg * sa + dg * k) / oa),
    Math.round((sb * sa + db * k) / oa),
    Math.round(oa * 255),
  );
}
