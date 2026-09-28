// 與 UI 無關的繪圖輔助：筆刷形狀、抖動、鏡像、角度限制。

/** size×size 的方形筆刷，以 (x,y) 為中心（偶數尺寸偏向左上）。 */
export function brushPoints(x, y, size) {
  const o = (size - 1) >> 1;
  const pts = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) pts.push([x - o + dx, y - o + dy]);
  return pts;
}

/**
 * 抖動等級：0 關閉、1 = 25%、2 = 50%（棋盤）、3 = 75%。
 * 以絕對座標決定，所以重複描過同一處圖樣不會變。
 */
export function ditherAllows(x, y, level) {
  switch (level) {
    case 1: return (x & 1) === 0 && (y & 1) === 0;
    case 2: return ((x + y) & 1) === 0;
    case 3: return !((x & 1) === 1 && (y & 1) === 1);
    default: return true;
  }
}

export function mirrorPoints(pts, w, h, mirrorH, mirrorV) {
  if (!mirrorH && !mirrorV) return pts;
  const out = pts.slice();
  for (const [x, y] of pts) {
    if (mirrorH) out.push([w - 1 - x, y]);
    if (mirrorV) out.push([x, h - 1 - y]);
    if (mirrorH && mirrorV) out.push([w - 1 - x, h - 1 - y]);
  }
  return out;
}

/** 筆刷 → 抖動 → 鏡像，一次展開。 */
export function expandPoints(pts, { size = 1, dither = 0, w, h, mirrorH = false, mirrorV = false }) {
  const out = [];
  for (const [x, y] of pts) {
    for (const p of brushPoints(x, y, size)) if (ditherAllows(p[0], p[1], dither)) out.push(p);
  }
  return mirrorPoints(out, w, h, mirrorH, mirrorV);
}

/** 按住 Shift 畫直線：吸附到水平、垂直或 45 度。 */
export function snapLine(x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax > 2 * ay) return [x1, y0];
  if (ay > 2 * ax) return [x0, y1];
  const m = Math.max(ax, ay);
  return [x0 + Math.sign(dx) * m, y0 + Math.sign(dy) * m];
}

/** 按住 Shift 畫矩形/橢圓：變成正方形/圓。 */
export function snapSquare(x0, y0, x1, y1) {
  const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return [x0 + (x1 >= x0 ? m : -m), y0 + (y1 >= y0 ? m : -m)];
}
