// Editor：包住文件與復原歷史，所有會改動文件的操作都在這裡，並且都可復原。
import { makeLayer, blankCel, DEFAULT_DURATION } from './doc.js';
import { History, pixelEntry, groupEntry } from './history.js';
import { blendPacked } from './color.js';

/** 一次筆畫：先記錄每個被改到的像素「改前」的值，commit 時才產生 diff。 */
export class Stroke {
  constructor(editor, cel) {
    this.ed = editor;
    this.cel = cel;
    this.w = editor.doc.width;
    this.h = editor.doc.height;
    this.before = new Map();
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.cel[y * this.w + x];
  }
  set(x, y, color) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.setIndex(y * this.w + x, color);
  }
  setIndex(i, color) {
    const cur = this.cel[i];
    if (cur === color) return false;
    if (!this.before.has(i)) this.before.set(i, cur);
    this.cel[i] = color;
    return true;
  }
  get size() { return this.before.size; }
  /** 放棄這次筆畫，還原成筆畫開始前的樣子。 */
  rollback() {
    for (const [i, v] of this.before) this.cel[i] = v;
    this.before.clear();
  }
  /** 結束筆畫並記入歷史。沒有實際變化就不記。回傳變動的像素數。 */
  commit(label = '繪製') {
    const idx = [], b = [];
    for (const [i, v] of this.before) if (this.cel[i] !== v) { idx.push(i); b.push(v); }
    this.before.clear();
    if (!idx.length) return 0;
    const after = Uint32Array.from(idx, (i) => this.cel[i]);
    this.ed.history.push(pixelEntry(this.cel, Uint16Array.from(idx), Uint32Array.from(b), after, label));
    this.ed.emit('pixels');
    return idx.length;
  }
}

export class Editor {
  constructor(doc) {
    this.history = new History(500);
    this.listeners = new Set();
    this.setDoc(doc);
  }

  setDoc(doc) {
    this.doc = doc;
    this.layer = doc.layers.length - 1;
    this.frame = 0;
    this.history.clear();
    this.emit('doc');
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(kind) { for (const fn of this.listeners) fn(kind); }

  get cel() { return this.doc.layers[this.layer].cels[this.frame]; }
  get currentLayer() { return this.doc.layers[this.layer]; }

  clampActive() {
    this.layer = Math.max(0, Math.min(this.doc.layers.length - 1, this.layer));
    this.frame = Math.max(0, Math.min(this.doc.frames.length - 1, this.frame));
  }
  setActive({ layer = this.layer, frame = this.frame } = {}) {
    this.layer = layer; this.frame = frame;
    this.clampActive();
    this.emit('active');
  }

  beginStroke() { return new Stroke(this, this.cel); }

  // ---- 復原/重做 ----
  undo() {
    const e = this.history.undo();
    if (e) { this.clampActive(); this.emit('history'); }
    return !!e;
  }
  redo() {
    const e = this.history.redo();
    if (e) { this.clampActive(); this.emit('history'); }
    return !!e;
  }

  /** 對外通用：套用一個有 undo/redo 的結構性變更並記入歷史。 */
  _do(entry, kind) {
    entry.redo();
    this.history.push(entry);
    this.clampActive();
    this.emit(kind);
  }

  // ---- 圖層 ----
  addLayer(name) {
    const doc = this.doc;
    const layer = makeLayer(doc, name || `圖層 ${doc.nextId}`);
    const at = this.layer + 1;
    this._do({
      label: '新增圖層',
      undo: () => { doc.layers.splice(at, 1); },
      redo: () => { doc.layers.splice(at, 0, layer); },
    }, 'layers');
    this.layer = at;
    this.emit('active');
    return layer;
  }

  deleteLayer(i = this.layer) {
    const doc = this.doc;
    if (doc.layers.length <= 1) return false;
    const layer = doc.layers[i];
    this._do({
      label: '刪除圖層',
      undo: () => { doc.layers.splice(i, 0, layer); },
      redo: () => { doc.layers.splice(i, 1); },
    }, 'layers');
    return true;
  }

  duplicateLayer(i = this.layer) {
    const doc = this.doc;
    const src = doc.layers[i];
    const copy = { ...src, id: doc.nextId++, name: `${src.name} 副本`, cels: src.cels.map((c) => c.slice()) };
    this._do({
      label: '複製圖層',
      undo: () => { doc.layers.splice(i + 1, 1); },
      redo: () => { doc.layers.splice(i + 1, 0, copy); },
    }, 'layers');
    this.layer = i + 1;
    this.emit('active');
    return copy;
  }

  /** dir = +1 往上（畫面上方，陣列後面）、-1 往下。 */
  moveLayer(i, dir) {
    const doc = this.doc;
    const j = i + dir;
    if (j < 0 || j >= doc.layers.length) return false;
    const swap = () => { [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]; };
    this._do({ label: '移動圖層', undo: swap, redo: swap }, 'layers');
    this.layer = j;
    this.emit('active');
    return true;
  }

  setLayerProps(i, props) {
    const layer = this.doc.layers[i];
    const keys = Object.keys(props).filter((k) => ['name', 'visible', 'opacity'].includes(k));
    const before = {}, after = {};
    for (const k of keys) { before[k] = layer[k]; after[k] = props[k]; }
    if (keys.every((k) => before[k] === after[k])) return false;
    this._do({
      label: '圖層屬性',
      undo: () => Object.assign(layer, before),
      redo: () => Object.assign(layer, after),
    }, 'layers');
    return true;
  }

  /** 把圖層 i 合併到它下面那一層（每個影格都合併）。 */
  mergeDown(i = this.layer) {
    const doc = this.doc;
    if (i <= 0) return false;
    const upper = doc.layers[i], lower = doc.layers[i - 1];
    const entries = [];
    if (upper.visible && upper.opacity > 0) {
      upper.cels.forEach((ucel, f) => {
        const lcel = lower.cels[f];
        const idx = [], before = [], after = [];
        for (let p = 0; p < lcel.length; p++) {
          if (ucel[p] >>> 24 === 0) continue;
          const nv = blendPacked(lcel[p], ucel[p], upper.opacity);
          if (nv !== lcel[p]) { idx.push(p); before.push(lcel[p]); after.push(nv); }
        }
        if (idx.length) entries.push(pixelEntry(lcel, Uint16Array.from(idx), Uint32Array.from(before), Uint32Array.from(after)));
      });
    }
    entries.push({
      label: '',
      undo: () => { doc.layers.splice(i, 0, upper); },
      redo: () => { doc.layers.splice(i, 1); },
    });
    this._do(groupEntry(entries, '合併圖層'), 'layers');
    this.layer = i - 1;
    this.emit('active');
    return true;
  }

  /** 匯入一張 RGBA 圖片當作新圖層（放在目前影格，左上角對齊，超出部分裁掉）。 */
  importLayer(name, rgba, iw, ih) {
    const doc = this.doc;
    const layer = makeLayer(doc, name);
    const cel = layer.cels[this.frame];
    for (let y = 0; y < Math.min(ih, doc.height); y++) {
      for (let x = 0; x < Math.min(iw, doc.width); x++) {
        const o = (y * iw + x) * 4;
        cel[y * doc.width + x] = ((rgba[o + 3] << 24) | (rgba[o + 2] << 16) | (rgba[o + 1] << 8) | rgba[o]) >>> 0;
      }
    }
    const at = doc.layers.length;
    this._do({
      label: '匯入圖片',
      undo: () => { doc.layers.splice(at, 1); },
      redo: () => { doc.layers.splice(at, 0, layer); },
    }, 'layers');
    this.layer = at;
    this.emit('active');
    return { layer, clipped: iw > doc.width || ih > doc.height };
  }

  // ---- 影格 ----
  addFrame(after = this.frame, duration) {
    const doc = this.doc;
    const at = after + 1;
    const d = duration ?? doc.frames[after]?.duration ?? DEFAULT_DURATION;
    const cels = doc.layers.map(() => blankCel(doc));
    this._do({
      label: '新增影格',
      undo: () => { doc.frames.splice(at, 1); doc.layers.forEach((l) => l.cels.splice(at, 1)); },
      redo: () => { doc.frames.splice(at, 0, { duration: d }); doc.layers.forEach((l, k) => l.cels.splice(at, 0, cels[k])); },
    }, 'frames');
    this.frame = at;
    this.emit('active');
  }

  duplicateFrame(i = this.frame) {
    const doc = this.doc;
    const at = i + 1;
    const d = doc.frames[i].duration;
    const cels = doc.layers.map((l) => l.cels[i].slice());
    this._do({
      label: '複製影格',
      undo: () => { doc.frames.splice(at, 1); doc.layers.forEach((l) => l.cels.splice(at, 1)); },
      redo: () => { doc.frames.splice(at, 0, { duration: d }); doc.layers.forEach((l, k) => l.cels.splice(at, 0, cels[k])); },
    }, 'frames');
    this.frame = at;
    this.emit('active');
  }

  deleteFrame(i = this.frame) {
    const doc = this.doc;
    if (doc.frames.length <= 1) return false;
    const fr = doc.frames[i];
    const cels = doc.layers.map((l) => l.cels[i]);
    this._do({
      label: '刪除影格',
      undo: () => { doc.frames.splice(i, 0, fr); doc.layers.forEach((l, k) => l.cels.splice(i, 0, cels[k])); },
      redo: () => { doc.frames.splice(i, 1); doc.layers.forEach((l) => l.cels.splice(i, 1)); },
    }, 'frames');
    return true;
  }

  moveFrame(i, dir) {
    const doc = this.doc;
    const j = i + dir;
    if (j < 0 || j >= doc.frames.length) return false;
    const swap = () => {
      [doc.frames[i], doc.frames[j]] = [doc.frames[j], doc.frames[i]];
      doc.layers.forEach((l) => { [l.cels[i], l.cels[j]] = [l.cels[j], l.cels[i]]; });
    };
    this._do({ label: '移動影格', undo: swap, redo: swap }, 'frames');
    this.frame = j;
    this.emit('active');
    return true;
  }

  /** 設定單一影格的時長（毫秒）；index 傳陣列或 'all' 可一次設多格。 */
  setDuration(index, ms) {
    const doc = this.doc;
    const v = Math.max(10, Math.min(60000, Math.round(ms)));
    const targets = index === 'all' ? doc.frames.map((_, i) => i) : [].concat(index);
    const before = targets.map((i) => doc.frames[i].duration);
    if (before.every((b) => b === v)) return false;
    this._do({
      label: '影格時長',
      undo: () => targets.forEach((i, k) => { doc.frames[i].duration = before[k]; }),
      redo: () => targets.forEach((i) => { doc.frames[i].duration = v; }),
    }, 'frames');
    return true;
  }
}
