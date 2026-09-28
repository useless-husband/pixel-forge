import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lzwEncode, encodeGif, buildGif, indexFrames } from '../src/gif.js';
import { lzwDecode, decodeGif } from '../src/gifdecode.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}
function randomIndices(n, colors, seed) {
  const r = rng(seed);
  return Uint8Array.from({ length: n }, () => Math.floor(r() * colors));
}
const rgbaOf = (w, h, fn) => {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(fn(x, y), (y * w + x) * 4);
  return out;
};

test('LZW: 來回還原（各種大小與色數）', () => {
  for (const [n, colors, seed] of [[1, 2, 1], [2, 4, 2], [100, 4, 3], [5000, 16, 4], [70000, 256, 5], [20000, 2, 6], [3, 3, 7]]) {
    let bits = 1; while ((1 << bits) < colors) bits++;
    const min = Math.max(2, bits);
    const src = randomIndices(n, colors, seed);
    const back = lzwDecode(lzwEncode(src, min), min, n);
    assert.deepEqual(back, src, `n=${n} colors=${colors}`);
  }
});
test('LZW: 全部相同的大資料（測代碼表滿了重置）', () => {
  const src = new Uint8Array(100000).fill(3);
  assert.deepEqual(lzwDecode(lzwEncode(src, 2), 2, src.length), src);
});
test('LZW: 重複圖樣可以壓縮', () => {
  const src = new Uint8Array(10000).fill(1);
  assert.ok(lzwEncode(src, 2).length < 400);
});
test('LZW: 空資料', () => {
  assert.equal(lzwDecode(lzwEncode(new Uint8Array(0), 2), 2, 0).length, 0);
});

test('GIF: 檔頭、迴圈區塊與結尾位元組', () => {
  const bytes = encodeGif({
    width: 2, height: 2,
    palette: [[0, 0, 0], [255, 255, 255]],
    frames: [{ indices: Uint8Array.from([0, 1, 1, 0]), delay: 100 }],
    loop: 0,
  });
  assert.equal(String.fromCharCode(...bytes.slice(0, 6)), 'GIF89a');
  assert.equal(bytes.at(-1), 0x3b);
  assert.ok(new TextDecoder().decode(bytes).includes('NETSCAPE2.0'));
});
test('GIF: 解碼後尺寸、影格、延遲、迴圈都一致', () => {
  const bytes = encodeGif({
    width: 3, height: 2,
    palette: [[10, 20, 30], [200, 100, 50], [0, 255, 0]],
    frames: [
      { indices: Uint8Array.from([0, 1, 2, 2, 1, 0]), delay: 120 },
      { indices: Uint8Array.from([2, 2, 2, 0, 0, 0]), delay: 500 },
    ],
    loop: 0,
  });
  const g = decodeGif(bytes);
  assert.equal(g.width, 3); assert.equal(g.height, 2);
  assert.equal(g.loop, 0);
  assert.equal(g.frames.length, 2);
  assert.deepEqual(g.frames.map((f) => f.delay), [120, 500]);
  assert.deepEqual([...g.frames[0].rgba.slice(0, 8)], [10, 20, 30, 255, 200, 100, 50, 255]);
});
test('GIF: loop=false 不寫 NETSCAPE 區塊；loop=3 寫入次數', () => {
  const f = [{ indices: Uint8Array.from([0]), delay: 50 }];
  const a = encodeGif({ width: 1, height: 1, palette: [[0, 0, 0], [1, 1, 1]], frames: f, loop: false });
  assert.equal(decodeGif(a).loop, null);
  const b = encodeGif({ width: 1, height: 1, palette: [[0, 0, 0], [1, 1, 1]], frames: f, loop: 3 });
  assert.equal(decodeGif(b).loop, 3);
});
test('GIF: 透明色解回來 alpha = 0', () => {
  const bytes = encodeGif({
    width: 2, height: 1, palette: [[0, 0, 0], [9, 8, 7]],
    frames: [{ indices: Uint8Array.from([0, 1]), delay: 100 }], transparentIndex: 0,
  });
  const g = decodeGif(bytes);
  assert.equal(g.frames[0].transparentIndex, 0);
  assert.deepEqual([...g.frames[0].rgba], [0, 0, 0, 0, 9, 8, 7, 255]);
});
test('GIF: 色表大小補到 2 的次方，任意大小都可解碼', () => {
  for (const n of [1, 2, 3, 5, 17, 100, 255, 256]) {
    const palette = Array.from({ length: n }, (_, i) => [i, 255 - i, (i * 7) & 255]);
    const idx = randomIndices(64, n, n);
    const g = decodeGif(encodeGif({ width: 8, height: 8, palette, frames: [{ indices: idx, delay: 10 }] }));
    for (let i = 0; i < 64; i++) {
      assert.deepEqual([...g.frames[0].rgba.slice(i * 4, i * 4 + 3)], palette[idx[i]], `palette ${n} px ${i}`);
    }
  }
});
test('GIF: 影格大小不符會丟錯', () => {
  assert.throws(() => encodeGif({ width: 2, height: 2, palette: [[0, 0, 0]], frames: [{ indices: new Uint8Array(3), delay: 1 }] }));
});
test('GIF: 太大的色表、非法尺寸會丟錯', () => {
  assert.throws(() => encodeGif({ width: 1, height: 1, palette: new Array(257).fill([0, 0, 0]), frames: [] }), RangeError);
  assert.throws(() => encodeGif({ width: 0, height: 1, palette: [[0, 0, 0]], frames: [] }), RangeError);
});
test('GIF: 損壞的檔案會丟出錯誤', () => {
  assert.throws(() => decodeGif(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])), /GIF/);
});

test('buildGif: 多影格像素完全一致（含透明）', () => {
  const w = 10, h = 7;
  const frames = [0, 1, 2].map((t) => rgbaOf(w, h, (x, y) => {
    if ((x + y + t) % 5 === 0) return [0, 0, 0, 0];
    return [(x * 25 + t * 40) & 255, (y * 35) & 255, (t * 90) & 255, 255];
  }));
  const gif = buildGif({ rgbaFrames: frames, delays: [100, 200, 300], width: w, height: h, loop: 0 });
  const g = decodeGif(gif);
  assert.equal(g.frames.length, 3);
  assert.deepEqual(g.frames.map((f) => f.delay), [100, 200, 300]);
  frames.forEach((src, i) => assert.deepEqual([...g.frames[i].rgba], [...src], `frame ${i}`));
});
test('buildGif: 沒有透明像素時不保留透明色', () => {
  const f = rgbaOf(4, 4, (x, y) => [x * 60, y * 60, 100, 255]);
  const r = indexFrames([f]);
  assert.equal(r.transparentIndex, -1);
  assert.equal(r.exact, true);
  const g = decodeGif(buildGif({ rgbaFrames: [f], delays: [10], width: 4, height: 4 }));
  assert.deepEqual([...g.frames[0].rgba], [...f]);
});
test('buildGif: 放大 4 倍後每個像素變成 4×4 方塊', () => {
  const f = rgbaOf(3, 2, (x, y) => [x * 100, y * 100, 50, 255]);
  const g = decodeGif(buildGif({ rgbaFrames: [f], delays: [10], width: 3, height: 2, scale: 4 }));
  assert.equal(g.width, 12); assert.equal(g.height, 8);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 12; x++) {
    const s = ((y >> 2) * 3 + (x >> 2)) * 4;
    assert.deepEqual([...g.frames[0].rgba.slice((y * 12 + x) * 4, (y * 12 + x) * 4 + 4)], [...f.slice(s, s + 4)]);
  }
});
test('buildGif: 超過 256 色時縮減到 256 色以內，仍可解碼且色差不大', () => {
  const w = 32, h = 32;
  const f = rgbaOf(w, h, (x, y) => [x * 8, y * 8, (x * y) & 255, 255]);
  const r = indexFrames([f]);
  assert.equal(r.exact, false);
  assert.ok(r.palette.length <= 256);
  const g = decodeGif(buildGif({ rgbaFrames: [f], delays: [10], width: w, height: h }));
  let worst = 0;
  for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(g.frames[0].rgba[i * 4 + c] - f[i * 4 + c]));
  assert.ok(worst < 64, `最大色差 ${worst}`);
});
test('buildGif: 一格半透明像素視為透明（alpha < 128）', () => {
  const f = rgbaOf(2, 1, (x) => (x === 0 ? [255, 0, 0, 100] : [255, 0, 0, 200]));
  const g = decodeGif(buildGif({ rgbaFrames: [f], delays: [10], width: 2, height: 1 }));
  assert.equal(g.frames[0].rgba[3], 0);
  assert.equal(g.frames[0].rgba[7], 255);
});
test('buildGif: 大量影格 × 大畫布的 LZW 邊界（隨機雜訊）', () => {
  const w = 64, h = 64, r = rng(99);
  const frames = [0, 1].map(() => rgbaOf(w, h, () => [Math.floor(r() * 4) * 80, Math.floor(r() * 4) * 80, Math.floor(r() * 4) * 80, 255]));
  const g = decodeGif(buildGif({ rgbaFrames: frames, delays: [10, 10], width: w, height: h }));
  frames.forEach((f, i) => assert.deepEqual([...g.frames[i].rgba], [...f]));
});
