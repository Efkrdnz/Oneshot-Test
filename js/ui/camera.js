// 2D camera: world metres (y up) <-> screen CSS pixels (y down).

export class Camera {
  constructor() {
    this.cx = 0;
    this.cy = 6;
    this.scale = 40; // pixels per metre
    this.w = 800;
    this.h = 600;
    this.minScale = 4;
    this.maxScale = 2000;
    this.target = null; // smooth transition target
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
  }

  toScreen(x, y) {
    return { x: (x - this.cx) * this.scale + this.w / 2, y: this.h / 2 - (y - this.cy) * this.scale };
  }

  sx(x) {
    return (x - this.cx) * this.scale + this.w / 2;
  }

  sy(y) {
    return this.h / 2 - (y - this.cy) * this.scale;
  }

  toWorld(sx, sy) {
    return { x: (sx - this.w / 2) / this.scale + this.cx, y: (this.h / 2 - sy) / this.scale + this.cy };
  }

  zoomAt(sx, sy, factor) {
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.target = null;
  }

  pan(dxPx, dyPx) {
    this.cx -= dxPx / this.scale;
    this.cy += dyPx / this.scale;
    this.target = null;
  }

  // Fit a world rectangle into the view (with padding in px).
  fit(minX, minY, maxX, maxY, pad = 40, animate = false) {
    const w = Math.max(0.5, maxX - minX);
    const h = Math.max(0.5, maxY - minY);
    const s = Math.min((this.w - pad * 2) / w, (this.h - pad * 2) / h);
    const t = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Math.max(this.minScale, Math.min(this.maxScale, s)) };
    if (animate) this.target = t;
    else {
      Object.assign(this, t);
      this.target = null;
    }
  }

  update(dt) {
    if (!this.target) return;
    const k = 1 - Math.pow(0.0001, dt);
    this.cx += (this.target.cx - this.cx) * k;
    this.cy += (this.target.cy - this.cy) * k;
    this.scale += (this.target.scale - this.scale) * k;
    if (Math.abs(this.target.scale - this.scale) < 0.01 && Math.abs(this.target.cx - this.cx) < 1e-3) this.target = null;
  }

  viewRect() {
    const a = this.toWorld(0, this.h);
    const b = this.toWorld(this.w, 0);
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }
}
