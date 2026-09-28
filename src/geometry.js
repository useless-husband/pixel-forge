// 點集合演算法：Bresenham 直線、矩形、橢圓。回傳 [x, y] 陣列，不做邊界裁切。

export function line(x0, y0, x1, y1) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const pts = [];
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return pts;
}

export function rectPoints(x0, y0, x1, y1, filled = false) {
  const l = Math.min(x0, x1), r = Math.max(x0, x1);
  const t = Math.min(y0, y1), b = Math.max(y0, y1);
  const pts = [];
  for (let y = t; y <= b; y++) {
    if (filled || y === t || y === b) {
      for (let x = l; x <= r; x++) pts.push([x, y]);
    } else {
      pts.push([l, y]);
      if (r !== l) pts.push([r, y]);
    }
  }
  return pts;
}

/** 以邊界框 (x0,y0)-(x1,y1) 為範圍的橢圓（Zingl 的整數中點演算法）。 */
export function ellipsePoints(x0, y0, x1, y1, filled = false) {
  let xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  let ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  const seen = new Map(); // key -> [x,y]
  const plot = (x, y) => { seen.set(y * 100003 + x, [x, y]); };

  const a0 = xb - xa, b0 = yb - ya;
  let b1 = b0 & 1;
  let dx = 4 * (1 - a0) * b0 * b0, dy = 4 * (b1 + 1) * a0 * a0;
  let err = dx + dy + b1 * a0 * a0;
  let yy0 = ya + ((b0 + 1) >> 1), yy1 = yy0 - b1;
  const a8 = 8 * a0 * a0;
  b1 = 8 * b0 * b0;
  let lx = xa, rx = xb;
  do {
    plot(rx, yy0); plot(lx, yy0); plot(lx, yy1); plot(rx, yy1);
    const e2 = 2 * err;
    if (e2 <= dy) { yy0++; yy1--; err += dy += a8; }
    if (e2 >= dx || 2 * err > dy) { lx++; rx--; err += dx += b1; }
  } while (lx <= rx);
  while (yy0 - yy1 < b0) { // 很扁的橢圓需要補完頂端
    plot(lx - 1, yy0); plot(rx + 1, yy0++); plot(lx - 1, yy1); plot(rx + 1, yy1--);
  }

  const outline = [...seen.values()];
  if (!filled) return outline;
  const span = new Map();
  for (const [x, y] of outline) {
    const s = span.get(y);
    if (!s) span.set(y, [x, x]);
    else { if (x < s[0]) s[0] = x; if (x > s[1]) s[1] = x; }
  }
  const pts = [];
  for (const [y, [l, r]] of span) for (let x = l; x <= r; x++) pts.push([x, y]);
  return pts;
}
