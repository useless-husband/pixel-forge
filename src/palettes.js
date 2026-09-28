// 內建色盤。這裡只有色碼（十六進位數字），色碼本身是公開資料，沒有引用任何色盤檔案或圖片。
// 來源與作者標示在每個色盤的 source 欄位，會顯示在介面上。

const PICO8 = [
  '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
  '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
];

const GAMEBOY = ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'];

// 網路上流傳的 NES（2C02）常見近似色，實際色彩依電視與擷取設備而異。
const NES = [
  '#7c7c7c', '#0000fc', '#0000bc', '#4428bc', '#940084', '#a80020', '#a81000', '#881400',
  '#503000', '#007800', '#006800', '#005800', '#004058', '#000000',
  '#bcbcbc', '#0078f8', '#0058f8', '#6844fc', '#d800cc', '#e40058', '#f83800', '#e45c10',
  '#ac7c00', '#00b800', '#00a800', '#00a844', '#008888',
  '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8', '#f878f8', '#f85898', '#f87858', '#fca044',
  '#f8b800', '#b8f818', '#58d854', '#58f898', '#00e8d8', '#787878',
  '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8', '#f8b8f8', '#f8a4c0', '#f0d0b0', '#fce0a8',
  '#f8d878', '#d8f878', '#b8f8b8', '#b8f8d8', '#00fcfc', '#f8d8f8',
];

const ENDESGA32 = [
  '#be4a2f', '#d77643', '#ead4aa', '#e4a672', '#b86f50', '#733e39', '#3e2731', '#a22633',
  '#e43b44', '#f77622', '#feae34', '#fee761', '#63c74d', '#3e8948', '#265c42', '#193c3e',
  '#124e89', '#0099db', '#2ce8f5', '#ffffff', '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
  '#262b44', '#181425', '#ff0044', '#68386c', '#b55088', '#f6757a', '#e8b796', '#c28569',
];

export const PALETTES = [
  { id: 'endesga32', name: 'Endesga 32', colors: ENDESGA32, source: 'Endesga 32，作者 ENDESGA（Lospec 上公開的 32 色色盤）。' },
  { id: 'pico8', name: 'PICO-8', colors: PICO8, source: 'PICO-8 幻想遊戲主機的 16 色標準色盤（Lexaloffle Games）。' },
  { id: 'gameboy', name: 'Game Boy 4 色', colors: GAMEBOY, source: 'Game Boy (DMG) 四階綠色調的常見色碼。' },
  { id: 'nes', name: 'NES 近似', colors: NES, source: 'NES 主機顏色的常見近似值（實際顏色依顯示設備而異）。' },
];

export const DEFAULT_PALETTE = PALETTES[0];

/** 若目前色盤與某個內建色盤完全相同，回傳它的 id，否則回傳 'custom'。 */
export function detectPreset(colors) {
  const same = (a, b) => a.length === b.length && a.every((c, i) => c.toLowerCase() === b[i]);
  const hit = PALETTES.find((p) => same(colors, p.colors));
  return hit ? hit.id : 'custom';
}
