import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brushPoints, ditherAllows, mirrorPoints, expandPoints, snapLine, snapSquare } from '../src/tools.js';

test('brush: 1 格', () => assert.deepEqual(brushPoints(3, 4, 1), [[3, 4]]));
test('brush: 3×3 以中心為準', () => {
  const p = brushPoints(5, 5, 3);
  assert.equal(p.length, 9);
  assert.deepEqual(p[0], [4, 4]);
  assert.deepEqual(p.at(-1), [6, 6]);
});
test('brush: 偶數尺寸涵蓋 size×size', () => assert.equal(brushPoints(5, 5, 4).length, 16));

test('dither: 各等級的覆蓋率', () => {
  const count = (lvl) => {
    let n = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (ditherAllows(x, y, lvl)) n++;
    return n;
  };
  assert.equal(count(0), 64);
  assert.equal(count(1), 16);
  assert.equal(count(2), 32);
  assert.equal(count(3), 48);
});
test('dither: 50% 是棋盤格', () => {
  assert.ok(ditherAllows(0, 0, 2));
  assert.ok(!ditherAllows(1, 0, 2));
  assert.ok(ditherAllows(1, 1, 2));
});

test('mirror: 水平', () => assert.deepEqual(mirrorPoints([[1, 2]], 8, 8, true, false), [[1, 2], [6, 2]]));
test('mirror: 垂直', () => assert.deepEqual(mirrorPoints([[1, 2]], 8, 8, false, true), [[1, 2], [1, 5]]));
test('mirror: 兩軸產生 4 點', () => {
  const p = mirrorPoints([[1, 2]], 8, 8, true, true);
  assert.equal(p.length, 4);
  assert.deepEqual(p.at(-1), [6, 5]);
});
test('mirror: 關閉時原樣回傳', () => {
  const pts = [[1, 1]];
  assert.equal(mirrorPoints(pts, 8, 8, false, false), pts);
});
test('expandPoints: 筆刷、抖動、鏡像串起來', () => {
  const p = expandPoints([[2, 2]], { size: 2, dither: 2, w: 8, h: 8, mirrorH: true });
  // 2×2 筆刷涵蓋 (1,1)(2,1)(1,2)(2,2)，棋盤只留 (1,1)(2,2)，鏡像後 4 點
  assert.equal(p.length, 4);
});

test('snapLine: 接近水平/垂直/斜角', () => {
  assert.deepEqual(snapLine(0, 0, 10, 2), [10, 0]);
  assert.deepEqual(snapLine(0, 0, 2, 10), [0, 10]);
  assert.deepEqual(snapLine(0, 0, 7, 6), [7, 7]);
  assert.deepEqual(snapLine(5, 5, 1, 2), [1, 1]);
});
test('snapSquare: 取較大邊', () => {
  assert.deepEqual(snapSquare(2, 2, 8, 4), [8, 8]);
  assert.deepEqual(snapSquare(5, 5, 3, 0), [0, 0]);
});
