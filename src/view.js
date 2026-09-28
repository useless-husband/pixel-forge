// 畫布視角：縮放、平移、螢幕座標 ↔ 畫布像素座標。
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 96;
const BOTTOM_RESERVED = 34; // 狀態列高度

export class Viewport {
  constructor(el, stage, onChange) {
    this.el = el;
    this.stage = stage;
    this.onChange = onChange;
    this.zoom = 8;
    this.ox = 0;
    this.oy = 0;
    this.w = 16;
    this.h = 16;
    this.auto = true; // 尚未手動縮放/平移時，視窗大小改變會自動符合
  }

  setDocSize(w, h) { this.w = w; this.h = h; }

  get rect() { return this.el.getBoundingClientRect(); }

  layout() {
    const s = this.stage.style;
    s.left = `${Math.round(this.ox)}px`;
    s.top = `${Math.round(this.oy)}px`;
    s.width = `${this.w * this.zoom}px`;
    s.height = `${this.h * this.zoom}px`;
    this.onChange();
  }

  clampPan() {
    const r = this.rect;
    const pw = this.w * this.zoom, ph = this.h * this.zoom;
    const keep = 48;
    this.ox = Math.min(r.width - keep, Math.max(keep - pw, this.ox));
    this.oy = Math.min(r.height - BOTTOM_RESERVED - keep, Math.max(keep - ph, this.oy));
  }

  fit() {
    this.auto = true;
    const r = this.rect;
    const availW = Math.max(40, r.width - 24), availH = Math.max(40, r.height - BOTTOM_RESERVED - 24);
    let z = Math.min(availW / this.w, availH / this.h);
    z = z >= 2 ? Math.floor(z) : z;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    this.ox = (r.width - this.w * this.zoom) / 2;
    this.oy = (r.height - BOTTOM_RESERVED - this.h * this.zoom) / 2;
    this.layout();
  }

  /** 以螢幕座標 (cx, cy) 為中心縮放，讓該點下的畫布像素不動。 */
  zoomAt(cx, cy, factor, absolute = false) {
    const r = this.rect;
    this.auto = false;
    const px = cx - r.left, py = cy - r.top;
    const dx = (px - this.ox) / this.zoom, dy = (py - this.oy) / this.zoom;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, absolute ? factor : this.zoom * factor));
    this.zoom = next;
    this.ox = px - dx * next;
    this.oy = py - dy * next;
    this.clampPan();
    this.layout();
  }

  zoomCenter(factor) {
    const r = this.rect;
    this.zoomAt(r.left + r.width / 2, r.top + (r.height - BOTTOM_RESERVED) / 2, factor);
  }

  panBy(dx, dy) {
    this.auto = false;
    this.ox += dx; this.oy += dy;
    this.clampPan();
    this.layout();
  }

  /** 螢幕座標 → 畫布像素（整數）與小數座標。 */
  toDoc(clientX, clientY) {
    const r = this.rect;
    const fx = (clientX - r.left - this.ox) / this.zoom;
    const fy = (clientY - r.top - this.oy) / this.zoom;
    return { x: Math.floor(fx), y: Math.floor(fy), fx, fy };
  }

  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
}
