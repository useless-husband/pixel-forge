import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleNearest, buildSpriteSheet, maxScaleFor } from '../src/export.js';
import { serializeDoc, parseProject, encodeCel, decodeCel, docToObject, docFromObject } from '../src/project.js';
import { saveToStorage, loadFromStorage } from '../src/storage.js';
import { createDoc } from '../src/doc.js';
import { createSampleDoc } from '../src/sample.js';
import { Editor } from '../src/editor.js';
import { pack, parseHex } from '../src/color.js';
import { composeFrame } from '../src/composite.js';
import { PALETTES, detectPreset } from '../src/palettes.js';

test('scaleNearest: 2 倍', () => {
  const src = Uint8ClampedArray.from([1, 2, 3, 4, 5, 6, 7, 8]); // 2×1 像素
  const out = scaleNearest(src, 2, 1, 2);
  assert.deepEqual([...out], [1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8, 1, 2, 3, 4, 1, 2, 3, 4, 5, 6, 7, 8, 5, 6, 7, 8].slice(0, 32));
  assert.equal(out.length, 4 * 2 * 4);
});
test('scaleNearest: 每個來源像素變成 k×k 方塊，且不產生新顏色（不模糊）', () => {
  const w = 5, h = 3, k = 7;
  const src = new Uint8ClampedArray(w * h * 4).map((_, i) => (i * 37) & 255);
  const out = scaleNearest(src, w, h, k);
  assert.equal(out.length, w * k * h * k * 4);
  for (let y = 0; y < h * k; y++) for (let x = 0; x < w * k; x++) {
    const s = (Math.floor(y / k) * w + Math.floor(x / k)) * 4;
    const o = (y * w * k + x) * 4;
    assert.deepEqual([...out.slice(o, o + 4)], [...src.slice(s, s + 4)]);
  }
});
test('scaleNearest: k=1 回傳副本；k 不合法會丟錯', () => {
  const src = Uint8ClampedArray.from([1, 2, 3, 4]);
  const out = scaleNearest(src, 1, 1, 1);
  assert.deepEqual([...out], [1, 2, 3, 4]);
  assert.notEqual(out, src);
  assert.throws(() => scaleNearest(src, 1, 1, 0), RangeError);
  assert.throws(() => scaleNearest(src, 1, 1, 1.5), RangeError);
});
test('scaleNearest: 索引資料（ch=1）', () => {
  assert.deepEqual([...scaleNearest(Uint8Array.from([1, 2, 3, 4]), 2, 2, 2, 1)], [1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 4, 4]);
});
test('maxScaleFor: 依畫布大小限制到 4096 px', () => {
  assert.equal(maxScaleFor(16, 16), 32);
  assert.equal(maxScaleFor(256, 256), 16);
  assert.equal(maxScaleFor(200, 100), 20);
});

const px = (r, g, b) => [r, g, b, 255];
const flat = (...c) => Uint8ClampedArray.from(c.flat());
test('spriteSheet: 橫排', () => {
  const f = [{ rgba: flat(px(1, 1, 1), px(2, 2, 2)), duration: 100 }, { rgba: flat(px(3, 3, 3), px(4, 4, 4)), duration: 200 }];
  const s = buildSpriteSheet({ frames: f, width: 2, height: 1, layout: 'row' });
  assert.equal(s.width, 4); assert.equal(s.height, 1);
  assert.deepEqual([...s.rgba], [1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]);
  assert.deepEqual(s.json.frames.map((x) => x.frame), [{ x: 0, y: 0, w: 2, h: 1 }, { x: 2, y: 0, w: 2, h: 1 }]);
  assert.deepEqual(s.json.frames.map((x) => x.duration), [100, 200]);
});
test('spriteSheet: 網格 5 格、2 欄 → 3 列，位置與 JSON 正確', () => {
  const f = Array.from({ length: 5 }, (_, i) => ({ rgba: flat(px(i, 0, 0)), duration: 50 }));
  const s = buildSpriteSheet({ frames: f, width: 1, height: 1, layout: 'grid', columns: 2 });
  assert.equal(s.width, 2); assert.equal(s.height, 3);
  assert.deepEqual(s.json.frames[4].frame, { x: 0, y: 2, w: 1, h: 1 });
  assert.equal(s.json.meta.columns, 2); assert.equal(s.json.meta.rows, 3);
  assert.equal(s.rgba[(2 * 2 + 0) * 4], 4);
});
test('spriteSheet: 倍率與間距', () => {
  const f = [{ rgba: flat(px(9, 9, 9)), duration: 1 }, { rgba: flat(px(8, 8, 8)), duration: 1 }];
  const s = buildSpriteSheet({ frames: f, width: 1, height: 1, layout: 'row', scale: 3, padding: 1 });
  assert.equal(s.width, 3 + 3 + 3); // 1 + 3 + 1 + 3 + 1
  assert.equal(s.width, 9);
  assert.equal(s.height, 5);
  assert.deepEqual(s.json.frames[1].frame, { x: 5, y: 1, w: 3, h: 3 });
  assert.equal(s.rgba[(1 * 9 + 5) * 4], 8);
  assert.equal(s.rgba[3], 0, '間距是透明的');
});
test('spriteSheet: 沒有影格會丟錯', () => {
  assert.throws(() => buildSpriteSheet({ frames: [], width: 1, height: 1 }));
});

test('RLE: cel 編碼/解碼來回', () => {
  const cel = new Uint32Array(50);
  cel.fill(pack(1, 2, 3, 255), 5, 20);
  cel[40] = pack(255, 255, 255, 128);
  assert.deepEqual(decodeCel(encodeCel(cel), 50), cel);
});
test('RLE: 全空 cel 編成空字串', () => {
  assert.equal(encodeCel(new Uint32Array(100)), '');
  assert.deepEqual(decodeCel('', 100), new Uint32Array(100));
});
test('RLE: 長度不符或格式錯誤會丟錯', () => {
  assert.throws(() => decodeCel('5', 10), /長度/);
  assert.throws(() => decodeCel('20', 10), /長度/);
  assert.throws(() => decodeCel('abc', 10), /格式/);
  assert.throws(() => decodeCel('0:ff000000', 0), /長度|格式/);
});
test('專案檔：序列化來回，內容逐位元相同', () => {
  const doc = createSampleDoc();
  doc.layers[0].opacity = 0.75;
  doc.layers[1].visible = false;
  doc.frames[1].duration = 333;
  const back = parseProject(serializeDoc(doc));
  assert.equal(back.name, doc.name);
  assert.equal(back.width, 16);
  assert.deepEqual(back.palette, doc.palette);
  assert.deepEqual(back.frames, doc.frames);
  assert.equal(back.layers.length, 2);
  back.layers.forEach((l, i) => {
    assert.equal(l.name, doc.layers[i].name);
    assert.equal(l.visible, doc.layers[i].visible);
    assert.equal(l.opacity, doc.layers[i].opacity);
    l.cels.forEach((c, f) => assert.deepEqual(c, doc.layers[i].cels[f]));
  });
  assert.equal(serializeDoc(back), serializeDoc(doc));
});
test('專案檔：格式檢查', () => {
  assert.throws(() => parseProject('not json'), /JSON/);
  assert.throws(() => parseProject('{}'), /Pixel Forge/);
  assert.throws(() => parseProject(JSON.stringify({ format: 'pixelforge', version: 99 })), /版本/);
  const o = docToObject(createDoc({ width: 8, height: 8 }));
  assert.throws(() => docFromObject({ ...o, width: 999 }), /尺寸/);
  assert.throws(() => docFromObject({ ...o, layers: [] }), /圖層/);
  assert.throws(() => docFromObject({ ...o, layers: [{ ...o.layers[0], cels: [] }] }), /影格/);
  assert.throws(() => docFromObject({ ...o, layers: [{ ...o.layers[0], cels: ['3'] }] }), /長度/);
});
test('專案檔：不合法的色碼、透明度、時長會被修正', () => {
  const o = docToObject(createDoc({ width: 8, height: 8 }));
  o.palette = ['#fff', 'nope', '#123456'];
  o.frames[0].duration = 1;
  o.layers[0].opacity = 9;
  const d = docFromObject(o);
  assert.deepEqual(d.palette, ['#ffffff', '#123456']);
  assert.equal(d.frames[0].duration, 10);
  assert.equal(d.layers[0].opacity, 1);
});
test('專案檔：一張 256×256 純色圖很小', () => {
  const doc = createDoc({ width: 256, height: 256 });
  doc.layers[0].cels[0].fill(pack(1, 2, 3, 255));
  assert.ok(serializeDoc(doc).length < 3000);
});
test('專案檔：編輯後的結果也能來回', () => {
  const ed = new Editor(createDoc({ width: 8, height: 8 }));
  const s = ed.beginStroke(); s.set(3, 3, pack(9, 9, 9)); s.commit();
  ed.addFrame(0); ed.addLayer('x');
  const back = parseProject(serializeDoc(ed.doc));
  assert.deepEqual([...composeFrame(back, 0)], [...composeFrame(ed.doc, 0)]);
  assert.equal(back.frames.length, 2);
});

class FakeStorage {
  constructor(limit = Infinity) { this.map = new Map(); this.limit = limit; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { if (v.length > this.limit) throw new DOMException('full', 'QuotaExceededError'); this.map.set(k, v); }
}
test('自動存檔：存與讀', () => {
  const st = new FakeStorage();
  const doc = createSampleDoc();
  const r = saveToStorage(st, 'k', doc);
  assert.equal(r.ok, true);
  assert.equal(serializeDoc(loadFromStorage(st, 'k')), serializeDoc(doc));
});
test('自動存檔：超過大小上限不寫入', () => {
  const st = new FakeStorage();
  const r = saveToStorage(st, 'k', createSampleDoc(), 100);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'too-large');
  assert.equal(st.getItem('k'), null);
});
test('自動存檔：儲存空間滿了（QuotaExceeded）會回報而不是丟例外', () => {
  const r = saveToStorage(new FakeStorage(10), 'k', createSampleDoc());
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'quota');
});
test('自動存檔：內容損壞讀回 null', () => {
  const st = new FakeStorage();
  st.setItem('k', '{broken');
  assert.equal(loadFromStorage(st, 'k'), null);
  assert.equal(loadFromStorage(st, 'missing'), null);
});

test('範例：16×16、3 格、2 圖層，畫面有內容且每格都不同', () => {
  const doc = createSampleDoc();
  assert.equal(doc.width, 16); assert.equal(doc.height, 16);
  assert.equal(doc.frames.length, 3);
  assert.equal(doc.layers.length, 2);
  const frames = doc.frames.map((_, i) => composeFrame(doc, i));
  for (const f of frames) assert.ok(f.some((v, i) => i % 4 === 3 && v > 0));
  assert.notDeepEqual([...frames[0]], [...frames[1]]);
  assert.notDeepEqual([...frames[0]], [...frames[2]]);
});
test('範例：隱藏臉圖層後仍是完整的貓（沒有洞）', () => {
  const doc = createSampleDoc();
  const withFace = composeFrame(doc, 0);
  doc.layers[1].visible = false;
  const without = composeFrame(doc, 0);
  for (let i = 3; i < withFace.length; i += 4) assert.equal(without[i], withFace[i]);
});
test('色盤：內建色盤色碼都合法且無重複', () => {
  assert.equal(PALETTES.find((p) => p.id === 'pico8').colors.length, 16);
  assert.equal(PALETTES.find((p) => p.id === 'gameboy').colors.length, 4);
  assert.equal(PALETTES.find((p) => p.id === 'endesga32').colors.length, 32);
  for (const p of PALETTES) {
    assert.ok(p.source.length > 5, p.id);
    assert.equal(new Set(p.colors).size, p.colors.length, `${p.id} 有重複色`);
    for (const c of p.colors) assert.notEqual(parseHex(c), null, `${p.id}: ${c}`);
  }
});
test('色盤：detectPreset', () => {
  assert.equal(detectPreset(PALETTES[1].colors), PALETTES[1].id);
  assert.equal(detectPreset(['#000000']), 'custom');
});
