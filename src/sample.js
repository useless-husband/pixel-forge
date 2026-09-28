// 預載範例：16×16 的小橘貓，3 格（睜眼 → 眨眼 → 抖耳朵），兩個圖層（身體、臉）。
import { createDoc, makeLayer } from './doc.js';
import { parseHex } from './color.js';

const COLORS = {
  k: '#181425', // 外框
  f: '#e4a672', // 毛
  s: '#b86f50', // 花紋
  p: '#f6757a', // 耳朵內側
  m: '#ead4aa', // 口鼻
  e: '#181425', // 眼睛
  n: '#f6757a', // 鼻子
  w: '#733e39', // 嘴
};

const FACE_CHARS = new Set(['e', 'n', 'w']);

const EARS = ['..kk........kk..', '.kfpk......kpfk.', '.kffpkkkkkkpffk.'];
const EARS_TWITCH = ['...kk.......kk..', '.kfpk......kpfk.', '.kffpkkkkkkpffk.'];
const EYES_OPEN = ['kfffeffffffefffk', 'kfffeffffffefffk'];
const EYES_BLINK = ['kffffffffffffffk', 'kffeeeffffeeeffk'];

function frameRows(eyes, ears) {
  return [
    '................',
    '................',
    ...ears,
    '.kffffsffsffffk.',
    '.kffffffffffffk.',
    ...eyes,
    'kfffmmmnnmmmfffk',
    'kfffmmwmmwmmfffk',
    '.kffffffffffffk.',
    '..kkffffffffkk..',
    '....kkkkkkkk....',
    '................',
    '................',
  ];
}

const FRAMES = [
  { rows: frameRows(EYES_OPEN, EARS), duration: 700 },
  { rows: frameRows(EYES_BLINK, EARS), duration: 120 },
  { rows: frameRows(EYES_OPEN, EARS_TWITCH), duration: 250 },
];

export function createSampleDoc() {
  const doc = createDoc({ width: 16, height: 16, name: '小橘貓' });
  doc.frames = FRAMES.map((f) => ({ duration: f.duration }));
  const body = doc.layers[0];
  body.name = '身體';
  body.cels = doc.frames.map(() => new Uint32Array(256));
  const face = makeLayer(doc, '臉');
  doc.layers.push(face);
  FRAMES.forEach((fr, f) => {
    fr.rows.forEach((row, y) => {
      for (let x = 0; x < 16; x++) {
        const ch = row[x];
        if (!ch || ch === '.') continue;
        if (FACE_CHARS.has(ch)) {
          face.cels[f][y * 16 + x] = parseHex(COLORS[ch]);
          // 身體層在同位置補上底色，臉層隱藏時貓看起來仍完整
          body.cels[f][y * 16 + x] = parseHex(ch === 'e' ? COLORS.f : COLORS.m);
        } else {
          body.cels[f][y * 16 + x] = parseHex(COLORS[ch]);
        }
      }
    });
  });
  return doc;
}
