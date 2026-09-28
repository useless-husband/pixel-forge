// .pixelforge 專案檔：JSON。每個 cel 用 RLE 文字壓縮，讀回時逐項驗證。
import { toHex, parseHex, pack, unpack } from './color.js';
import { MIN_SIZE, MAX_SIZE } from './doc.js';

export const FORMAT = 'pixelforge';
export const VERSION = 1;

/** RLE：以逗號分隔；"n" = n 個透明像素；"n:rrggbbaa" = n 個該顏色。全空則為空字串。 */
export function encodeCel(cel) {
  const parts = [];
  let i = 0;
  const n = cel.length;
  while (i < n) {
    const v = cel[i];
    let j = i + 1;
    while (j < n && cel[j] === v) j++;
    const run = j - i;
    if (v >>> 24 === 0) parts.push(String(run));
    else parts.push(`${run}:${toHex(v, true).slice(1)}`);
    i = j;
  }
  if (parts.length === 1 && !parts[0].includes(':')) return '';
  return parts.join(',');
}

export function decodeCel(str, length) {
  const out = new Uint32Array(length);
  if (str === '') return out;
  if (typeof str !== 'string') throw new Error('cel 資料格式錯誤');
  let pos = 0;
  for (const tok of str.split(',')) {
    const m = /^(\d+)(?::([0-9a-fA-F]{8}))?$/.exec(tok);
    if (!m) throw new Error('cel 資料格式錯誤');
    const run = Number(m[1]);
    if (run < 1 || pos + run > length) throw new Error('cel 資料長度與畫布不符');
    if (m[2]) out.fill(parseHex('#' + m[2]), pos, pos + run);
    pos += run;
  }
  if (pos !== length) throw new Error('cel 資料長度與畫布不符');
  return out;
}

export function docToObject(doc) {
  return {
    format: FORMAT,
    version: VERSION,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    palette: [...doc.palette],
    frames: doc.frames.map((f) => ({ duration: f.duration })),
    layers: doc.layers.map((l) => ({
      name: l.name,
      visible: l.visible,
      opacity: l.opacity,
      cels: l.cels.map(encodeCel),
    })),
  };
}

export const serializeDoc = (doc) => JSON.stringify(docToObject(doc));

const isInt = (n) => Number.isInteger(n);

export function docFromObject(obj) {
  if (!obj || typeof obj !== 'object' || obj.format !== FORMAT) throw new Error('這不是 Pixel Forge 專案檔');
  if (obj.version !== VERSION) throw new Error(`不支援的專案檔版本：${obj.version}`);
  const { width, height } = obj;
  if (!isInt(width) || !isInt(height) || width < MIN_SIZE || height < MIN_SIZE || width > MAX_SIZE || height > MAX_SIZE) {
    throw new Error('專案檔的畫布尺寸不合法');
  }
  if (!Array.isArray(obj.frames) || obj.frames.length < 1) throw new Error('專案檔沒有影格');
  if (!Array.isArray(obj.layers) || obj.layers.length < 1) throw new Error('專案檔沒有圖層');
  const palette = Array.isArray(obj.palette) ? obj.palette.filter((c) => parseHex(c) !== null).slice(0, 256) : [];
  const doc = {
    name: typeof obj.name === 'string' ? obj.name.slice(0, 80) : '未命名',
    width,
    height,
    palette: palette.map((c) => toHex(parseHex(c))),
    frames: obj.frames.map((f) => ({ duration: Math.max(10, Math.min(60000, Math.round(Number(f?.duration) || 100))) })),
    layers: [],
    nextId: 1,
  };
  for (const l of obj.layers) {
    if (!l || !Array.isArray(l.cels) || l.cels.length !== doc.frames.length) throw new Error('圖層的影格數量與專案不符');
    const opacity = Number(l.opacity);
    doc.layers.push({
      id: doc.nextId++,
      name: typeof l.name === 'string' ? l.name.slice(0, 80) : `圖層 ${doc.nextId}`,
      visible: l.visible !== false,
      opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 1,
      cels: l.cels.map((s) => decodeCel(s, width * height)),
    });
  }
  return doc;
}

export function parseProject(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { throw new Error('檔案不是有效的 JSON'); }
  return docFromObject(obj);
}

export { pack, unpack };
