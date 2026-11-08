// Liquid pools: rectangular regions of liquid with buoyancy (Archimedes, by
// clipping each body against the free surface), liquid drag, and a dynamic
// free surface simulated with the 1D wave equation (shallow-water speed).

import { clipPolygon, polygonCentroid } from './math.js';
import { LIQUIDS } from './materials.js';
import { circlePolygon } from './shapes.js';
import { projectedWidth, autoDragCoef, fieldUid } from './forces.js';

export class Pool {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Pool';
    this.x0 = o.x0 ?? -2;
    this.x1 = o.x1 ?? 2;
    this.bottom = o.bottom ?? 0;
    this.level = o.level ?? 1.5;
    this.liquid = o.liquid || 'water';
    const L = LIQUIDS[this.liquid] || LIQUIDS.water;
    this.density = o.density ?? L.density;
    this.viscosity = o.viscosity ?? L.viscosity;
    this.color = o.color || L.color;
    this.waves = o.waves ?? true;
    this.waveDamping = o.waveDamping ?? 0.15;
    this.generator = Object.assign({ on: false, amplitude: 0.08, frequency: 0.8, side: 'left' }, o.generator || {});
    this.beach = o.beach || 'reflect'; // reflect | absorb
    this.current = o.current || 0; // horizontal flow speed m/s
    this.surfaceDamping = o.surfaceDamping ?? 1;
    this.resize();
  }

  resize() {
    const w = Math.max(0.1, this.x1 - this.x0);
    this.n = Math.max(8, Math.min(600, Math.round(w / 0.05)));
    this.dx = w / this.n;
    this.h = new Float64Array(this.n);
    this.v = new Float64Array(this.n);
  }

  get depth() {
    return this.level - this.bottom;
  }

  heightAt(x) {
    if (!this.waves) return 0;
    const f = (x - this.x0) / this.dx - 0.5;
    if (f <= 0) return this.h[0];
    if (f >= this.n - 1) return this.h[this.n - 1];
    const i = Math.floor(f);
    const t = f - i;
    return this.h[i] * (1 - t) + this.h[i + 1] * t;
  }

  surfaceAt(x) {
    return this.level + this.heightAt(x);
  }

  contains(x, y) {
    return x >= this.x0 && x <= this.x1 && y >= this.bottom && y <= this.surfaceAt(x);
  }
}

function bodyPolygons(b) {
  if (b.hull) return [b.worldHull()];
  const out = [];
  for (const sh of b.shapes) {
    if (sh.type === 'circle') out.push(circlePolygon(sh.wx, sh.wy, sh.r, 20));
    else {
      const pts = [];
      for (let i = 0; i < sh.count; i++) pts.push({ x: sh.wv[i * 2], y: sh.wv[i * 2 + 1] });
      out.push(pts);
    }
  }
  return out;
}

// Submerged part of a body in a pool: { area, cx, cy } (world).
export function submergedPart(pool, b) {
  if (b.aabb.maxX < pool.x0 || b.aabb.minX > pool.x1 || b.aabb.minY > pool.level + 2 || b.aabb.maxY < pool.bottom) return null;
  const xl = Math.max(pool.x0, b.aabb.minX);
  const xr = Math.min(pool.x1, b.aabb.maxX);
  const yl = pool.surfaceAt(xl);
  const yr = pool.surfaceAt(xr);
  let nx = -(yr - yl);
  let ny = xr - xl;
  const nl = Math.hypot(nx, ny);
  if (nl < 1e-9) {
    nx = 0;
    ny = 1;
  } else {
    nx /= nl;
    ny /= nl;
  }
  const d = nx * xl + ny * yl;
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const poly of bodyPolygons(b)) {
    let p = clipPolygon(poly, nx, ny, d);
    if (p.length < 3) continue;
    p = clipPolygon(p, 0, -1, -pool.bottom);
    if (p.length < 3) continue;
    p = clipPolygon(p, -1, 0, -pool.x0);
    if (p.length < 3) continue;
    p = clipPolygon(p, 1, 0, pool.x1);
    if (p.length < 3) continue;
    const c = polygonCentroid(p);
    const a = Math.abs(c.area);
    area += a;
    cx += a * c.x;
    cy += a * c.y;
  }
  if (area < 1e-9) return null;
  return { area, cx: cx / area, cy: cy / area };
}

export function applyBuoyancy(world, dt) {
  const st = world.settings;
  const g = st.gravity;
  const depth = st.depth;
  for (const b of world.bodies) b.submerged = 0;
  if (!world.pools.length) return;
  for (const b of world.bodies) {
    if (b.type !== 'dynamic' || !b.awake) continue;
    const refArea = b.hull ? Math.abs(polygonCentroid(b.hullLocal).area) : b.area;
    for (const pool of world.pools) {
      const sp = submergedPart(pool, b);
      if (!sp) continue;
      const frac = Math.min(1, sp.area / Math.max(refArea, 1e-9));
      b.submerged = Math.min(1, b.submerged + frac);
      // Archimedes: F = -rho * V * g
      const V = sp.area * depth;
      const fbx = -pool.density * V * g.x;
      const fby = -pool.density * V * g.y;
      b.fx += fbx;
      b.fy += fby;
      b.torque += (sp.cx - b.x) * fby - (sp.cy - b.y) * fbx;
      b.forces.buoyancy.x += fbx;
      b.forces.buoyancy.y += fby;
      // liquid drag at the submerged centroid
      const vcx = b.vx - b.w * (sp.cy - b.y) - pool.current;
      const vcy = b.vy + b.w * (sp.cx - b.x);
      const speed = Math.hypot(vcx, vcy);
      if (speed > 1e-6) {
        const dx = vcx / speed;
        const dy = vcy / speed;
        const width = projectedWidth(b, dx, dy) * Math.sqrt(frac);
        const cd = b.dragCoef ?? autoDragCoef(b);
        const fq = 0.5 * pool.density * cd * width * depth * speed * speed;
        const fl = 3 * Math.PI * pool.viscosity * width * speed * 10;
        let F = fq + fl;
        // wave-making (radiation) damping while the body pierces the surface
        if (frac < 0.98) {
          const wl = Math.min(b.aabb.maxX, pool.x1) - Math.max(b.aabb.minX, pool.x0);
          F += pool.density * Math.max(0, wl) * depth * 0.6 * speed * (pool.surfaceDamping ?? 1);
        }
        const maxF = (0.8 * b.mass * speed) / dt;
        if (F > maxF) F = maxF;
        const fx = -F * dx;
        const fy = -F * dy;
        b.fx += fx;
        b.fy += fy;
        b.torque += (sp.cx - b.x) * fy - (sp.cy - b.y) * fx;
        b.forces.drag.x += fx;
        b.forces.drag.y += fy;
      }
      if (b.w !== 0) {
        const R = b.radius;
        let k = (0.5 * pool.density * 0.2 * depth * R * R * R * R * Math.abs(b.w) + 20 * Math.PI * pool.viscosity * R * R * depth) * frac;
        if (frac < 0.98) k += pool.density * depth * R * R * R * 0.15 * (pool.surfaceDamping ?? 1);
        let tq = -k * b.w;
        const maxT = (0.8 * b.inertia * Math.abs(b.w)) / dt;
        if (Math.abs(tq) > maxT) tq = -Math.sign(b.w) * maxT;
        b.torque += tq;
      }
    }
  }
}

export function stepPools(world, dt) {
  const g = Math.hypot(world.settings.gravity.x, world.settings.gravity.y);
  const t = world.time + dt;
  for (const pool of world.pools) {
    if (pool.waves) {
      const depth = Math.max(0.05, pool.depth);
      const cRaw = Math.sqrt(Math.max(g, 0.5) * depth);
      const c = Math.min(cRaw, 6);
      const nSub = Math.max(1, Math.min(12, Math.ceil((c * dt) / (0.5 * pool.dx))));
      const hs = dt / nSub;
      const c2 = (c * c) / (pool.dx * pool.dx);
      const n = pool.n;
      const H = pool.h;
      const V = pool.v;
      const gen = pool.generator;
      const absorbStart = Math.floor(n * 0.82);
      for (let s = 0; s < nSub; s++) {
        const ts = t - dt + (s + 1) * hs;
        for (let i = 0; i < n; i++) {
          const l = i > 0 ? H[i - 1] : H[i];
          const r = i < n - 1 ? H[i + 1] : H[i];
          let damp = pool.waveDamping;
          if (pool.beach === 'absorb') {
            const far = gen.side === 'right' ? n - 1 - i : i;
            if (far >= absorbStart) {
              const k = (far - absorbStart) / (n - absorbStart);
              damp += 25 * k * k;
            }
          }
          V[i] += hs * (c2 * (l + r - 2 * H[i]) - damp * V[i] - 0.3 * H[i]);
        }
        for (let i = 0; i < n; i++) H[i] += hs * V[i];
        if (gen.on) {
          const w = 2 * Math.PI * gen.frequency;
          const idx = gen.side === 'right' ? n - 1 : 0;
          H[idx] = gen.amplitude * Math.sin(w * ts);
          V[idx] = gen.amplitude * w * Math.cos(w * ts);
        }
      }
      // clamp to avoid runaway
      const lim = Math.max(0.05, depth * 0.8);
      for (let i = 0; i < n; i++) {
        if (H[i] > lim) H[i] = lim;
        else if (H[i] < -lim) H[i] = -lim;
      }
    }
    // body coupling: bodies crossing the surface push columns & splash
    for (const b of world.bodies) {
      if (b.type === 'static') continue;
      if (b.aabb.maxX < pool.x0 || b.aabb.minX > pool.x1) continue;
      const surf = pool.surfaceAt(Math.min(pool.x1, Math.max(pool.x0, b.x)));
      const crossing = b.aabb.minY < surf && b.aabb.maxY > surf - 0.05;
      const wasAbove = b._abovePool?.[pool.id];
      if (!b._abovePool) b._abovePool = {};
      b._abovePool[pool.id] = b.aabb.minY > surf;
      if (!crossing) continue;
      if (pool.generator.on && b.type === 'dynamic') {
        b.sleepTime = 0;
        if (!b.awake) b.wake();
      }
      if (pool.waves) {
        const i0 = Math.max(0, Math.floor((b.aabb.minX - pool.x0) / pool.dx));
        const i1 = Math.min(pool.n - 1, Math.floor((b.aabb.maxX - pool.x0) / pool.dx));
        const vy = b.vy;
        for (let i = i0; i <= i1; i++) {
          pool.v[i] += (vy * 0.6 - pool.v[i]) * 0.12;
        }
        // horizontal motion: push water up in front, down behind
        if (Math.abs(b.vx) > 0.05) {
          const front = b.vx > 0 ? Math.min(pool.n - 1, i1 + 1) : Math.max(0, i0 - 1);
          const back = b.vx > 0 ? Math.max(0, i0 - 1) : Math.min(pool.n - 1, i1 + 1);
          pool.v[front] += Math.abs(b.vx) * 0.25;
          pool.v[back] -= Math.abs(b.vx) * 0.25;
        }
      }
      if (wasAbove && b.vy < -1.5 && world.splashes.length < 600) {
        const count = Math.min(30, Math.floor(Math.abs(b.vy) * 3 * Math.min(1, b.radius * 3)));
        for (let k = 0; k < count; k++) {
          const sx = b.x + (Math.random() - 0.5) * b.radius * 2;
          const ang = Math.PI / 2 + (Math.random() - 0.5) * 1.6;
          const sp = Math.abs(b.vy) * (0.25 + Math.random() * 0.45);
          world.splashes.push({ x: sx, y: surf, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1.5, color: pool.color, pool: pool.id });
        }
      }
    }
  }
  // splash droplets (visual only)
  if (world.splashes.length) {
    const gx = world.settings.gravity.x;
    const gy = world.settings.gravity.y;
    const keep = [];
    for (const s of world.splashes) {
      s.vx += gx * dt;
      s.vy += gy * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      const pool = world.pools.find((p) => p.id === s.pool);
      if (s.life <= 0) continue;
      if (pool && s.vy < 0 && s.x > pool.x0 && s.x < pool.x1 && s.y < pool.surfaceAt(s.x)) continue;
      if (s.y < world.settings.room.bottom - 1) continue;
      keep.push(s);
    }
    world.splashes = keep;
  }
}
