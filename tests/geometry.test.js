import { test } from 'node:test';
import assert from 'node:assert/strict';
import { line, rectPoints, ellipsePoints } from '../src/geometry.js';

const key = ([x, y]) => `${x},${y}`;
const set = (pts) => new Set(pts.map(key));

test('line: 水平線包含端點且連續', () => {
  assert.deepEqual(line(0, 0, 4, 0), [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
});
test('line: 垂直線與反方向', () => {
  assert.deepEqual(line(2, 3, 2, 0), [[2, 3], [2, 2], [2, 1], [2, 0]]);
});
test('line: 單點', () => {
  assert.deepEqual(line(5, 5, 5, 5), [[5, 5]]);
});
test('line: 45 度斜線', () => {
  assert.deepEqual(line(0, 0, 3, 3), [[0, 0], [1, 1], [2, 2], [3, 3]]);
});
test('line: 起點與終點都在結果裡，每步相鄰（不漏點）', () => {
  for (const [a, b, c, d] of [[0, 0, 17, 5], [10, 2, -4, 9], [3, 30, 4, -20], [-7, -7, 7, 6]]) {
    const pts = line(a, b, c, d);
    assert.deepEqual(pts[0], [a, b]);
    assert.deepEqual(pts.at(-1), [c, d]);
    for (let i = 1; i < pts.length; i++) {
      assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) <= 1 && Math.abs(pts[i][1] - pts[i - 1][1]) <= 1);
    }
    assert.equal(pts.length, Math.max(Math.abs(c - a), Math.abs(d - b)) + 1);
  }
});
test('line: 正反方向畫出的點數相同', () => {
  assert.equal(line(0, 0, 13, 4).length, line(13, 4, 0, 0).length);
});
test('line: 淺斜率的已知結果', () => {
  assert.deepEqual(line(0, 0, 5, 2), [[0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 2]]);
});

test('rect: 空心 4×3', () => {
  const pts = rectPoints(0, 0, 3, 2, false);
  assert.equal(pts.length, 10);
  assert.ok(!set(pts).has('1,1') && !set(pts).has('2,1'));
  assert.ok(set(pts).has('0,1') && set(pts).has('3,1'));
});
test('rect: 實心點數 = 寬×高，且順序無關', () => {
  assert.equal(rectPoints(5, 5, 1, 2, true).length, 5 * 4);
});
test('rect: 寬 1 的空心不重複', () => {
  const pts = rectPoints(2, 0, 2, 4, false);
  assert.equal(pts.length, 5);
  assert.equal(set(pts).size, 5);
});
test('rect: 單一像素', () => {
  assert.deepEqual(rectPoints(3, 3, 3, 3, false), [[3, 3]]);
});

test('ellipse: 1×1 只有一個點', () => {
  assert.deepEqual(ellipsePoints(4, 4, 4, 4), [[4, 4]]);
});
test('ellipse: 所有點都在邊界框內，且沒有重複', () => {
  for (const [w, h] of [[5, 5], [8, 4], [3, 9], [16, 16], [2, 2], [7, 2]]) {
    const pts = ellipsePoints(2, 3, 2 + w - 1, 3 + h - 1);
    assert.equal(set(pts).size, pts.length);
    for (const [x, y] of pts) assert.ok(x >= 2 && x <= 2 + w - 1 && y >= 3 && y <= 3 + h - 1, `${w}x${h}: ${x},${y}`);
  }
});
test('ellipse: 左右上下對稱', () => {
  for (const [w, h] of [[9, 9], [10, 6], [5, 12]]) {
    const s = set(ellipsePoints(0, 0, w - 1, h - 1));
    for (const k of s) {
      const [x, y] = k.split(',').map(Number);
      assert.ok(s.has(key([w - 1 - x, y])), `水平對稱 ${w}x${h}`);
      assert.ok(s.has(key([x, h - 1 - y])), `垂直對稱 ${w}x${h}`);
    }
  }
});
test('ellipse: 5×5 圓的已知形狀', () => {
  const s = set(ellipsePoints(0, 0, 4, 4));
  for (const p of ['2,0', '2,4', '0,2', '4,2']) assert.ok(s.has(p), p);
  assert.ok(!s.has('2,2'));
});
test('ellipse: 實心包含中心且點數多於空心', () => {
  const hollow = ellipsePoints(0, 0, 8, 8, false);
  const filled = ellipsePoints(0, 0, 8, 8, true);
  assert.ok(filled.length > hollow.length);
  assert.ok(set(filled).has('4,4'));
  for (const p of hollow) assert.ok(set(filled).has(key(p)));
});
test('ellipse: 座標順序顛倒結果相同', () => {
  assert.deepEqual(set(ellipsePoints(9, 7, 2, 1)), set(ellipsePoints(2, 1, 9, 7)));
});
test('ellipse: 每一列都有點（沒有斷層）', () => {
  const rows = new Set(ellipsePoints(0, 0, 14, 6).map((p) => p[1]));
  for (let y = 0; y <= 6; y++) assert.ok(rows.has(y), `row ${y}`);
});
