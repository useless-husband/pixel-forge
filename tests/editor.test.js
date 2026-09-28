import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDoc } from '../src/doc.js';
import { Editor } from '../src/editor.js';
import { serializeDoc } from '../src/project.js';
import { pack } from '../src/color.js';
import { line } from '../src/geometry.js';
import { composeFrame } from '../src/composite.js';

const RED = pack(255, 0, 0), BLUE = pack(0, 0, 255);

function paint(ed, pts, color, label) {
  const s = ed.beginStroke();
  for (const [x, y] of pts) s.set(x, y, color);
  return s.commit(label);
}

// 可重現的亂數
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('stroke: 修改像素並可復原/重做', () => {
  const ed = new Editor(createDoc({ width: 8, height: 8 }));
  paint(ed, [[1, 1], [2, 2]], RED);
  assert.equal(ed.cel[1 * 8 + 1], RED);
  ed.undo();
  assert.equal(ed.cel[1 * 8 + 1], 0);
  ed.redo();
  assert.equal(ed.cel[2 * 8 + 2], RED);
});
test('stroke: 越界座標被忽略', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  const s = ed.beginStroke();
  assert.equal(s.set(-1, 0, RED), false);
  assert.equal(s.set(4, 0, RED), false);
  assert.equal(s.commit(), 0);
  assert.equal(ed.history.canUndo, false);
});
test('stroke: 沒有實際變化就不進歷史', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  paint(ed, [[0, 0]], RED);
  const n = ed.history.undoStack.length;
  paint(ed, [[0, 0]], RED);
  assert.equal(ed.history.undoStack.length, n);
});
test('stroke: 同一筆畫先塗再塗回原色 = 沒有變化', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  const s = ed.beginStroke();
  s.set(1, 1, RED); s.set(1, 1, 0);
  assert.equal(s.commit(), 0);
});
test('stroke: rollback 還原', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  const s = ed.beginStroke();
  s.set(1, 1, RED);
  s.rollback();
  assert.equal(ed.cel[5], 0);
});
test('history: 新動作會清掉 redo', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  paint(ed, [[0, 0]], RED);
  ed.undo();
  assert.ok(ed.history.canRedo);
  paint(ed, [[1, 1]], BLUE);
  assert.equal(ed.history.canRedo, false);
});
test('history: 至少保留 100 步，且 diff 只存改動的像素', () => {
  const ed = new Editor(createDoc({ width: 256, height: 256 }));
  for (let i = 0; i < 150; i++) paint(ed, [[i, i]], RED);
  assert.ok(ed.history.undoStack.length >= 100);
  assert.equal(ed.history.undoStack.length, 150);
  const bytes = ed.history.undoStack.reduce((s, e) => s + e.bytes, 0);
  assert.ok(bytes < 5000, `歷史佔用 ${bytes} bytes`);
  for (let i = 0; i < 150; i++) ed.undo();
  assert.ok(ed.cel.every((v) => v === 0));
});
test('history: 超過上限會丟掉最舊的', () => {
  const ed = new Editor(createDoc({ width: 8, height: 8 }));
  ed.history.limit = 5;
  for (let i = 0; i < 8; i++) paint(ed, [[i, 0]], RED);
  assert.equal(ed.history.undoStack.length, 5);
});

test('圖層：新增、刪除、復原', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  ed.addLayer('B');
  assert.equal(ed.doc.layers.length, 2);
  assert.equal(ed.layer, 1);
  ed.deleteLayer(1);
  assert.equal(ed.doc.layers.length, 1);
  ed.undo();
  assert.equal(ed.doc.layers.length, 2);
  ed.undo();
  assert.equal(ed.doc.layers.length, 1);
});
test('圖層：不能刪掉最後一層', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  assert.equal(ed.deleteLayer(0), false);
});
test('圖層：複製會複製像素', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  paint(ed, [[1, 1]], RED);
  ed.duplicateLayer(0);
  assert.equal(ed.doc.layers[1].cels[0][5], RED);
  assert.notEqual(ed.doc.layers[1].cels[0], ed.doc.layers[0].cels[0]);
  assert.match(ed.doc.layers[1].name, /副本/);
});
test('圖層：上下移動與邊界', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  ed.addLayer('B');
  assert.equal(ed.moveLayer(1, 1), false);
  assert.equal(ed.moveLayer(1, -1), true);
  assert.equal(ed.doc.layers[0].name, 'B');
  ed.undo();
  assert.equal(ed.doc.layers[1].name, 'B');
});
test('圖層：屬性（隱藏/透明度/名稱）可復原', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  ed.setLayerProps(0, { name: 'X', visible: false, opacity: 0.25 });
  assert.equal(ed.doc.layers[0].name, 'X');
  assert.equal(ed.doc.layers[0].visible, false);
  ed.undo();
  assert.equal(ed.doc.layers[0].name, '圖層 1');
  assert.equal(ed.doc.layers[0].visible, true);
  assert.equal(ed.doc.layers[0].opacity, 1);
  assert.equal(ed.setLayerProps(0, { name: '圖層 1' }), false);
});
test('圖層：合併向下等於合成結果，且可復原', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  paint(ed, [[0, 0], [1, 0]], RED);
  ed.addLayer('B');
  paint(ed, [[1, 0], [2, 0]], BLUE);
  ed.setLayerProps(1, { opacity: 0.5 });
  const before = composeFrame(ed.doc, 0);
  ed.mergeDown(1);
  assert.equal(ed.doc.layers.length, 1);
  assert.deepEqual([...composeFrame(ed.doc, 0)], [...before]);
  ed.undo();
  assert.equal(ed.doc.layers.length, 2);
  assert.deepEqual([...composeFrame(ed.doc, 0)], [...before]);
  assert.equal(ed.doc.layers[0].cels[0][2], 0);
});
test('圖層：最底層不能合併向下', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  assert.equal(ed.mergeDown(0), false);
});
test('匯入圖片：成為新圖層並裁切超出部分', () => {
  const ed = new Editor(createDoc({ width: 2, height: 2 }));
  const rgba = new Uint8ClampedArray(3 * 3 * 4).fill(255);
  const r = ed.importLayer('img', rgba, 3, 3);
  assert.equal(r.clipped, true);
  assert.equal(ed.doc.layers.length, 2);
  assert.ok(ed.doc.layers[1].cels[0].every((v) => v === 0xffffffff));
  ed.undo();
  assert.equal(ed.doc.layers.length, 1);
});

test('影格：新增/複製/刪除/移動 皆可復原', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  paint(ed, [[0, 0]], RED);
  ed.duplicateFrame(0);
  assert.equal(ed.doc.frames.length, 2);
  assert.equal(ed.doc.layers[0].cels[1][0], RED);
  ed.addFrame(1);
  assert.equal(ed.doc.frames.length, 3);
  assert.equal(ed.frame, 2);
  ed.moveFrame(2, -1);
  assert.equal(ed.frame, 1);
  ed.deleteFrame(0);
  assert.equal(ed.doc.frames.length, 2);
  ed.undo(); ed.undo(); ed.undo(); ed.undo();
  assert.equal(ed.doc.frames.length, 1);
});
test('影格：不能刪掉最後一格；時長限制在 10–60000', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  assert.equal(ed.deleteFrame(0), false);
  ed.setDuration(0, 1);
  assert.equal(ed.doc.frames[0].duration, 10);
  ed.setDuration(0, 999999);
  assert.equal(ed.doc.frames[0].duration, 60000);
  ed.undo();
  assert.equal(ed.doc.frames[0].duration, 10);
});
test('影格：全部時長一次設定', () => {
  const ed = new Editor(createDoc({ width: 4, height: 4 }));
  ed.addFrame(0);
  ed.setDuration('all', 250);
  assert.deepEqual(ed.doc.frames.map((f) => f.duration), [250, 250]);
  ed.undo();
  assert.deepEqual(ed.doc.frames.map((f) => f.duration), [100, 100]);
});

test('隨機操作序列：全部復原後回到初始狀態，全部重做後回到最終狀態', () => {
  for (const seed of [1, 2, 3, 42, 2026]) {
    const rand = rng(seed);
    const ri = (n) => Math.floor(rand() * n);
    const ed = new Editor(createDoc({ width: 12, height: 9 }));
    paint(ed, line(0, 0, 11, 8), RED); // 起始內容
    ed.history.clear();
    const initial = serializeDoc(ed.doc);
    let ops = 0;
    for (let step = 0; step < 120; step++) {
      const doc = ed.doc;
      switch (ri(14)) {
        case 0: case 1: case 2: case 3: case 4: {
          const pts = line(ri(12), ri(9), ri(12), ri(9));
          paint(ed, pts, rand() < 0.2 ? 0 : pack(ri(256), ri(256), ri(256)));
          break;
        }
        case 5: ed.addLayer(); break;
        case 6: ed.deleteLayer(ri(doc.layers.length)); break;
        case 7: ed.duplicateLayer(ri(doc.layers.length)); break;
        case 8: ed.moveLayer(ri(doc.layers.length), rand() < 0.5 ? 1 : -1); break;
        case 9: ed.mergeDown(ri(doc.layers.length)); break;
        case 10: ed.addFrame(ri(doc.frames.length)); break;
        case 11: ed.duplicateFrame(ri(doc.frames.length)); break;
        case 12: ed.deleteFrame(ri(doc.frames.length)); break;
        case 13:
          ed.setLayerProps(ri(doc.layers.length), { opacity: ri(5) / 4, visible: rand() < 0.7, name: 'n' + ri(3) });
          break;
      }
      if (rand() < 0.5) ed.setActive({ layer: ri(doc.layers.length), frame: ri(doc.frames.length) });
      ops++;
    }
    assert.ok(ed.history.undoStack.length > 20, '確實有做事');
    const final = serializeDoc(ed.doc);
    while (ed.undo());
    assert.equal(serializeDoc(ed.doc), initial, `seed ${seed}: undo 全部後應回到初始`);
    while (ed.redo());
    assert.equal(serializeDoc(ed.doc), final, `seed ${seed}: redo 全部後應回到最終`);
  }
});
