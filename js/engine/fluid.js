// Particle-based liquid (double-density relaxation, after Clavet et al.
// 2005) with two-way coupling to rigid bodies. Particles can be poured,
// fill containers, push floating objects and drain away.

import { LIQUIDS, LIQUID_KEYS } from './materials.js';
import { pointShapeDistance } from './collision.js';

const TABLE = 1 << 14;

export class ParticleFluid {
  constructor(world) {
    this.world = world;
    this.capacity = 0;
    this.count = 0;
    this.grow(1024);
    this.pairCap = 0;
    this.growPairs(16384);
    this.cellCount = new Int32Array(TABLE + 1);
    this.cellStart = new Int32Array(TABLE + 1);
    this.maxParticles = 3500;
    this.substeps = 2;
    this.coupling = 0.75;
  }

  grow(n) {
    const keys = ['x', 'y', 'vx', 'vy', 'px', 'py', 'rho', 'rhoN', 'p', 'pN'];
    for (const k of keys) {
      const a = new Float64Array(n);
      if (this[k]) a.set(this[k].subarray(0, this.count));
      this[k] = a;
    }
    const t = new Uint8Array(n);
    if (this.type) t.set(this.type.subarray(0, this.count));
    this.type = t;
    const s = new Int32Array(n);
    this.sorted = s;
    this.capacity = n;
  }

  growPairs(n) {
    this.pi = new Int32Array(n);
    this.pj = new Int32Array(n);
    this.pairCap = n;
  }

  get radius() {
    return this.world.settings.fluid.radius;
  }

  get H() {
    return this.radius * 2.4;
  }

  add(x, y, vx = 0, vy = 0, liquid = 'water') {
    if (this.count >= this.maxParticles) return -1;
    if (this.count >= this.capacity) this.grow(this.capacity * 2);
    const i = this.count++;
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.px[i] = x;
    this.py[i] = y;
    const ti = LIQUID_KEYS.indexOf(liquid);
    this.type[i] = ti < 0 ? 0 : ti;
    return i;
  }

  // Fill a rectangle with particles on a lattice.
  fillRect(x0, y0, x1, y1, liquid = 'water') {
    const sp = this.radius * 1.15;
    let n = 0;
    for (let y = Math.min(y0, y1) + sp / 2; y < Math.max(y0, y1); y += sp) {
      for (let x = Math.min(x0, x1) + sp / 2; x < Math.max(x0, x1); x += sp) {
        if (this.add(x + (Math.random() - 0.5) * 0.01, y, 0, 0, liquid) < 0) return n;
        n++;
      }
    }
    return n;
  }

  remove(i) {
    const last = --this.count;
    if (i !== last) {
      this.x[i] = this.x[last];
      this.y[i] = this.y[last];
      this.vx[i] = this.vx[last];
      this.vy[i] = this.vy[last];
      this.px[i] = this.px[last];
      this.py[i] = this.py[last];
      this.type[i] = this.type[last];
    }
  }

  clear() {
    this.count = 0;
  }

  removeInCircle(cx, cy, r) {
    let removed = 0;
    for (let i = this.count - 1; i >= 0; i--) {
      if ((this.x[i] - cx) ** 2 + (this.y[i] - cy) ** 2 < r * r) {
        this.remove(i);
        removed++;
      }
    }
    return removed;
  }

  particleMass(i) {
    const L = LIQUIDS[LIQUID_KEYS[this.type[i]]] || LIQUIDS.water;
    const sp = this.radius * 1.15;
    return L.density * sp * sp * this.world.settings.depth;
  }

  hash(ix, iy) {
    return (Math.imul(ix, 92837111) ^ Math.imul(iy, 689287499)) & (TABLE - 1);
  }

  buildGrid() {
    const n = this.count;
    const H = this.H;
    const inv = 1 / H;
    const cc = this.cellCount;
    cc.fill(0);
    const cells = this._cells && this._cells.length >= n ? this._cells : (this._cells = new Int32Array(Math.max(n, 1024) * 2));
    for (let i = 0; i < n; i++) {
      const h = this.hash(Math.floor(this.x[i] * inv), Math.floor(this.y[i] * inv));
      cells[i] = h;
      cc[h]++;
    }
    const cs = this.cellStart;
    let acc = 0;
    for (let k = 0; k < TABLE; k++) {
      cs[k] = acc;
      acc += cc[k];
    }
    cs[TABLE] = acc;
    const fillPos = this._fill && this._fill.length >= TABLE ? this._fill : (this._fill = new Int32Array(TABLE));
    fillPos.set(cs.subarray(0, TABLE));
    for (let i = 0; i < n; i++) this.sorted[fillPos[cells[i]]++] = i;
  }

  findPairs() {
    const n = this.count;
    const H = this.H;
    const H2 = H * H;
    const inv = 1 / H;
    let np = 0;
    const seen = this._seen && this._seen.length >= 9 ? this._seen : (this._seen = new Int32Array(9));
    for (let i = 0; i < n; i++) {
      const xi = this.x[i];
      const yi = this.y[i];
      const cx = Math.floor(xi * inv);
      const cy = Math.floor(yi * inv);
      let ns = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const h = this.hash(cx + dx, cy + dy);
          // avoid visiting the same hash bucket twice
          let dup = false;
          for (let s = 0; s < ns; s++) if (seen[s] === h) { dup = true; break; }
          if (dup) continue;
          seen[ns++] = h;
          const end = this.cellStart[h + 1];
          for (let k = this.cellStart[h]; k < end; k++) {
            const j = this.sorted[k];
            if (j <= i) continue;
            const ddx = this.x[j] - xi;
            const ddy = this.y[j] - yi;
            if (ddx * ddx + ddy * ddy < H2) {
              if (np >= this.pairCap) {
                const oi = this.pi;
                const oj = this.pj;
                this.growPairs(this.pairCap * 2);
                this.pi.set(oi);
                this.pj.set(oj);
              }
              this.pi[np] = i;
              this.pj[np] = j;
              np++;
            }
          }
        }
      }
    }
    this.pairs = np;
  }

  step(dt) {
    if (this.count === 0) return;
    const sub = this.substeps;
    const h = dt / sub;
    for (let s = 0; s < sub; s++) this.substep(h);
  }

  substep(h) {
    const world = this.world;
    const st = world.settings;
    const g = st.gravity;
    const n = this.count;
    const H = this.H;
    const fp = st.fluid;
    // tuned constants (SI units, H ~ 0.2 m)
    const rho0 = fp.rho0 ?? 1.6;
    const k = (fp.k ?? 1500) * (fp.stiffness ?? 1);
    const kNear = (fp.kNear ?? 4000) * (fp.stiffness ?? 1);
    const viscScale = fp.viscosity ?? 1;

    const { x, y, vx, vy, px, py } = this;
    for (let i = 0; i < n; i++) {
      vx[i] += g.x * h;
      vy[i] += g.y * h;
    }
    // attractors pull fluid too
    for (const a of world.attractors) {
      for (let i = 0; i < n; i++) {
        const dx = a.x - x[i];
        const dy = a.y - y[i];
        const r2 = dx * dx + dy * dy + a.radius * a.radius;
        if (a.range > 0 && r2 > a.range * a.range) continue;
        const r = Math.sqrt(r2);
        const acc = a.strength / r2;
        vx[i] += (acc * dx / r) * h;
        vy[i] += (acc * dy / r) * h;
      }
    }

    this.buildGrid();
    this.findPairs();
    const np = this.pairs;
    const PI = this.pi;
    const PJ = this.pj;
    const type = this.type;

    // viscosity impulses
    for (let p = 0; p < np; p++) {
      const i = PI[p];
      const j = PJ[p];
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r < 1e-9) continue;
      const nx = dx / r;
      const ny = dy / r;
      const u = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
      if (u <= 0) continue;
      const q = 1 - r / H;
      const Li = LIQUIDS[LIQUID_KEYS[type[i]]];
      const Lj = LIQUIDS[LIQUID_KEYS[type[j]]];
      const sigma = ((Li.particleVisc + Lj.particleVisc) * 0.5) * 6 * viscScale;
      const beta = 0.3;
      let I = h * q * (sigma * u + beta * u * u);
      if (I > u * 0.5) I = u * 0.5;
      vx[i] -= I * nx * 0.5;
      vy[i] -= I * ny * 0.5;
      vx[j] += I * nx * 0.5;
      vy[j] += I * ny * 0.5;
    }

    // predict
    for (let i = 0; i < n; i++) {
      px[i] = x[i];
      py[i] = y[i];
      x[i] += vx[i] * h;
      y[i] += vy[i] * h;
    }

    // double density relaxation (Jacobi, symmetric)
    const rho = this.rho;
    const rhoN = this.rhoN;
    rho.fill(0, 0, n);
    rhoN.fill(0, 0, n);
    for (let p = 0; p < np; p++) {
      const i = PI[p];
      const j = PJ[p];
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= H) continue;
      const q = 1 - r / H;
      const q2 = q * q;
      const q3 = q2 * q;
      rho[i] += q2;
      rho[j] += q2;
      rhoN[i] += q3;
      rhoN[j] += q3;
    }
    const P = this.p;
    const PN = this.pN;
    for (let i = 0; i < n; i++) {
      P[i] = k * (rho[i] - rho0);
      PN[i] = kNear * rhoN[i];
    }
    const h2 = h * h;
    for (let p = 0; p < np; p++) {
      const i = PI[p];
      const j = PJ[p];
      const dx = x[j] - x[i];
      const dy = y[j] - y[i];
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= H || r < 1e-9) continue;
      const q = 1 - r / H;
      let D = h2 * (0.5 * (P[i] + P[j]) * q + 0.5 * (PN[i] + PN[j]) * q * q);
      const maxD = H * 0.25;
      if (D > maxD) D = maxD;
      else if (D < -maxD) D = -maxD;
      const ux = (dx / r) * D * 0.5;
      const uy = (dy / r) * D * 0.5;
      x[i] -= ux;
      y[i] -= uy;
      x[j] += ux;
      y[j] += uy;
    }

    // velocities from positions
    const invH = 1 / h;
    for (let i = 0; i < n; i++) {
      vx[i] = (x[i] - px[i]) * invH;
      vy[i] = (y[i] - py[i]) * invH;
    }

    this.collideBodies(h);

    // drains and bounds
    const room = st.room;
    for (let i = this.count - 1; i >= 0; i--) {
      if (y[i] < room.bottom - 5 || x[i] < room.left - 30 || x[i] > room.right + 30 || y[i] > room.top + 80 || !isFinite(x[i] + y[i])) {
        this.remove(i);
        continue;
      }
      for (const d of world.drains) {
        if (x[i] > d.x - d.w / 2 && x[i] < d.x + d.w / 2 && y[i] > d.y - d.h / 2 && y[i] < d.y + d.h / 2) {
          this.remove(i);
          d.count = (d.count || 0) + 1;
          break;
        }
      }
    }
  }

  collideBodies(h) {
    const world = this.world;
    const n = this.count;
    const { x, y, vx, vy } = this;
    const pr = this.radius * 0.55; // collision radius
    // fluid bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (x[i] < minX) minX = x[i];
      if (x[i] > maxX) maxX = x[i];
      if (y[i] < minY) minY = y[i];
      if (y[i] > maxY) maxY = y[i];
    }
    const cands = [];
    for (const b of world.bodies) {
      if (!b.shapes.length || !b.collide) continue;
      const bb = b.aabb;
      if (bb.maxX + pr < minX || bb.minX - pr > maxX || bb.maxY + pr < minY || bb.minY - pr > maxY) continue;
      cands.push(b);
    }
    if (!cands.length) return;
    for (let i = 0; i < n; i++) {
      const xi = x[i];
      const yi = y[i];
      for (const b of cands) {
        const bb = b.aabb;
        if (xi < bb.minX - pr || xi > bb.maxX + pr || yi < bb.minY - pr || yi > bb.maxY + pr) continue;
        for (const sh of b.shapes) {
          const sa = sh.aabb;
          if (x[i] < sa.minX - pr || x[i] > sa.maxX + pr || y[i] < sa.minY - pr || y[i] > sa.maxY + pr) continue;
          const d = pointShapeDistance(sh, x[i], y[i]);
          if (d.d >= pr) continue;
          const pen = pr - d.d;
          const nx = d.nx;
          const ny = d.ny;
          x[i] += nx * pen;
          y[i] += ny * pen;
          // body surface velocity at contact
          let bvx = 0;
          let bvy = 0;
          if (b.type !== 'static') {
            bvx = b.vx - b.w * (y[i] - b.y);
            bvy = b.vy + b.w * (x[i] - b.x);
          }
          if (b.surfaceSpeed) {
            // conveyor: tangent along clockwise surface direction
            bvx += b.surfaceSpeed * ny;
            bvy += b.surfaceSpeed * -nx;
          }
          const rvx = vx[i] - bvx;
          const rvy = vy[i] - bvy;
          const vn = rvx * nx + rvy * ny;
          let dvx = 0;
          let dvy = 0;
          if (vn < 0) {
            dvx -= vn * nx;
            dvy -= vn * ny;
          }
          // friction (slip)
          const tvx = rvx - vn * nx;
          const tvy = rvy - vn * ny;
          dvx -= tvx * 0.04;
          dvy -= tvy * 0.04;
          vx[i] += dvx + ((nx * pen) / h) * 0.2;
          vy[i] += dvy + ((ny * pen) / h) * 0.2;
          if (b.type === 'dynamic') {
            const m = this.particleMass(i) * this.coupling;
            let jx = -m * dvx;
            let jy = -m * dvy;
            const jl = Math.hypot(jx, jy);
            const maxJ = b.mass * 0.5;
            if (jl > maxJ) {
              jx *= maxJ / jl;
              jy *= maxJ / jl;
            }
            if (!b.awake && jl > b.mass * 0.002) b.wake();
            if (b.awake) b.applyImpulse(jx, jy, x[i], y[i]);
          }
        }
      }
    }
  }

  // Serialise (positions + types) compactly.
  toJSON() {
    const out = [];
    for (let i = 0; i < this.count; i++) {
      out.push(+this.x[i].toFixed(3), +this.y[i].toFixed(3), +this.vx[i].toFixed(2), +this.vy[i].toFixed(2), this.type[i]);
    }
    return out;
  }

  fromJSON(arr) {
    this.clear();
    if (!arr) return;
    for (let k = 0; k + 4 < arr.length; k += 5) {
      const i = this.add(arr[k], arr[k + 1], arr[k + 2], arr[k + 3], LIQUID_KEYS[arr[k + 4]] || 'water');
      if (i < 0) break;
    }
  }
}
