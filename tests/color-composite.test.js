import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, unpack, parseHex, toHex, blendPacked } from '../src/color.js';
import { composeFrame, packedToRgba, rgbaToPacked } from '../src/composite.js';
import { createDoc, makeLayer } from '../src/doc.js';

test('pack/unpack 來回', () => {
  assert.deepEqual(unpack(pack(1, 2, 3, 4)), [1, 2, 3, 4]);
  assert.deepEqual(unpack(pack(255, 255, 255, 255)), [255, 255, 255, 255]);
  assert.equal(pack(0, 0, 0, 0), 0);
});
test('parseHex: 各種格式', () => {
  assert.equal(parseHex('#f00'), pack(255, 0, 0, 255));
  assert.equal(parseHex('00ff00'), pack(0, 255, 0, 255));
  assert.equal(parseHex('#0000ff80'), pack(0, 0, 255, 128));
  assert.equal(parseHex('  #ABCDEF '), pack(0xab, 0xcd, 0xef, 255));
});
test('parseHex: 不合法回傳 null', () => {
  for (const s of ['', '#', '#12', '#12345', 'zzzzzz', null, undefined, 42, '#1234567']) assert.equal(parseHex(s), null, String(s));
});
test('toHex 來回', () => {
  assert.equal(toHex(parseHex('#12ab9f')), '#12ab9f');
  assert.equal(toHex(pack(1, 2, 3, 4), true), '#01020304');
});

test('blend: 不透明蓋掉底色', () => {
  assert.equal(blendPacked(pack(9, 9, 9, 255), pack(1, 2, 3, 255)), pack(1, 2, 3, 255));
});
test('blend: 透明來源不改變底色', () => {
  const d = pack(9, 8, 7, 255);
  assert.equal(blendPacked(d, 0), d);
});
test('blend: 底色透明時直接採用來源', () => {
  assert.equal(blendPacked(0, pack(10, 20, 30, 255)), pack(10, 20, 30, 255));
});
test('blend: 50% 白蓋黑 = 灰', () => {
  const out = unpack(blendPacked(pack(0, 0, 0, 255), pack(255, 255, 255, 128)));
  assert.equal(out[3], 255);
  assert.ok(Math.abs(out[0] - 128) <= 1, String(out[0]));
});
test('blend: 兩個半透明疊加後 alpha 依公式增加', () => {
  const out = unpack(blendPacked(pack(255, 0, 0, 128), pack(0, 0, 255, 128)));
  // oa = .502 + .502*.498 = .752 → 192
  assert.ok(Math.abs(out[3] - 192) <= 1, String(out[3]));
  assert.ok(out[2] > out[0], '較上層的藍色比重更高');
});
test('blend: 圖層不透明度會乘上像素 alpha', () => {
  const out = unpack(blendPacked(0, pack(255, 0, 0, 255), 0.5));
  assert.equal(out[3], 128);
  assert.equal(out[0], 255);
});
test('blend: 不透明度 0 等於沒有', () => {
  const d = pack(5, 5, 5, 255);
  assert.equal(blendPacked(d, pack(255, 255, 255, 255), 0), d);
});

function docWith(...specs) {
  const doc = createDoc({ width: 2, height: 1 });
  doc.layers.length = 0;
  for (const s of specs) {
    const l = makeLayer(doc, 'l');
    l.cels[0].set(s.px);
    Object.assign(l, s.props);
    doc.layers.push(l);
  }
  return doc;
}

test('composeFrame: 上層蓋下層', () => {
  const doc = docWith(
    { px: [pack(255, 0, 0), pack(255, 0, 0)] },
    { px: [pack(0, 0, 255), 0] },
  );
  const out = composeFrame(doc, 0);
  assert.deepEqual([...out], [0, 0, 255, 255, 255, 0, 0, 255]);
});
test('composeFrame: 隱藏圖層不參與', () => {
  const doc = docWith(
    { px: [pack(255, 0, 0), 0] },
    { px: [pack(0, 255, 0), 0], props: { visible: false } },
  );
  assert.deepEqual([...composeFrame(doc, 0).slice(0, 4)], [255, 0, 0, 255]);
});
test('composeFrame: 圖層不透明度 50%', () => {
  const doc = docWith({ px: [pack(200, 100, 0), 0], props: { opacity: 0.5 } });
  const out = composeFrame(doc, 0);
  assert.equal(out[3], 128);
  assert.deepEqual([...out.slice(0, 3)], [200, 100, 0]);
});
test('composeFrame: 全透明輸出全 0', () => {
  const doc = docWith({ px: [0, 0] });
  assert.ok(composeFrame(doc, 0).every((v) => v === 0));
});
test('packed <-> rgba 來回', () => {
  const px = Uint32Array.from([pack(1, 2, 3, 4), pack(250, 251, 252, 253), 0]);
  assert.deepEqual([...rgbaToPacked(packedToRgba(px))], [...px]);
});
