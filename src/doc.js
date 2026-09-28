import { DEFAULT_PALETTE } from './palettes.js';

export const MIN_SIZE = 1;
export const MAX_SIZE = 256;
export const DEFAULT_DURATION = 100;

function checkSize(n, what) {
  if (!Number.isInteger(n) || n < MIN_SIZE || n > MAX_SIZE) {
    throw new RangeError(`${what}必須是 ${MIN_SIZE}–${MAX_SIZE} 的整數`);
  }
}

export function blankCel(doc) {
  return new Uint32Array(doc.width * doc.height);
}

export function makeLayer(doc, name) {
  return {
    id: doc.nextId++,
    name,
    visible: true,
    opacity: 1,
    cels: doc.frames.map(() => blankCel(doc)),
  };
}

/** 建立一個新文件：一個影格、一個空圖層。圖層陣列由下到上。 */
export function createDoc({ width = 32, height = 32, name = '未命名', palette = DEFAULT_PALETTE.colors } = {}) {
  checkSize(width, '寬度');
  checkSize(height, '高度');
  const doc = {
    name,
    width,
    height,
    palette: [...palette],
    frames: [{ duration: DEFAULT_DURATION }],
    layers: [],
    nextId: 1,
  };
  doc.layers.push(makeLayer(doc, '圖層 1'));
  return doc;
}

export function cloneDoc(doc) {
  return {
    ...doc,
    palette: [...doc.palette],
    frames: doc.frames.map((f) => ({ ...f })),
    layers: doc.layers.map((l) => ({ ...l, cels: l.cels.map((c) => c.slice()) })),
  };
}
