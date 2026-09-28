// 油漆桶：回傳要改色的像素索引，不直接修改（呼叫端負責記錄復原）。
// 使用掃描線 + 明確堆疊，不會因大圖造成遞迴爆堆疊。

export function floodFill(px, w, h, x, y) {
  if (x < 0 || y < 0 || x >= w || y >= h) return [];
  const target = px[y * w + x];
  const visited = new Uint8Array(w * h);
  const out = [];
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop(), cx = stack.pop();
    const row = cy * w;
    if (visited[row + cx] || px[row + cx] !== target) continue;
    let l = cx, r = cx;
    while (l > 0 && !visited[row + l - 1] && px[row + l - 1] === target) l--;
    while (r < w - 1 && !visited[row + r + 1] && px[row + r + 1] === target) r++;
    for (let k = l; k <= r; k++) { visited[row + k] = 1; out.push(row + k); }
    for (const ny of [cy - 1, cy + 1]) {
      if (ny < 0 || ny >= h) continue;
      const nrow = ny * w;
      let inRun = false;
      for (let k = l; k <= r; k++) {
        const ok = !visited[nrow + k] && px[nrow + k] === target;
        if (ok && !inRun) { stack.push(k, ny); inRun = true; } else if (!ok) inRun = false;
      }
    }
  }
  return out;
}

/** 全域同色：整張圖所有與 color 相同的像素。 */
export function matchGlobal(px, color) {
  const out = [];
  for (let i = 0; i < px.length; i++) if (px[i] === color) out.push(i);
  return out;
}
