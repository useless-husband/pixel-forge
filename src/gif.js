// GIF89a 編碼器（自己寫，無外部函式庫）：LZW、全域色表、透明色、NETSCAPE2.0 迴圈、每格延遲。
import { collectColors, medianCutColors, nearestIndex } from './quantize.js';
import { scaleNearest } from './export.js';

/** GIF 版 LZW。回傳未分塊的位元組串（不含最小碼長度欄位）。 */
export function lzwEncode(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const out = [];
  let cur = 0, shift = 0;
  const emit = (code, size) => {
    cur |= code << shift;
    shift += size;
    while (shift >= 8) { out.push(cur & 255); cur >>>= 8; shift -= 8; }
  };
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let dict = new Map();
  emit(clear, codeSize);
  if (indices.length === 0) { emit(eoi, codeSize); if (shift > 0) out.push(cur & 255); return Uint8Array.from(out); }
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix, codeSize);
    if (next === 4096) {
      emit(clear, codeSize);
      next = eoi + 1;
      codeSize = minCodeSize + 1;
      dict = new Map();
    } else {
      if (next >= (1 << codeSize)) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix, codeSize);
  emit(eoi, codeSize);
  if (shift > 0) out.push(cur & 255);
  return Uint8Array.from(out);
}

const u16 = (n) => [n & 255, (n >> 8) & 255];

/**
 * opts: {width, height, palette:[[r,g,b]], frames:[{indices, delay(ms)}],
 *        transparentIndex(-1 = 無), loop(0 = 無限；n = 再重複 n 次；false = 不寫迴圈區塊)}
 */
export function encodeGif({ width, height, palette, frames, transparentIndex = -1, loop = 0 }) {
  if (!(width > 0 && width < 65536 && height > 0 && height < 65536)) throw new RangeError('GIF 尺寸不合法');
  if (palette.length < 1 || palette.length > 256) throw new RangeError('色表大小必須是 1–256');
  let bits = 1;
  while ((1 << bits) < palette.length) bits++;
  const tableSize = 1 << bits;
  const minCode = Math.max(2, bits);

  const out = [];
  const push = (...a) => { for (const v of a) out.push(v); };
  for (const ch of 'GIF89a') push(ch.charCodeAt(0));
  push(...u16(width), ...u16(height), 0x80 | 0x70 | (bits - 1), 0, 0);
  for (let i = 0; i < tableSize; i++) {
    const c = palette[i] || [0, 0, 0];
    push(c[0], c[1], c[2]);
  }
  if (loop !== false) {
    push(0x21, 0xff, 0x0b);
    for (const ch of 'NETSCAPE2.0') push(ch.charCodeAt(0));
    push(0x03, 0x01, ...u16(loop), 0x00);
  }
  const hasT = transparentIndex >= 0;
  for (const f of frames) {
    if (f.indices.length !== width * height) throw new Error('影格像素數量與尺寸不符');
    const delay = Math.min(65535, Math.max(0, Math.round((f.delay ?? 100) / 10)));
    // 有透明色時用 disposal=2（繪製下一格前清除），避免上一格透出來
    push(0x21, 0xf9, 0x04, (hasT ? 2 << 2 : 1 << 2) | (hasT ? 1 : 0), ...u16(delay), hasT ? transparentIndex : 0, 0x00);
    push(0x2c, 0, 0, 0, 0, ...u16(width), ...u16(height), 0x00);
    push(minCode);
    const data = lzwEncode(f.indices, minCode);
    for (let p = 0; p < data.length; p += 255) {
      const chunk = data.subarray(p, Math.min(p + 255, data.length));
      push(chunk.length);
      for (const v of chunk) out.push(v);
    }
    push(0x00);
  }
  push(0x3b);
  return Uint8Array.from(out);
}

/**
 * 把多張 RGBA 影格轉成索引影格。所有影格共用一份全域色表。
 * alpha < 128 視為透明（使用索引 0）；顏色超過 256 種時用 median cut 縮減。
 */
export function indexFrames(rgbaFrames, alphaThreshold = 128) {
  const merged = new Map();
  let hasTransparent = false;
  for (const f of rgbaFrames) {
    for (const c of collectColors(f, alphaThreshold)) {
      const key = (c.r << 16) | (c.g << 8) | c.b;
      const e = merged.get(key);
      if (e) e.n += c.n; else merged.set(key, { ...c });
    }
    for (let i = 3; i < f.length; i += 4) if (f[i] < alphaThreshold) { hasTransparent = true; break; }
  }
  const room = hasTransparent ? 255 : 256;
  const colors = medianCutColors([...merged.values()], room);
  const exact = merged.size <= room;
  const palette = hasTransparent ? [[0, 0, 0], ...colors] : colors;
  const base = hasTransparent ? 1 : 0;
  const lookup = new Map();
  const frames = rgbaFrames.map((f) => {
    const idx = new Uint8Array(f.length >> 2);
    for (let i = 0, o = 0; i < idx.length; i++, o += 4) {
      if (f[o + 3] < alphaThreshold) { idx[i] = 0; continue; }
      const key = (f[o] << 16) | (f[o + 1] << 8) | f[o + 2];
      let v = lookup.get(key);
      if (v === undefined) {
        v = base + nearestIndex(colors, f[o], f[o + 1], f[o + 2]);
        lookup.set(key, v);
      }
      idx[i] = v;
    }
    return idx;
  });
  return { palette, frames, transparentIndex: hasTransparent ? 0 : -1, exact };
}

/** 高階介面：RGBA 影格 → GIF 位元組。scale 為整數放大倍率。 */
export function buildGif({ rgbaFrames, delays, width, height, scale = 1, loop = 0 }) {
  const { palette, frames, transparentIndex } = indexFrames(rgbaFrames);
  const W = width * scale, H = height * scale;
  return encodeGif({
    width: W,
    height: H,
    palette,
    transparentIndex,
    loop,
    frames: frames.map((idx, i) => ({
      indices: scale > 1 ? scaleNearest(idx, width, height, scale, 1) : idx,
      delay: delays[i],
    })),
  });
}
