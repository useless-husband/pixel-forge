// Pixel Forge 的介面層：把 src/ 裡的純函式與 DOM 接起來。
import { createDoc } from './doc.js';
import { Editor } from './editor.js';
import { composeFrame } from './composite.js';
import { parseHex, toHex, unpack } from './color.js';
import { line, rectPoints, ellipsePoints } from './geometry.js';
import { floodFill, matchGlobal } from './fill.js';
import { expandPoints, snapLine, snapSquare } from './tools.js';
import { PALETTES, detectPreset } from './palettes.js';
import { medianCut } from './quantize.js';
import { scaleNearest, buildSpriteSheet, maxScaleFor } from './export.js';
import { buildGif } from './gif.js';
import { serializeDoc, parseProject } from './project.js';
import { saveToStorage, loadFromStorage } from './storage.js';
import { createSampleDoc } from './sample.js';
import { Viewport } from './view.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const AUTOSAVE_KEY = 'pixelforge:autosave:v1';

// ---------------------------------------------------------------- 狀態
const S = {
  tool: 'pencil',
  fg: '#181425',
  bg: '#ffffff',
  size: 1,
  dither: 0,
  mirrorH: false,
  mirrorV: false,
  fillMode: 'contig',
  shapeFilled: false,
  grid: true,
  palIndex: -1,
  recent: [],
  onion: { on: false, before: 1, after: 1, alpha: 0.35 },
  play: { on: false, frame: 0, timer: 0 },
  sel: null,     // {x,y,w,h}
  float: null,   // {buf,w,h,x,y,stroke,label}
  clip: null,    // {buf,w,h}
  hover: null,
};

function safeStorage() {
  try { return window.localStorage; } catch { return null; }
}

function loadInitialDoc() {
  const st = safeStorage();
  return (st && loadFromStorage(st, AUTOSAVE_KEY)) || createSampleDoc();
}

const ed = new Editor(loadInitialDoc());

// ---------------------------------------------------------------- 畫布元素
const cvOnion = $('#cvOnion'), cvMain = $('#cvMain'), cvPv = $('#cvPreview'), cvOv = $('#cvOverlay');
const ctxOnion = cvOnion.getContext('2d');
const ctxMain = cvMain.getContext('2d');
const ctxPv = cvPv.getContext('2d');
const ctxOv = cvOv.getContext('2d');
const tmp = document.createElement('canvas');
const ctxTmp = tmp.getContext('2d');
const vpEl = $('#viewport');

const view = new Viewport(vpEl, $('#stage'), () => { requestOverlay(); $('#zoomLabel').textContent = `${Math.round(view.zoom * 100)}%`; });

// ---------------------------------------------------------------- 小工具
let toastTimer = 0;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const safeName = () => (ed.doc.name || 'pixel-forge').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'pixel-forge';
const fgPacked = () => parseHex(S.fg);
const bgPacked = () => parseHex(S.bg);
const frameNow = () => (S.play.on ? S.play.frame : ed.frame);

function imageDataOf(rgba, w, h) { return new ImageData(rgba, w, h); }

function canvasBlob(rgba, w, h, type = 'image/png') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(imageDataOf(rgba, w, h), 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('無法產生圖片'))), type));
}

async function decodeImageFile(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, data: cx.getImageData(0, 0, bmp.width, bmp.height).data };
}

// ---------------------------------------------------------------- 繪製
function sizeCanvases() {
  const { width: w, height: h } = ed.doc;
  for (const c of [cvOnion, cvMain, cvPv, tmp]) { c.width = w; c.height = h; }
  view.setDocSize(w, h);
  $('#sizeInfo').textContent = `${w}×${h}`;
}

function render() {
  const doc = ed.doc, f = Math.min(frameNow(), doc.frames.length - 1);
  ctxMain.putImageData(imageDataOf(composeFrame(doc, f), doc.width, doc.height), 0, 0);
  renderOnion(f);
  renderFloat();
  drawThumb(f);
}

function renderOnion(f) {
  const doc = ed.doc;
  ctxOnion.clearRect(0, 0, doc.width, doc.height);
  if (!S.onion.on || S.play.on) return;
  const draw = (fi, tint, alpha) => {
    if (fi < 0 || fi >= doc.frames.length) return;
    ctxTmp.globalCompositeOperation = 'source-over';
    ctxTmp.putImageData(imageDataOf(composeFrame(doc, fi), doc.width, doc.height), 0, 0);
    ctxTmp.globalCompositeOperation = 'source-atop';
    ctxTmp.fillStyle = tint;
    ctxTmp.fillRect(0, 0, doc.width, doc.height);
    ctxOnion.globalAlpha = alpha;
    ctxOnion.drawImage(tmp, 0, 0);
    ctxOnion.globalAlpha = 1;
  };
  for (let k = 1; k <= S.onion.before; k++) draw(f - k, 'rgba(255,64,64,.55)', S.onion.alpha * (1 - 0.25 * (k - 1)));
  for (let k = 1; k <= S.onion.after; k++) draw(f + k, 'rgba(64,120,255,.55)', S.onion.alpha * (1 - 0.25 * (k - 1)));
}

function renderFloat() {
  ctxPv.clearRect(0, 0, cvPv.width, cvPv.height);
  const f = S.float;
  if (!f) return;
  const bytes = new Uint8ClampedArray(f.w * f.h * 4);
  for (let i = 0; i < f.buf.length; i++) {
    const [r, g, b, a] = unpack(f.buf[i]);
    bytes[i * 4] = r; bytes[i * 4 + 1] = g; bytes[i * 4 + 2] = b; bytes[i * 4 + 3] = a;
  }
  ctxPv.putImageData(imageDataOf(bytes, f.w, f.h), f.x, f.y);
}

function clearPreview() { ctxPv.clearRect(0, 0, cvPv.width, cvPv.height); }

function previewPoints(pts, css) {
  clearPreview();
  ctxPv.fillStyle = css;
  const { width: w, height: h } = ed.doc;
  for (const [x, y] of pts) if (x >= 0 && y >= 0 && x < w && y < h) ctxPv.fillRect(x, y, 1, 1);
}

// ---- 疊加層：格線、選取框、鏡像軸、游標
let overlayQueued = false;
function requestOverlay() {
  if (overlayQueued) return;
  overlayQueued = true;
  requestAnimationFrame(() => { overlayQueued = false; drawOverlay(); });
}

function syncOverlaySize() {
  const r = vpEl.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cvOv.width !== w || cvOv.height !== h) { cvOv.width = w; cvOv.height = h; }
  ctxOv.setTransform(dpr, 0, 0, dpr, 0, 0);
  return r;
}

function drawOverlay() {
  const r = syncOverlaySize();
  const ctx = ctxOv;
  ctx.clearRect(0, 0, r.width, r.height);
  const { zoom: z, ox, oy } = view;
  const { width: w, height: h } = ed.doc;

  if (S.grid && z >= 6) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w * z, h * z);
    ctx.clip();
    const drawLines = (step, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) { const sx = Math.round(ox + x * z) + 0.5; ctx.moveTo(sx, oy); ctx.lineTo(sx, oy + h * z); }
      for (let y = 0; y <= h; y += step) { const sy = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox, sy); ctx.lineTo(ox + w * z, sy); }
      ctx.stroke();
    };
    drawLines(1, 'rgba(120,120,120,.35)');
    if (w >= 16 && h >= 16) drawLines(8, 'rgba(120,120,120,.6)');
    ctx.restore();
  }

  if (S.mirrorH || S.mirrorV) {
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#e0446a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (S.mirrorH) { const sx = Math.round(ox + (w / 2) * z) + 0.5; ctx.moveTo(sx, oy); ctx.lineTo(sx, oy + h * z); }
    if (S.mirrorV) { const sy = Math.round(oy + (h / 2) * z) + 0.5; ctx.moveTo(ox, sy); ctx.lineTo(ox + w * z, sy); }
    ctx.stroke();
    ctx.restore();
  }

  const rect = S.float ? { x: S.float.x, y: S.float.y, w: S.float.w, h: S.float.h } : S.sel;
  if (rect) {
    const x = Math.round(ox + rect.x * z) + 0.5, y = Math.round(oy + rect.y * z) + 0.5;
    const rw = Math.round(rect.w * z), rh = Math.round(rect.h * z);
    ctx.save();
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(x, y, rw, rh);
    ctx.lineDashOffset = 5;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(x, y, rw, rh);
    ctx.restore();
  }

  if (S.hover && view.inside(S.hover.x, S.hover.y) && !['select', 'picker', 'fill'].includes(S.tool) && z >= 3) {
    const o = (S.size - 1) >> 1;
    const x = ox + (S.hover.x - o) * z, y = oy + (S.hover.y - o) * z, s = S.size * z;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(s) - 1, Math.round(s) - 1);
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.strokeRect(Math.round(x) + 1.5, Math.round(y) + 1.5, Math.round(s) - 3, Math.round(s) - 3);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- 選取 / 浮動內容
function normRect(x0, y0, x1, y1) {
  const { width: w, height: h } = ed.doc;
  const cx = (v, m) => Math.max(0, Math.min(m - 1, v));
  const a = cx(x0, w), b = cx(x1, w), c = cx(y0, h), d = cx(y1, h);
  return { x: Math.min(a, b), y: Math.min(c, d), w: Math.abs(a - b) + 1, h: Math.abs(c - d) + 1 };
}
const inRect = (r, x, y) => r && x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

function readRect(r) {
  const st = ed.beginStroke();
  const buf = new Uint32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) buf[y * r.w + x] = st.get(r.x + x, r.y + y);
  return buf;
}

function liftSelection() {
  const r = S.sel;
  const st = ed.beginStroke();
  const buf = new Uint32Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) { buf[y * r.w + x] = st.get(r.x + x, r.y + y); st.set(r.x + x, r.y + y, 0); }
  }
  S.float = { buf, w: r.w, h: r.h, x: r.x, y: r.y, stroke: st, label: '移動選取' };
  render();
}

function commitFloat() {
  const f = S.float;
  if (!f) return;
  S.float = null;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const v = f.buf[y * f.w + x];
      if (v >>> 24) f.stroke.set(f.x + x, f.y + y, v);
    }
  }
  f.stroke.commit(f.label);
  S.sel = { x: f.x, y: f.y, w: f.w, h: f.h };
  render();
  requestOverlay();
}

function cancelFloat() {
  const f = S.float;
  if (!f) return;
  f.stroke.rollback();
  S.float = null;
  S.sel = null;
  render();
  requestOverlay();
}

function copySelection() {
  if (S.float) S.clip = { buf: S.float.buf.slice(), w: S.float.w, h: S.float.h };
  else if (S.sel) S.clip = { buf: readRect(S.sel), w: S.sel.w, h: S.sel.h };
  else return false;
  toast('已複製選取範圍');
  return true;
}

function deleteSelection() {
  if (S.float) {
    const f = S.float;
    S.float = null;
    f.stroke.commit('刪除選取');
    S.sel = null;
  } else if (S.sel) {
    if (!layerWritable()) return;
    const st = ed.beginStroke();
    for (let y = 0; y < S.sel.h; y++) for (let x = 0; x < S.sel.w; x++) st.set(S.sel.x + x, S.sel.y + y, 0);
    st.commit('刪除選取');
    S.sel = null;
  }
  render();
  requestOverlay();
}

function pasteClipboard() {
  if (!S.clip) { toast('剪貼簿是空的，先用選取工具複製'); return; }
  if (!layerWritable()) return;
  commitFloat();
  const c = S.clip;
  const x = S.sel ? S.sel.x : 0, y = S.sel ? S.sel.y : 0;
  S.float = { buf: c.buf.slice(), w: c.w, h: c.h, x, y, stroke: ed.beginStroke(), label: '貼上' };
  S.sel = { x, y, w: c.w, h: c.h };
  setTool('select');
  render();
  requestOverlay();
}

function selectAll() {
  commitFloat();
  S.sel = { x: 0, y: 0, w: ed.doc.width, h: ed.doc.height };
  setTool('select');
  requestOverlay();
}

// ---------------------------------------------------------------- 指標事件
const pointers = new Map();
let cur = null;      // 目前手勢
let spaceDown = false;

function layerWritable() {
  if (!ed.currentLayer.visible) { toast('目前的圖層被隱藏了，請先讓它顯示'); return false; }
  return true;
}

function drawingColor(e) {
  if (S.tool === 'eraser') return 0;
  return e.button === 2 ? bgPacked() : fgPacked();
}
function cssOf(packed) {
  const [r, g, b, a] = unpack(packed);
  return `rgba(${r},${g},${b},${a / 255})`;
}
function expand(pts) {
  return expandPoints(pts, { size: S.size, dither: S.dither, w: ed.doc.width, h: ed.doc.height, mirrorH: S.mirrorH, mirrorV: S.mirrorV });
}

function noteColor(packed) {
  if (!(packed >>> 24)) return;
  const hex = toHex(packed);
  S.recent = [hex, ...S.recent.filter((c) => c !== hex)].slice(0, 16);
  buildRecent();
}

function pickAt(x, y, e) {
  if (!view.inside(x, y)) return;
  const rgba = composeFrame(ed.doc, ed.frame);
  const o = (y * ed.doc.width + x) * 4;
  if (rgba[o + 3] === 0) { toast('那個位置是透明的'); return; }
  const hex = toHex(((rgba[o + 3] << 24) | (rgba[o + 2] << 16) | (rgba[o + 1] << 8) | rgba[o]) >>> 0);
  if (e.button === 2) setBg(hex); else setFg(hex);
}

function onDown(e) {
  vpEl.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (pointers.size === 2 && e.pointerType === 'touch') {
    abortGesture();
    const [a, b] = [...pointers.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = view.rect;
    cur = {
      kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: view.zoom,
      dx: (mx - r.left - view.ox) / view.zoom, dy: (my - r.top - view.oy) / view.zoom,
    };
    return;
  }
  if (pointers.size > 1) return;
  e.preventDefault();
  if (e.button === 1 || spaceDown) {
    cur = { kind: 'pan', x: e.clientX, y: e.clientY };
    vpEl.classList.add('dragging');
    return;
  }
  if (S.play.on) stopPlay();
  const p = view.toDoc(e.clientX, e.clientY);
  const tool = e.altKey ? 'picker' : S.tool;
  if (tool === 'picker') { cur = { kind: 'pick' }; pickAt(p.x, p.y, e); return; }
  if (tool === 'select') return selectDown(p, e);
  if (S.float) commitFloat();
  if (!layerWritable()) return;
  const color = drawingColor(e);
  if (e.button > 2) return;
  if (tool === 'pencil' || tool === 'eraser') {
    const stroke = ed.beginStroke();
    cur = { kind: 'free', stroke, last: p, color };
    paintFree(p, p);
  } else if (tool === 'fill') {
    doFill(p, e, color);
    cur = { kind: 'none' };
  } else {
    cur = { kind: 'shape', tool, start: p, end: p, color };
    drawShapePreview(e);
  }
  S.hover = p;
}

function paintFree(a, b) {
  const pts = expand(line(a.x, a.y, b.x, b.y));
  for (const [x, y] of pts) cur.stroke.set(x, y, cur.color);
  render();
}

function doFill(p, e, color) {
  const { width: w, height: h } = ed.doc;
  if (!view.inside(p.x, p.y)) return;
  const cel = ed.cel;
  if (cel[p.y * w + p.x] === color) return;
  const idx = (S.fillMode === 'global' || e.shiftKey) ? matchGlobal(cel, cel[p.y * w + p.x]) : floodFill(cel, w, h, p.x, p.y);
  const st = ed.beginStroke();
  for (const i of idx) st.setIndex(i, color);
  st.commit('油漆桶');
  noteColor(color);
}

function shapePoints(c, shift) {
  let { x: x1, y: y1 } = c.end;
  const { x: x0, y: y0 } = c.start;
  if (shift) [x1, y1] = c.tool === 'line' ? snapLine(x0, y0, x1, y1) : snapSquare(x0, y0, x1, y1);
  if (c.tool === 'line') return line(x0, y0, x1, y1);
  if (c.tool === 'rect') return rectPoints(x0, y0, x1, y1, S.shapeFilled);
  return ellipsePoints(x0, y0, x1, y1, S.shapeFilled);
}
function drawShapePreview(e) {
  previewPoints(expand(shapePoints(cur, e.shiftKey)), cssOf(cur.color));
}

function selectDown(p, e) {
  if (S.float && inRect(S.float, p.x, p.y)) {
    cur = { kind: 'move', px: p.x, py: p.y, fx: S.float.x, fy: S.float.y };
  } else if (S.sel && !S.float && inRect(S.sel, p.x, p.y)) {
    if (!layerWritable()) return;
    liftSelection();
    cur = { kind: 'move', px: p.x, py: p.y, fx: S.float.x, fy: S.float.y };
  } else {
    commitFloat();
    S.sel = null;
    cur = { kind: 'marquee', start: p };
  }
  requestOverlay();
}

function onMove(e) {
  const rec = pointers.get(e.pointerId);
  if (rec) { rec.x = e.clientX; rec.y = e.clientY; }
  const p = view.toDoc(e.clientX, e.clientY);
  S.hover = p;
  $('#coords').textContent = view.inside(p.x, p.y) ? `${p.x}, ${p.y}` : '–';
  if (!cur) { requestOverlay(); return; }
  switch (cur.kind) {
    case 'pan':
      view.panBy(e.clientX - cur.x, e.clientY - cur.y);
      cur.x = e.clientX; cur.y = e.clientY;
      break;
    case 'pinch': {
      if (pointers.size < 2) break;
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = view.rect;
      view.zoom = Math.max(0.5, Math.min(96, cur.z0 * d / cur.d0));
      view.ox = mx - r.left - cur.dx * view.zoom;
      view.oy = my - r.top - cur.dy * view.zoom;
      view.auto = false;
      view.clampPan();
      view.layout();
      break;
    }
    case 'free': {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      const list = evs.length ? evs : [e];
      for (const ev of list) {
        const q = view.toDoc(ev.clientX, ev.clientY);
        paintFree(cur.last, q);
        cur.last = q;
      }
      break;
    }
    case 'shape':
      cur.end = p;
      drawShapePreview(e);
      break;
    case 'pick':
      pickAt(p.x, p.y, e);
      break;
    case 'marquee':
      S.sel = normRect(cur.start.x, cur.start.y, p.x, p.y);
      break;
    case 'move':
      S.float.x = cur.fx + (p.x - cur.px);
      S.float.y = cur.fy + (p.y - cur.py);
      renderFloat();
      break;
    default:
  }
  requestOverlay();
}

function onUp(e) {
  pointers.delete(e.pointerId);
  if (cur?.kind === 'pinch') { if (pointers.size < 2) cur = pointers.size ? { kind: 'none' } : null; return; }
  if (pointers.size > 0 && e.pointerType === 'touch') return;
  const c = cur;
  cur = null;
  vpEl.classList.remove('dragging');
  if (!c) return;
  switch (c.kind) {
    case 'free':
      if (c.stroke.commit(S.tool === 'eraser' ? '橡皮擦' : '鉛筆')) noteColor(c.color);
      break;
    case 'shape': {
      const st = ed.beginStroke();
      for (const [x, y] of expand(shapePoints(c, e.shiftKey))) st.set(x, y, c.color);
      clearPreview();
      if (st.commit({ line: '直線', rect: '矩形', ellipse: '橢圓' }[c.tool])) noteColor(c.color);
      break;
    }
    case 'marquee':
      if (S.sel && S.sel.w * S.sel.h <= 1 && c.start.x === view.toDoc(e.clientX, e.clientY).x && c.start.y === view.toDoc(e.clientX, e.clientY).y) S.sel = null;
      break;
    default:
  }
  requestOverlay();
}

/** 雙指開始時，放棄尚未完成的筆畫。 */
function abortGesture() {
  if (!cur) return;
  if (cur.kind === 'free') { cur.stroke.rollback(); render(); }
  if (cur.kind === 'shape') clearPreview();
  cur = null;
}

vpEl.addEventListener('pointerdown', onDown);
vpEl.addEventListener('pointermove', onMove);
vpEl.addEventListener('pointerup', onUp);
vpEl.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); abortGesture(); vpEl.classList.remove('dragging'); });
vpEl.addEventListener('pointerleave', () => { S.hover = null; $('#coords').textContent = '–'; requestOverlay(); });
vpEl.addEventListener('contextmenu', (e) => e.preventDefault());
vpEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const dy = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
  view.zoomAt(e.clientX, e.clientY, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022)));
}, { passive: false });

// ---------------------------------------------------------------- 工具與選項
function setTool(name) {
  if (S.tool === 'select' && name !== 'select') commitFloat();
  S.tool = name;
  $$('#toolGrid button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === name)));
  requestOverlay();
}
$$('#toolGrid button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

function setToggle(id, on) { $(id).setAttribute('aria-pressed', String(on)); }
function setMirrorH(on) { S.mirrorH = on; setToggle('#optMirrorH', on); requestOverlay(); }
function setMirrorV(on) { S.mirrorV = on; setToggle('#optMirrorV', on); requestOverlay(); }
function setSize(n) {
  S.size = Math.max(1, Math.min(8, n));
  $('#optSize').value = S.size;
  $('#sizeOut').textContent = S.size;
  requestOverlay();
}
function setGrid(on) { S.grid = on; setToggle('#gridToggle', on); requestOverlay(); }

$('#optSize').addEventListener('input', (e) => setSize(Number(e.target.value)));
$('#optDither').addEventListener('change', (e) => { S.dither = Number(e.target.value); });
$('#optMirrorH').addEventListener('click', () => setMirrorH(!S.mirrorH));
$('#optMirrorV').addEventListener('click', () => setMirrorV(!S.mirrorV));
$('#optFill').addEventListener('change', (e) => { S.fillMode = e.target.value; });
$('#optShape').addEventListener('change', (e) => { S.shapeFilled = e.target.value === 'filled'; });
$('#gridToggle').addEventListener('click', () => setGrid(!S.grid));
$('#zoomIn').addEventListener('click', () => view.zoomCenter(1.5));
$('#zoomOut').addEventListener('click', () => view.zoomCenter(1 / 1.5));
$('#zoomFit').addEventListener('click', () => view.fit());

// ---------------------------------------------------------------- 色彩
function setFg(hex) {
  S.fg = hex;
  $('#fgSwatch').style.background = hex;
  $('#hexInput').value = hex;
  $('#colorPicker').value = hex;
  markPalette();
}
function setBg(hex) {
  S.bg = hex;
  $('#bgSwatch').style.background = hex;
}
function swapColors() { const f = S.fg; setFg(S.bg); setBg(f); }

$('#btnSwap').addEventListener('click', swapColors);
$('#fgSwatch').addEventListener('click', () => $('#colorPicker').click());
$('#bgSwatch').addEventListener('click', swapColors);
$('#colorPicker').addEventListener('input', (e) => setFg(e.target.value));
$('#hexInput').addEventListener('change', (e) => {
  const c = parseHex(e.target.value);
  if (c === null) { toast('HEX 格式不對，例如 #ff8800'); e.target.value = S.fg; return; }
  setFg(toHex(c));
});

function chip(hex, i, kind) {
  const b = document.createElement('button');
  b.className = 'chip';
  b.style.background = hex;
  b.title = hex;
  b.setAttribute('aria-label', hex);
  b.dataset.hex = hex;
  b.addEventListener('click', (e) => {
    if (kind === 'palette') {
      if (e.shiftKey) { removePaletteColor(i); return; }
      S.palIndex = i;
    }
    setFg(hex);
    if (kind === 'palette') markPalette();
  });
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); setBg(hex); });
  return b;
}

function buildPalette() {
  const el = $('#palette');
  el.replaceChildren(...ed.doc.palette.map((hex, i) => chip(hex, i, 'palette')));
  markPalette();
  const id = detectPreset(ed.doc.palette);
  $('#paletteSelect').value = id;
  const preset = PALETTES.find((p) => p.id === id);
  $('#paletteSource').textContent = preset ? preset.source : '自訂色盤：會跟著專案一起存檔。左鍵設前景色，右鍵設背景色，Shift+點擊刪除。';
}
function markPalette() {
  $$('#palette .chip').forEach((b, i) => {
    b.classList.toggle('sel', i === S.palIndex);
    b.classList.toggle('fgmark', b.dataset.hex === S.fg);
  });
}
function buildRecent() {
  $('#recent').replaceChildren(...S.recent.map((hex, i) => chip(hex, i, 'recent')));
}
function removePaletteColor(i) {
  if (ed.doc.palette.length <= 1) { toast('色盤至少要留一個顏色'); return; }
  ed.doc.palette.splice(i, 1);
  S.palIndex = -1;
  buildPalette();
  scheduleSave();
}

$('#paletteSelect').replaceChildren(
  ...PALETTES.map((p) => new Option(`${p.name}（${p.colors.length}）`, p.id)),
  new Option('自訂', 'custom'),
);
$('#paletteSelect').addEventListener('change', (e) => {
  const p = PALETTES.find((x) => x.id === e.target.value);
  if (p) { ed.doc.palette = [...p.colors]; S.palIndex = -1; buildPalette(); scheduleSave(); }
});
$('#palAdd').addEventListener('click', () => {
  if (ed.doc.palette.includes(S.fg)) { toast('色盤裡已經有這個顏色'); return; }
  if (ed.doc.palette.length >= 256) { toast('色盤最多 256 色'); return; }
  ed.doc.palette.push(S.fg);
  S.palIndex = ed.doc.palette.length - 1;
  buildPalette();
  scheduleSave();
});
$('#palDel').addEventListener('click', () => {
  if (S.palIndex < 0) { toast('先點一個色盤顏色再刪除'); return; }
  removePaletteColor(S.palIndex);
});
$('#btnQuant').addEventListener('click', () => $('#fileQuant').click());
$('#fileQuant').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const n = Math.max(2, Math.min(64, Number($('#quantN').value) || 16));
    const img = await decodeImageFile(file);
    const pal = medianCut(img.data, n);
    if (!pal.length) { toast('這張圖片沒有不透明的像素'); return; }
    ed.doc.palette = pal.map(([r, g, b]) => toHex(((255 << 24) | (b << 16) | (g << 8) | r) >>> 0));
    S.palIndex = -1;
    buildPalette();
    scheduleSave();
    toast(`已從圖片建立 ${pal.length} 色的色盤`);
  } catch { toast('無法讀取這張圖片'); }
});

// ---------------------------------------------------------------- 圖層面板
function act(fn) { commitFloat(); return fn(); }

function buildLayers() {
  const doc = ed.doc;
  const list = $('#layerList');
  list.replaceChildren(...doc.layers.map((l, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === ed.layer));
    li.className = (i === ed.layer ? 'sel' : '') + (l.visible ? '' : ' hidden');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = l.visible;
    cb.setAttribute('aria-label', `顯示 ${l.name}`);
    cb.addEventListener('click', (e) => e.stopPropagation());
    cb.addEventListener('change', () => act(() => ed.setLayerProps(i, { visible: cb.checked })));
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = l.name;
    const op = document.createElement('span');
    op.className = 'op';
    op.textContent = l.opacity < 1 ? `${Math.round(l.opacity * 100)}%` : '';
    li.append(cb, nm, op);
    li.addEventListener('click', () => act(() => ed.setActive({ layer: i })));
    return li;
  }));
  const l = ed.currentLayer;
  $('#layerName').value = l.name;
  $('#layerOpacity').value = Math.round(l.opacity * 100);
  $('#layerOpacityOut').textContent = `${Math.round(l.opacity * 100)}%`;
  $('#layDel').disabled = doc.layers.length <= 1;
  $('#layMerge').disabled = ed.layer <= 0;
  $('#layUp').disabled = ed.layer >= doc.layers.length - 1;
  $('#layDown').disabled = ed.layer <= 0;
}

$('#layAdd').addEventListener('click', () => act(() => ed.addLayer()));
$('#layDup').addEventListener('click', () => act(() => ed.duplicateLayer()));
$('#layDel').addEventListener('click', () => act(() => ed.deleteLayer()));
$('#layUp').addEventListener('click', () => act(() => ed.moveLayer(ed.layer, 1)));
$('#layDown').addEventListener('click', () => act(() => ed.moveLayer(ed.layer, -1)));
$('#layMerge').addEventListener('click', () => act(() => ed.mergeDown()));
$('#layerName').addEventListener('change', (e) => act(() => ed.setLayerProps(ed.layer, { name: e.target.value.trim() || ed.currentLayer.name })));
$('#layerOpacity').addEventListener('input', (e) => { $('#layerOpacityOut').textContent = `${e.target.value}%`; });
$('#layerOpacity').addEventListener('change', (e) => act(() => ed.setLayerProps(ed.layer, { opacity: Number(e.target.value) / 100 })));

// ---------------------------------------------------------------- 時間軸
function drawThumb(i) {
  const c = $('#frames').children[i]?.querySelector('canvas');
  if (!c) return;
  const doc = ed.doc;
  if (c.width !== doc.width) { c.width = doc.width; c.height = doc.height; }
  c.getContext('2d').putImageData(imageDataOf(composeFrame(doc, i), doc.width, doc.height), 0, 0);
}

function buildFrames() {
  const doc = ed.doc;
  const box = $('#frames');
  box.replaceChildren(...doc.frames.map((fr, i) => {
    const d = document.createElement('div');
    d.className = 'frame';
    d.setAttribute('role', 'option');
    const th = document.createElement('div');
    th.className = 'thumb';
    const cv = document.createElement('canvas');
    cv.width = doc.width; cv.height = doc.height;
    const aspect = doc.width / doc.height;
    cv.style.width = aspect >= 1 ? '100%' : `${Math.max(10, aspect * 100)}%`;
    cv.style.aspectRatio = `${doc.width} / ${doc.height}`;
    th.append(cv);
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<span>${i + 1}</span><span>ms</span>`;
    const inp = document.createElement('input');
    inp.type = 'number'; inp.min = 10; inp.max = 60000; inp.step = 10;
    inp.value = fr.duration;
    inp.setAttribute('aria-label', `第 ${i + 1} 格時長（毫秒）`);
    inp.addEventListener('click', (e) => e.stopPropagation());
    inp.addEventListener('change', () => { ed.setDuration(i, Number(inp.value) || fr.duration); });
    d.append(th, meta, inp);
    d.addEventListener('click', () => act(() => ed.setActive({ frame: i })));
    return d;
  }));
  doc.frames.forEach((_, i) => drawThumb(i));
  markFrames();
  updateFps();
}

function markFrames() {
  [...$('#frames').children].forEach((el, i) => {
    el.classList.toggle('sel', i === ed.frame);
    el.classList.toggle('playing', S.play.on && i === S.play.frame);
    el.setAttribute('aria-selected', String(i === ed.frame));
  });
  const sel = $('#frames').children[ed.frame];
  sel?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  $('#frameDel').disabled = ed.doc.frames.length <= 1;
}

function updateFps() {
  const ds = ed.doc.frames.map((f) => f.duration);
  const avg = ds.reduce((a, b) => a + b, 0) / ds.length;
  $('#fpsInput').value = Math.max(1, Math.min(60, Math.round(1000 / avg)));
}

$('#frameAdd').addEventListener('click', () => act(() => ed.addFrame()));
$('#frameDup').addEventListener('click', () => act(() => ed.duplicateFrame()));
$('#frameDel').addEventListener('click', () => act(() => ed.deleteFrame()));
$('#frameLeft').addEventListener('click', () => act(() => ed.moveFrame(ed.frame, -1)));
$('#frameRight').addEventListener('click', () => act(() => ed.moveFrame(ed.frame, 1)));
$('#fpsInput').addEventListener('change', (e) => {
  const fps = Math.max(1, Math.min(60, Number(e.target.value) || 10));
  ed.setDuration('all', 1000 / fps);
  e.target.value = fps;
});
$('#onionOn').addEventListener('change', (e) => { S.onion.on = e.target.checked; render(); });
$('#onionBefore').addEventListener('change', (e) => { S.onion.before = Number(e.target.value); render(); });
$('#onionAfter').addEventListener('change', (e) => { S.onion.after = Number(e.target.value); render(); });
$('#onionAlpha').addEventListener('input', (e) => { S.onion.alpha = Number(e.target.value) / 100; render(); });

function startPlay() {
  commitFloat();
  S.play.on = true;
  S.play.frame = ed.frame;
  $('#btnPlay').textContent = '停止';
  $('#btnPlay').setAttribute('aria-pressed', 'true');
  const tick = () => {
    render();
    markFrames();
    const d = ed.doc.frames[S.play.frame]?.duration ?? 100;
    S.play.timer = setTimeout(() => {
      S.play.frame = (S.play.frame + 1) % ed.doc.frames.length;
      tick();
    }, d);
  };
  tick();
}
function stopPlay() {
  clearTimeout(S.play.timer);
  S.play.on = false;
  $('#btnPlay').textContent = '播放';
  $('#btnPlay').setAttribute('aria-pressed', 'false');
  render();
  markFrames();
}
const togglePlay = () => (S.play.on ? stopPlay() : startPlay());
$('#btnPlay').addEventListener('click', togglePlay);

// ---------------------------------------------------------------- 復原 / 重做
function doUndo() {
  if (S.play.on) stopPlay();
  if (S.float) { cancelFloat(); return; }
  if (!ed.undo()) toast('沒有可以復原的步驟');
}
function doRedo() {
  if (S.play.on) stopPlay();
  commitFloat();
  ed.redo();
}
$('#btnUndo').addEventListener('click', doUndo);
$('#btnRedo').addEventListener('click', doRedo);
function updateUndoButtons() {
  $('#btnUndo').disabled = !ed.history.canUndo && !S.float;
  $('#btnRedo').disabled = !ed.history.canRedo;
}

// ---------------------------------------------------------------- 存檔 / 自動存檔
let saveTimer = 0;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(autosave, 800);
}
function autosave() {
  const st = safeStorage();
  const el = $('#saveStatus');
  if (!st) { el.textContent = '此瀏覽器無法自動存檔'; return; }
  const r = saveToStorage(st, AUTOSAVE_KEY, ed.doc);
  if (r.ok) {
    const t = new Date();
    el.textContent = `已自動儲存 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  } else {
    el.textContent = '專案太大，未自動儲存';
    if (!autosave.warned) { toast('專案太大，無法自動存檔到瀏覽器，請用「存檔」下載 .pixelforge'); autosave.warned = true; }
  }
}

function saveProject() {
  commitFloat();
  download(new Blob([serializeDoc(ed.doc)], { type: 'application/json' }), `${safeName()}.pixelforge`);
  toast('已下載 .pixelforge 檔');
}

function confirmReplace() {
  return !ed.history.canUndo || window.confirm('這會取代目前的作品。確定要繼續嗎？');
}

$('#btnSave').addEventListener('click', saveProject);
$('#btnOpen').addEventListener('click', () => $('#fileOpen').click());
$('#fileOpen').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const doc = parseProject(await file.text());
    if (!confirmReplace()) return;
    S.sel = null; S.float = null;
    ed.setDoc(doc);
    toast(`已開啟 ${file.name}`);
  } catch (err) { toast(`無法開啟：${err.message}`); }
});

$('#docName').addEventListener('change', (e) => { ed.doc.name = e.target.value.trim() || '未命名'; e.target.value = ed.doc.name; scheduleSave(); });

// 新增
$('#btnNew').addEventListener('click', () => {
  $('#newW').value = ed.doc.width; $('#newH').value = ed.doc.height;
  $('#dlgNew').showModal();
});
$$('#newPresets button').forEach((b) => b.addEventListener('click', () => { $('#newW').value = b.dataset.size; $('#newH').value = b.dataset.size; }));
$('#dlgNew').addEventListener('close', () => {
  if ($('#dlgNew').returnValue !== 'ok') return;
  const clamp = (v) => Math.max(8, Math.min(256, Math.round(Number(v)) || 32));
  if (!confirmReplace()) return;
  S.sel = null; S.float = null;
  ed.setDoc(createDoc({ width: clamp($('#newW').value), height: clamp($('#newH').value) }));
});

// 匯入圖片成圖層
$('#btnImport').addEventListener('click', () => $('#fileImport').click());
$('#fileImport').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    commitFloat();
    const img = await decodeImageFile(file);
    const { clipped } = ed.importLayer(file.name.replace(/\.[^.]+$/, '') || '匯入', img.data, img.w, img.h);
    toast(clipped ? '圖片比畫布大，超出的部分已裁掉' : '已匯入為新圖層');
  } catch { toast('無法讀取這張圖片'); }
});

// ---------------------------------------------------------------- 匯出
function fillScaleSelect(sel, def) {
  const max = maxScaleFor(ed.doc.width, ed.doc.height);
  const opts = [1, 2, 4, 8, 16, 32].filter((k) => k <= max);
  sel.replaceChildren(...opts.map((k) => new Option(`${k}×（${ed.doc.width * k}×${ed.doc.height * k}）`, k)));
  sel.value = String(opts.includes(def) ? def : opts.at(-1));
}

$('#btnExport').addEventListener('click', () => {
  commitFloat();
  fillScaleSelect($('#pngScale'), 8);
  fillScaleSelect($('#sheetScale'), 1);
  fillScaleSelect($('#gifScale'), 4);
  $('#sheetCols').value = Math.min(ed.doc.frames.length, 4);
  $('#gifInfo').textContent = '';
  $('#gifPreviewBox').replaceChildren();
  $('#dlgExport').showModal();
});

$('#doPng').addEventListener('click', async () => {
  const k = Number($('#pngScale').value), doc = ed.doc;
  const rgba = scaleNearest(composeFrame(doc, ed.frame), doc.width, doc.height, k);
  download(await canvasBlob(rgba, doc.width * k, doc.height * k), `${safeName()}${k > 1 ? `@${k}x` : ''}.png`);
});

$('#doSheet').addEventListener('click', async () => {
  const doc = ed.doc, k = Number($('#sheetScale').value);
  const frames = doc.frames.map((f, i) => ({ rgba: composeFrame(doc, i), duration: f.duration }));
  const imageName = `${safeName()}-sheet.png`;
  const sheet = buildSpriteSheet({
    frames, width: doc.width, height: doc.height, scale: k, imageName,
    layout: $('#sheetLayout').value, columns: Number($('#sheetCols').value) || undefined,
  });
  download(await canvasBlob(sheet.rgba, sheet.width, sheet.height), imageName);
  download(new Blob([JSON.stringify(sheet.json, null, 2)], { type: 'application/json' }), `${safeName()}-sheet.json`);
});

let gifUrl = '';
$('#doGif').addEventListener('click', () => {
  const doc = ed.doc, k = Number($('#gifScale').value);
  const bytes = buildGif({
    rgbaFrames: doc.frames.map((_, i) => composeFrame(doc, i)),
    delays: doc.frames.map((f) => f.duration),
    width: doc.width, height: doc.height, scale: k,
    loop: $('#gifLoop').checked ? 0 : false,
  });
  const blob = new Blob([bytes], { type: 'image/gif' });
  if (gifUrl) URL.revokeObjectURL(gifUrl);
  gifUrl = URL.createObjectURL(blob);
  const img = new Image();
  img.alt = 'GIF 預覽';
  img.src = gifUrl;
  $('#gifPreviewBox').replaceChildren(img);
  $('#gifInfo').textContent = `${doc.frames.length} 格，${doc.width * k}×${doc.height * k}，${(bytes.length / 1024).toFixed(1)} KB`;
  download(blob, `${safeName()}.gif`);
});
$('#sheetLayout').addEventListener('change', (e) => { $('#sheetCols').disabled = e.target.value === 'row'; });

$('#btnHelp').addEventListener('click', () => $('#dlgHelp').showModal());

// ---------------------------------------------------------------- 手機面板
$$('#tabbar button').forEach((b) => b.addEventListener('click', () => {
  const app = $('#app');
  app.dataset.sheet = app.dataset.sheet === b.dataset.sheet ? '' : b.dataset.sheet;
  $$('#tabbar button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.sheet === app.dataset.sheet)));
}));
$('#menuToggle').addEventListener('click', () => {
  const open = $('#app').classList.toggle('menu-open');
  $('#menuToggle').setAttribute('aria-expanded', String(open));
});
$('#menu').addEventListener('click', (e) => {
  if (e.target.closest('button')) { $('#app').classList.remove('menu-open'); $('#menuToggle').setAttribute('aria-expanded', 'false'); }
});

// ---------------------------------------------------------------- 鍵盤
const TOOL_KEYS = { b: 'pencil', e: 'eraser', g: 'fill', l: 'line', r: 'rect', o: 'ellipse', m: 'select', i: 'picker' };

function setSpace(on) {
  spaceDown = on;
  vpEl.classList.toggle('panning', on);
}

window.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open]')) return;
  const t = e.target;
  const typing = t instanceof HTMLElement && t.matches('input[type=text],input[type=number],select,textarea');
  if (typing) { if (e.key === 'Escape') t.blur(); return; }
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (e.key === ' ') { e.preventDefault(); setSpace(true); return; }
  if (mod) {
    switch (k) {
      case 'z': e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); return;
      case 'y': e.preventDefault(); doRedo(); return;
      case 's': e.preventDefault(); saveProject(); return;
      case 'o': e.preventDefault(); $('#fileOpen').click(); return;
      case 'e': e.preventDefault(); $('#btnExport').click(); return;
      case 'a': e.preventDefault(); selectAll(); return;
      case 'c': if (S.sel || S.float) { e.preventDefault(); copySelection(); } return;
      case 'x': if (S.sel || S.float) { e.preventDefault(); if (copySelection()) deleteSelection(); } return;
      case 'v': e.preventDefault(); pasteClipboard(); return;
      default: return;
    }
  }
  if (e.altKey) return;
  if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
  switch (e.key) {
    case 'h': case 'H': setMirrorH(!S.mirrorH); break;
    case 'v': case 'V': setMirrorV(!S.mirrorV); break;
    case 'x': case 'X': swapColors(); break;
    case '[': setSize(S.size - 1); break;
    case ']': setSize(S.size + 1); break;
    case '+': case '=': view.zoomCenter(1.5); break;
    case '-': case '_': view.zoomCenter(1 / 1.5); break;
    case '0': view.fit(); break;
    case '#': setGrid(!S.grid); break;
    case ',': case '<': act(() => ed.setActive({ frame: ed.frame - 1 })); break;
    case '.': case '>': act(() => ed.setActive({ frame: ed.frame + 1 })); break;
    case 'Enter': e.preventDefault(); togglePlay(); break;
    case 'Escape': commitFloat(); S.sel = null; requestOverlay(); break;
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelection(); break;
    case '?': $('#dlgHelp').showModal(); break;
    default:
  }
});
window.addEventListener('keyup', (e) => { if (e.key === ' ') setSpace(false); });
window.addEventListener('blur', () => setSpace(false));

// ---------------------------------------------------------------- 文件載入 / 同步 UI
function onDocLoaded() {
  if (S.play.on) stopPlay();
  S.sel = null; S.float = null; S.palIndex = -1;
  sizeCanvases();
  $('#docName').value = ed.doc.name;
  buildPalette();
  buildLayers();
  buildFrames();
  if (!S.recent.length) { S.recent = []; buildRecent(); }
  const first = ed.doc.palette[0];
  if (first && !onDocLoaded.initialized) setFg(S.fg);
  onDocLoaded.initialized = true;
  view.layout();
  view.fit();
  render();
  updateUndoButtons();
  scheduleSave();
}

ed.on((kind) => {
  switch (kind) {
    case 'doc': onDocLoaded(); return;
    case 'pixels': render(); scheduleSave(); break;
    case 'layers': buildLayers(); render(); scheduleSave(); break;
    case 'frames': buildFrames(); render(); scheduleSave(); break;
    case 'active': buildLayers(); markFrames(); render(); break;
    case 'history': buildLayers(); buildFrames(); render(); scheduleSave(); break;
    default:
  }
  if (kind === 'frames' || kind === 'history') updateFps();
  updateUndoButtons();
});

new ResizeObserver(() => { if (view.auto) view.fit(); else { view.clampPan(); view.layout(); } }).observe(vpEl);

// 初始化
setFg(S.fg);
setBg(S.bg);
setSize(1);
setTool('pencil');
setGrid(true);
onDocLoaded();
requestAnimationFrame(() => view.fit());

// 方便除錯與自動化測試
window.pixelForge = { ed, S, view };
