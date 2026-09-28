import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Viewport, MIN_ZOOM, MAX_ZOOM } from '../src/view.js';

function make(w = 16, h = 16) {
  const el = { getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }) };
  const stage = { style: {} };
  let changes = 0;
  const v = new Viewport(el, stage, () => { changes++; });
  v.setDocSize(w, h);
  return { v, stage, changes: () => changes };
}

test('fit: 置中並使用整數縮放', () => {
  const { v } = make();
  v.fit();
  assert.equal(Number.isInteger(v.zoom), true);
  assert.ok(v.zoom * 16 <= 600);
  assert.ok(Math.abs(v.ox - (800 - 16 * v.zoom) / 2) < 1e-9);
  assert.equal(v.auto, true);
});
test('layout: 寫入 stage 的位置與大小並通知', () => {
  const { v, stage, changes } = make();
  v.zoom = 10; v.ox = 20; v.oy = 30;
  v.layout();
  assert.equal(stage.style.width, '160px');
  assert.equal(stage.style.left, '20px');
  assert.equal(changes(), 1);
});
test('toDoc: 螢幕座標轉畫布像素', () => {
  const { v } = make();
  v.zoom = 10; v.ox = 20; v.oy = 30;
  assert.deepEqual(v.toDoc(100 + 20 + 35, 50 + 30 + 5), { x: 3, y: 0, fx: 3.5, fy: 0.5 });
  assert.equal(v.toDoc(100 + 20 - 1, 50 + 30).x, -1);
});
test('zoomAt: 游標下的畫布點在縮放前後不動', () => {
  const { v } = make(32, 32);
  v.zoom = 8; v.ox = 100; v.oy = 60;
  const before = v.toDoc(400, 300);
  v.zoomAt(400, 300, 2);
  const after = v.toDoc(400, 300);
  assert.equal(v.zoom, 16);
  assert.ok(Math.abs(before.fx - after.fx) < 1e-9 && Math.abs(before.fy - after.fy) < 1e-9);
  assert.equal(v.auto, false);
});
test('zoomAt: 縮放範圍有上下限', () => {
  const { v } = make();
  v.zoomAt(400, 300, 1e9);
  assert.equal(v.zoom, MAX_ZOOM);
  v.zoomAt(400, 300, 1e-9);
  assert.equal(v.zoom, MIN_ZOOM);
});
test('panBy: 畫布不會被拖出視窗外', () => {
  const { v } = make();
  v.zoom = 10; v.ox = 0; v.oy = 0;
  v.panBy(1e6, 1e6);
  assert.ok(v.ox < 800 && v.oy < 600);
  v.panBy(-1e7, -1e7);
  assert.ok(v.ox + 160 > 0 && v.oy + 160 > 0);
});
test('inside', () => {
  const { v } = make(4, 3);
  assert.ok(v.inside(0, 0) && v.inside(3, 2));
  assert.ok(!v.inside(4, 0) && !v.inside(0, 3) && !v.inside(-1, 0));
});
