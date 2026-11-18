// Plan viewer: shows a drawing with smooth pinch-zoom and pan, and draws
// pins on top. Pin positions are stored as fractions of the drawing's width
// and height (0–1), so they stay in the right place at any zoom level.

export class PlanViewer {
  constructor(container, { onTap, onPinTap, onPinDrag } = {}) {
    this.el = container;
    this.onTap = onTap || (() => {});
    this.onPinTap = onPinTap || (() => {});
    this.onPinDrag = onPinDrag || null;
    this.s = 1;
    this.tx = 0;
    this.ty = 0;
    this.w = 1;
    this.h = 1;
    this.pointers = new Map();
    this.gesture = null;
    this.raf = 0;
    this.dragPinId = null;

    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.img = document.createElement('img');
    this.img.className = 'plan-img';
    this.img.draggable = false;
    this.img.alt = 'Floor plan';
    this.pinLayer = document.createElement('div');
    this.pinLayer.className = 'pin-layer';
    this.stage.append(this.img, this.pinLayer);
    this.el.append(this.stage);

    this._down = this._down.bind(this);
    this._move = this._move.bind(this);
    this._up = this._up.bind(this);
    this._wheel = this._wheel.bind(this);
    this._resize = () => this.fit();
    this.el.addEventListener('pointerdown', this._down);
    this.el.addEventListener('pointermove', this._move);
    this.el.addEventListener('pointerup', this._up);
    this.el.addEventListener('pointercancel', this._up);
    this.el.addEventListener('wheel', this._wheel, { passive: false });
    window.addEventListener('resize', this._resize);
    // Stop iOS Safari's own page zoom from fighting ours
    this._gs = (e) => e.preventDefault();
    this.el.addEventListener('gesturestart', this._gs);
  }

  destroy() {
    window.removeEventListener('resize', this._resize);
    if (this.url) URL.revokeObjectURL(this.url);
    this.el.innerHTML = '';
  }

  async load(blob, width, height) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(blob);
    this.w = width;
    this.h = height;
    this.stage.style.width = width + 'px';
    this.stage.style.height = height + 'px';
    this.img.src = this.url;
    try {
      await this.img.decode();
    } catch {
      /* still shows once loaded */
    }
    this.fit();
  }

  get minScale() {
    return this.fitScale * 0.8;
  }
  get maxScale() {
    return Math.max(this.fitScale * 12, 2);
  }

  fit() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.fitScale = Math.min(r.width / this.w, r.height / this.h) * 0.96;
    this.s = this.fitScale;
    this.tx = (r.width - this.w * this.s) / 2;
    this.ty = (r.height - this.h * this.s) / 2;
    this._apply();
  }

  // Centre on a pin and zoom in
  focus(x, y, zoom = 4) {
    const r = this.el.getBoundingClientRect();
    this.s = Math.min(this.maxScale, this.fitScale * zoom);
    this.tx = r.width / 2 - x * this.w * this.s;
    this.ty = r.height / 2 - y * this.h * this.s;
    this._apply();
  }

  setPins(pins, selectedId) {
    // pins: [{ id, x, y, label, color, title }]
    const frag = document.createDocumentFragment();
    for (const p of pins) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin' + (p.id === selectedId ? ' is-selected' : '');
      b.dataset.id = p.id;
      b.style.left = p.x * 100 + '%';
      b.style.top = p.y * 100 + '%';
      b.style.setProperty('--pin', p.color);
      b.setAttribute('aria-label', p.title || 'Pin ' + p.label);
      b.innerHTML = `<span class="pin-head">${escapeHtml(String(p.label))}</span>`;
      frag.append(b);
    }
    this.pinLayer.replaceChildren(frag);
  }

  _apply() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.stage.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.s})`;
      this.stage.style.setProperty('--inv', String(1 / this.s));
    });
  }

  _local(e) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _toPlan(pt) {
    return { x: (pt.x - this.tx) / (this.s * this.w), y: (pt.y - this.ty) / (this.s * this.h) };
  }

  _zoomAt(pt, newScale) {
    const s = Math.max(this.minScale, Math.min(this.maxScale, newScale));
    const k = s / this.s;
    this.tx = pt.x - (pt.x - this.tx) * k;
    this.ty = pt.y - (pt.y - this.ty) * k;
    this.s = s;
    this._apply();
  }

  _down(e) {
    this.el.setPointerCapture?.(e.pointerId);
    const pt = this._local(e);
    this.pointers.set(e.pointerId, pt);
    if (this.pointers.size === 1) {
      const pinEl = e.target.closest?.('.pin');
      this.gesture = {
        start: pt,
        last: pt,
        t: performance.now(),
        moved: false,
        multi: false,
        pinId: pinEl?.dataset.id || null,
        dragging: false,
      };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.gesture = {
        ...this.gesture,
        multi: true,
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        s0: this.s,
      };
    }
  }

  _move(e) {
    if (!this.pointers.has(e.pointerId) || !this.gesture) return;
    const pt = this._local(e);
    this.pointers.set(e.pointerId, pt);
    const g = this.gesture;
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // pan with the midpoint, zoom with the spread
      this.tx += mid.x - g.mid.x;
      this.ty += mid.y - g.mid.y;
      g.mid = mid;
      this._zoomAt(mid, g.s0 * (dist / g.dist));
      g.moved = true;
      return;
    }
    if (g.multi) return; // finishing a pinch with one finger left
    const dx = pt.x - g.start.x;
    const dy = pt.y - g.start.y;
    if (!g.moved && Math.hypot(dx, dy) > 8) g.moved = true;
    if (!g.moved) return;
    // Dragging a selected pin (move mode) instead of panning
    if (g.pinId && this.onPinDrag && this.dragPinId === g.pinId) {
      g.dragging = true;
      const p = this._toPlan(pt);
      const el = this.pinLayer.querySelector(`[data-id="${g.pinId}"]`);
      if (el) {
        el.style.left = clamp01(p.x) * 100 + '%';
        el.style.top = clamp01(p.y) * 100 + '%';
      }
      return;
    }
    this.tx += pt.x - g.last.x;
    this.ty += pt.y - g.last.y;
    g.last = pt;
    this._apply();
  }

  _up(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const pt = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (this.pointers.size > 0 || !g) return;
    this.gesture = null;
    if (g.dragging) {
      const p = this._toPlan(pt);
      this.onPinDrag(g.pinId, clamp01(p.x), clamp01(p.y));
      return;
    }
    if (g.multi || g.moved) return;
    const quick = performance.now() - g.t < 500;
    if (!quick) return;
    // double tap on empty plan = zoom in
    const nowT = performance.now();
    if (!g.pinId && this.lastTap && nowT - this.lastTap.t < 300 && Math.hypot(pt.x - this.lastTap.x, pt.y - this.lastTap.y) < 30) {
      clearTimeout(this.tapTimer);
      this.lastTap = null;
      this._zoomAt(pt, this.s * 2.2);
      return;
    }
    if (g.pinId) {
      this.onPinTap(g.pinId);
      return;
    }
    const p = this._toPlan(pt);
    this.lastTap = { t: nowT, x: pt.x, y: pt.y };
    // wait briefly to see if this is a double tap
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this.lastTap = null;
      if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) this.onTap(p.x, p.y);
    }, 260);
  }

  _wheel(e) {
    e.preventDefault();
    const pt = this._local(e);
    this._zoomAt(pt, this.s * Math.exp(-e.deltaY * 0.0015));
  }

  zoomBy(k) {
    const r = this.el.getBoundingClientRect();
    this._zoomAt({ x: r.width / 2, y: r.height / 2 }, this.s * k);
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
