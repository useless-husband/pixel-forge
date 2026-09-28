import { blendPacked, unpack } from './color.js';

/** 把某一影格所有可見圖層合成為 RGBA 位元組（非預乘 alpha）。 */
export function composeFrame(doc, frame) {
  const n = doc.width * doc.height;
  const acc = new Uint32Array(n);
  for (const layer of doc.layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const cel = layer.cels[frame];
    if (!cel) continue;
    const op = layer.opacity;
    for (let i = 0; i < n; i++) {
      const c = cel[i];
      if (c >>> 24 !== 0) acc[i] = blendPacked(acc[i], c, op);
    }
  }
  return packedToRgba(acc);
}

export function packedToRgba(px) {
  const out = new Uint8ClampedArray(px.length * 4);
  for (let i = 0, o = 0; i < px.length; i++, o += 4) {
    const [r, g, b, a] = unpack(px[i]);
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return out;
}

export function rgbaToPacked(rgba) {
  const n = rgba.length >> 2;
  const out = new Uint32Array(n);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    out[i] = ((rgba[o + 3] << 24) | (rgba[o + 2] << 16) | (rgba[o + 1] << 8) | rgba[o]) >>> 0;
  }
  return out;
}
