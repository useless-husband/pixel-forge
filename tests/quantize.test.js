import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medianCut, collectColors, nearestIndex } from '../src/quantize.js';

function image(colors, repeat = 1) {
  const out = [];
  for (let r = 0; r < repeat; r++) for (const c of colors) out.push(c[0], c[1], c[2], c[3] ?? 255);
  return Uint8ClampedArray.from(out);
}

test('collectColors: 統計並忽略透明像素', () => {
  const got = collectColors(image([[1, 2, 3], [1, 2, 3], [9, 9, 9], [5, 5, 5, 0]]));
  assert.equal(got.length, 2);
  assert.equal(got[0].n, 2);
});
test('medianCut: 顏色數不超過上限時原樣回傳', () => {
  const pal = medianCut(image([[255, 0, 0], [0, 255, 0], [0, 0, 255]]), 16);
  assert.equal(pal.length, 3);
  assert.deepEqual(pal[0], [255, 0, 0]);
});
test('medianCut: 縮減到指定數量', () => {
  const colors = [];
  for (let i = 0; i < 200; i++) colors.push([(i * 37) & 255, (i * 91) & 255, (i * 13) & 255]);
  for (const n of [1, 2, 4, 8, 16]) assert.equal(medianCut(image(colors), n).length, n, `n=${n}`);
});
test('medianCut: 兩群顏色 → 兩個代表色落在各自群心附近', () => {
  const dark = [], light = [];
  for (let i = 0; i < 20; i++) { dark.push([10 + i % 5, 10, 10]); light.push([240 - i % 5, 240, 240]); }
  const pal = medianCut(image([...dark, ...light]), 2);
  assert.equal(pal.length, 2);
  assert.ok(pal[0][0] < 30 && pal[1][0] > 220, JSON.stringify(pal));
});
test('medianCut: 依出現次數加權平均', () => {
  const data = image([...Array(9).fill([0, 0, 0]), [10, 0, 0], ...Array(10).fill([250, 250, 250])]);
  // 三種顏色縮成 2：黑/暗紅合併（權重 9:1）
  const pal = medianCut(data, 2);
  assert.equal(pal.length, 2);
  assert.equal(pal[0][0], 1); // (0*9 + 10*1)/10
});
test('medianCut: 完全透明的圖回傳空色盤', () => {
  assert.deepEqual(medianCut(image([[1, 1, 1, 0]]), 4), []);
});
test('medianCut: 結果是決定性的', () => {
  const colors = [];
  for (let i = 0; i < 100; i++) colors.push([(i * 53) & 255, (i * 17) & 255, (i * 101) & 255]);
  assert.deepEqual(medianCut(image(colors), 8), medianCut(image(colors), 8));
});
test('medianCut: maxColors < 1 會丟錯', () => {
  assert.throws(() => medianCut(image([[1, 1, 1]]), 0), RangeError);
});
test('medianCut: 漸層量化後每個原色都能找到很近的代表色', () => {
  const colors = [];
  for (let i = 0; i < 256; i++) colors.push([i, i, i]);
  const pal = medianCut(image(colors), 16);
  for (let i = 0; i < 256; i++) {
    const p = pal[nearestIndex(pal, i, i, i)];
    assert.ok(Math.abs(p[0] - i) <= 16, `${i} → ${p}`);
  }
});
test('nearestIndex', () => {
  const pal = [[0, 0, 0], [255, 255, 255], [255, 0, 0]];
  assert.equal(nearestIndex(pal, 250, 10, 10), 2);
  assert.equal(nearestIndex(pal, 10, 10, 10), 0);
});
