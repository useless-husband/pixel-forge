// 簡易 GIF 解碼器：主要給測試驗證編碼器；也可用來讀取本專案產生的 GIF。
// 支援：全域/區域色表、透明色、disposal 1/2/3、NETSCAPE 迴圈。不支援交錯。

export function lzwDecode(data, minCodeSize, pixelCount) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096);
  for (let i = 0; i < clear; i++) first[i] = i;
  const out = new Uint8Array(pixelCount);
  const total = data.length * 8;
  const stack = [];
  let pos = 0, bitPos = 0, size = minCodeSize + 1, next = eoi + 1, prev = -1;

  const emitString = (c, extra = -1) => {
    stack.length = 0;
    for (; c >= clear; c = prefix[c]) stack.push(suffix[c]);
    stack.push(c);
    for (let i = stack.length - 1; i >= 0 && pos < pixelCount; i--) out[pos++] = stack[i];
    if (extra >= 0 && pos < pixelCount) out[pos++] = extra;
  };

  while (pos < pixelCount && bitPos + size <= total) {
    let code = 0;
    for (let i = 0; i < size; i++, bitPos++) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
    if (code === eoi) break;
    if (code === clear) { size = minCodeSize + 1; next = eoi + 1; prev = -1; continue; }
    if (prev === -1) {
      if (code >= clear) throw new Error('GIF 資料損壞（起始代碼無效）');
      out[pos++] = code;
      prev = code;
      continue;
    }
    let k;
    if (code < next) {
      emitString(code);
      k = first[code];
    } else if (code === next) {
      k = first[prev];
      emitString(prev, k);
    } else {
      throw new Error('GIF 資料損壞（無效的 LZW 代碼）');
    }
    if (next < 4096) {
      prefix[next] = prev; suffix[next] = k; first[next] = first[prev];
      next++;
      if (next === (1 << size) && size < 12) size++;
    }
    prev = code;
  }
  return out;
}

export function decodeGif(bytes) {
  let p = 0;
  const u8 = () => bytes[p++];
  const u16 = () => { const v = bytes[p] | (bytes[p + 1] << 8); p += 2; return v; };
  const sig = String.fromCharCode(...bytes.subarray(0, 6));
  if (sig !== 'GIF89a' && sig !== 'GIF87a') throw new Error('不是 GIF 檔');
  p = 6;
  const width = u16(), height = u16();
  const flags = u8(); u8(); u8();
  let globalTable = null;
  if (flags & 0x80) {
    const n = 1 << ((flags & 7) + 1);
    globalTable = [];
    for (let i = 0; i < n; i++) globalTable.push([u8(), u8(), u8()]);
  }
  const result = { width, height, loop: null, frames: [] };
  let gce = null;
  let canvas = new Uint8ClampedArray(width * height * 4);
  let prevInfo = null; // 上一格的 disposal 資訊
  let saved = null;

  const readBlocks = () => {
    const chunks = [];
    for (let len = u8(); len > 0; len = u8()) { chunks.push(bytes.subarray(p, p + len)); p += len; }
    const all = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return all;
  };

  while (p < bytes.length) {
    const b = u8();
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        u8();
        const f = u8();
        const delay = u16() * 10;
        const ti = u8();
        u8();
        gce = { disposal: (f >> 2) & 7, transparent: f & 1 ? ti : -1, delay };
      } else if (label === 0xff) {
        const len = u8();
        const name = String.fromCharCode(...bytes.subarray(p, p + len)); p += len;
        const data = readBlocks();
        if (name === 'NETSCAPE2.0' && data[0] === 1) result.loop = data[1] | (data[2] << 8);
      } else {
        readBlocks();
      }
    } else if (b === 0x2c) {
      const left = u16(), top = u16(), w = u16(), h = u16();
      const f = u8();
      if (f & 0x40) throw new Error('不支援交錯 GIF');
      let table = globalTable;
      if (f & 0x80) {
        const n = 1 << ((f & 7) + 1);
        table = [];
        for (let i = 0; i < n; i++) table.push([u8(), u8(), u8()]);
      }
      const minCode = u8();
      const indices = lzwDecode(readBlocks(), minCode, w * h);
      const info = gce || { disposal: 0, transparent: -1, delay: 0 };
      // 先處理上一格的 disposal
      if (prevInfo) {
        if (prevInfo.disposal === 2) {
          for (let y = 0; y < prevInfo.h; y++) {
            for (let x = 0; x < prevInfo.w; x++) {
              const o = ((prevInfo.top + y) * width + prevInfo.left + x) * 4;
              canvas[o] = canvas[o + 1] = canvas[o + 2] = canvas[o + 3] = 0;
            }
          }
        } else if (prevInfo.disposal === 3 && saved) canvas = saved;
      }
      saved = info.disposal === 3 ? canvas.slice() : null;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = indices[y * w + x];
          if (v === info.transparent) continue;
          const o = ((top + y) * width + left + x) * 4;
          const c = table[v] || [0, 0, 0];
          canvas[o] = c[0]; canvas[o + 1] = c[1]; canvas[o + 2] = c[2]; canvas[o + 3] = 255;
        }
      }
      result.frames.push({
        delay: info.delay, disposal: info.disposal, transparentIndex: info.transparent,
        left, top, width: w, height: h, indices, palette: table, rgba: canvas.slice(),
      });
      prevInfo = { disposal: info.disposal, left, top, w, h };
      gce = null;
    } else {
      throw new Error('GIF 資料損壞（未知區塊）');
    }
  }
  return result;
}
