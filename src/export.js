// 匯出用的純函式：最近鄰放大、sprite sheet。

/** 最近鄰整數放大，畫素完全不模糊。data 可為 RGBA（ch=4）或索引（ch=1）。 */
export function scaleNearest(data, w, h, k, ch = 4) {
  if (!Number.isInteger(k) || k < 1) throw new RangeError('放大倍率必須是 ≥ 1 的整數');
  if (k === 1) return data.slice();
  const W = w * k;
  const out = new data.constructor(W * h * k * ch);
  for (let y = 0; y < h; y++) {
    // 先填好放大後的一列，再複製 k-1 次
    const first = y * k * W * ch;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * ch;
      for (let dx = 0; dx < k; dx++) {
        const d = first + (x * k + dx) * ch;
        for (let c = 0; c < ch; c++) out[d + c] = data[s + c];
      }
    }
    const rowLen = W * ch;
    for (let dy = 1; dy < k; dy++) out.copyWithin(first + dy * rowLen, first, first + rowLen);
  }
  return out;
}

export const MAX_EXPORT_SIDE = 4096;

/** 在單邊不超過 MAX_EXPORT_SIDE 的前提下，允許的最大放大倍率（上限 32）。 */
export function maxScaleFor(w, h) {
  return Math.max(1, Math.min(32, Math.floor(MAX_EXPORT_SIDE / Math.max(w, h))));
}

/**
 * 排 sprite sheet。frames: [{rgba, duration}]；layout: 'row' | 'grid'。
 * 回傳 {rgba, width, height, json}，json 是「frames 陣列」風格，可直接給遊戲引擎讀。
 */
export function buildSpriteSheet({ frames, width, height, layout = 'row', columns, scale = 1, padding = 0, imageName = 'sheet.png' }) {
  if (!frames.length) throw new Error('沒有影格可以排');
  const n = frames.length;
  const cols = layout === 'row' ? n : Math.min(n, Math.max(1, columns || Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / cols);
  const cw = width * scale, ch = height * scale;
  const W = cols * cw + (cols + 1) * padding;
  const H = rows * ch + (rows + 1) * padding;
  const rgba = new Uint8ClampedArray(W * H * 4);
  const meta = [];
  frames.forEach((f, i) => {
    const px = scale > 1 ? scaleNearest(f.rgba, width, height, scale) : f.rgba;
    const ox = padding + (i % cols) * (cw + padding);
    const oy = padding + Math.floor(i / cols) * (ch + padding);
    for (let y = 0; y < ch; y++) {
      rgba.set(px.subarray(y * cw * 4, (y + 1) * cw * 4), ((oy + y) * W + ox) * 4);
    }
    meta.push({ filename: `frame_${i}`, frame: { x: ox, y: oy, w: cw, h: ch }, duration: f.duration });
  });
  return {
    rgba,
    width: W,
    height: H,
    json: {
      frames: meta,
      meta: { app: 'Pixel Forge', image: imageName, size: { w: W, h: H }, scale, layout, columns: cols, rows },
    },
  };
}
