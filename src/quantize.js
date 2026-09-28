// Median cut 色彩量化。

/** 取出不透明（alpha >= 128）像素的唯一顏色與出現次數，順序為首次出現。 */
export function collectColors(rgba, alphaThreshold = 128) {
  const counts = new Map();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < alphaThreshold) continue;
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts].map(([k, n]) => ({ r: k >> 16, g: (k >> 8) & 255, b: k & 255, n }));
}

/** colors: [{r,g,b,n}]；回傳最多 maxColors 個 [r,g,b]，依亮度排序。 */
export function medianCutColors(colors, maxColors) {
  if (maxColors < 1) throw new RangeError('maxColors 至少為 1');
  if (colors.length <= maxColors) return colors.map((c) => [c.r, c.g, c.b]);

  const range = (box) => {
    let lo = [255, 255, 255], hi = [0, 0, 0];
    for (const c of box) {
      const v = [c.r, c.g, c.b];
      for (let i = 0; i < 3; i++) { if (v[i] < lo[i]) lo[i] = v[i]; if (v[i] > hi[i]) hi[i] = v[i]; }
    }
    const spans = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
    const ch = spans.indexOf(Math.max(...spans));
    return { ch, span: spans[ch] };
  };

  const boxes = [colors.slice()];
  while (boxes.length < maxColors) {
    let best = -1, bestScore = 0, bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const { ch, span } = range(box);
      if (span > bestScore) { best = i; bestScore = span; bestCh = ch; }
    });
    if (best < 0) break;
    const box = boxes[best];
    const key = ['r', 'g', 'b'][bestCh];
    box.sort((a, b) => a[key] - b[key]);
    const total = box.reduce((s, c) => s + c.n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i].n;
      cut = i + 1;
      if (acc >= total / 2) break;
    }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }

  const palette = boxes.map((box) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const c of box) { n += c.n; r += c.r * c.n; g += c.g * c.n; b += c.b * c.n; }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  });
  const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return palette.sort((a, b) => lum(a) - lum(b));
}

export function medianCut(rgba, maxColors) {
  return medianCutColors(collectColors(rgba), maxColors);
}

export function nearestIndex(palette, r, g, b) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
    if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
  }
  return best;
}
