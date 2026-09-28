import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floodFill, matchGlobal } from '../src/fill.js';

const grid = (rows) => Uint32Array.from(rows.join('').split('').map((c) => (c === '#' ? 1 : 0)));

test('floodFill: 填滿空白區域', () => {
  const px = grid(['....', '....', '....']);
  assert.equal(floodFill(px, 4, 3, 1, 1).length, 12);
});
test('floodFill: 被牆擋住只填一邊', () => {
  const px = grid(['..#..', '..#..', '..#..']);
  const got = floodFill(px, 5, 3, 0, 0).sort((a, b) => a - b);
  assert.deepEqual(got, [0, 1, 5, 6, 10, 11]);
});
test('floodFill: 只有 4 連通，斜角不會漏過去', () => {
  const px = grid(['.#', '#.']);
  assert.deepEqual(floodFill(px, 2, 2, 0, 0), [0]);
});
test('floodFill: 點到牆本身時填牆的連通區', () => {
  const px = grid(['.#.', '.#.']);
  assert.equal(floodFill(px, 3, 2, 1, 0).length, 2);
});
test('floodFill: 邊界外回傳空陣列', () => {
  const px = grid(['..', '..']);
  assert.deepEqual(floodFill(px, 2, 2, -1, 0), []);
  assert.deepEqual(floodFill(px, 2, 2, 0, 2), []);
  assert.deepEqual(floodFill(px, 2, 2, 5, 5), []);
});
test('floodFill: 不重複回傳同一個索引', () => {
  const px = grid(['.....', '.###.', '.....']);
  const got = floodFill(px, 5, 3, 0, 0);
  assert.equal(new Set(got).size, got.length);
  assert.equal(got.length, 12);
});
test('floodFill: 256×256 全空畫布不爆堆疊', () => {
  const px = new Uint32Array(256 * 256);
  assert.equal(floodFill(px, 256, 256, 100, 100).length, 65536);
});
test('floodFill: 256×256 蛇形長走廊（極端最壞情況）', () => {
  const w = 256, h = 256;
  const px = new Uint32Array(w * h);
  // 每隔一列放牆，只在左右交替留一個缺口 → 走廊長度約 128 * 256
  for (let y = 1; y < h; y += 2) {
    for (let x = 0; x < w; x++) px[y * w + x] = 1;
    px[y * w + (((y - 1) / 2) % 2 === 0 ? w - 1 : 0)] = 0;
  }
  const got = floodFill(px, w, h, 0, 0);
  assert.equal(got.length, px.filter((v) => v === 0).length);
});
test('floodFill: 棋盤格每格都是獨立區域', () => {
  const w = 64, h = 64;
  const px = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = (x + y) & 1;
  assert.equal(floodFill(px, w, h, 10, 10).length, 1);
});
test('matchGlobal: 找出整張圖同色像素', () => {
  const px = grid(['.#.', '#..']);
  assert.deepEqual(matchGlobal(px, 1), [1, 3]);
  assert.equal(matchGlobal(px, 0).length, 4);
});
