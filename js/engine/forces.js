// External force fields: air resistance (quadratic + viscous), wind and fan
// zones, point attractors, mutual gravity, electrostatics and the weight of
// liquid carried inside hollow bodies.

import { clipPolygon, polygonCentroid } from './math.js';
import { applyBuoyancy } from './pools.js';

let FIELD_UID = 1;
export function fieldUid(n) {
  if (n !== undefined) {
    if (n >= FIELD_UID) FIELD_UID = n + 1;
    return n;
  }
  return FIELD_UID++;
}

export class Attractor {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.x = o.x || 0;
    this.y = o.y || 0;
    this.strength = o.strength ?? 60; // gravitational parameter mu = G*M (m^3/s^2)
    this.radius = o.radius ?? 0.4; // softening / visual radius
    this.range = o.range ?? 0; // 0 = unlimited
    this.name = o.name || 'Attractor';
  }
}

export class Fan {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.x = o.x || 0;
    this.y = o.y || 0;
    this.w = o.w ?? 4; // length along blowing direction
    this.h = o.h ?? 2; // width
    this.angle = o.angle ?? 0; // radians, blowing direction
    this.speed = o.speed ?? 8; // air speed m/s
    this.falloff = o.falloff ?? true;
    this.on = o.on ?? true;
    this.name = o.name || 'Fan';
  }

  // wind velocity at point (0 outside)
  windAt(px, py) {
    if (!this.on) return null;
    const c = Math.cos(this.angle);
    const s = Math.sin(this.angle);
    const dx = px - this.x;
    const dy = py - this.y;
    const lx = c * dx + s * dy;
    const ly = -s * dx + c * dy;
    if (lx < 0 || lx > this.w || Math.abs(ly) > this.h / 2) return null;
    const k = this.falloff ? 1 - 0.6 * (lx / this.w) : 1;
    return { x: c * this.speed * k, y: s * this.speed * k };
  }
}

export function windAt(world, px, py) {
  let wx = world.settings.wind.x;
  let wy = world.settings.wind.y;
  for (const f of world.fans) {
    const w = f.windAt(px, py);
    if (w) {
      wx += w.x;
      wy += w.y;
    }
  }
  return { x: wx, y: wy };
}

// Projected width of a body's hull perpendicular to direction (dx, dy).
export function projectedWidth(body, dx, dy) {
  const px = -dy;
  const py = dx;
  let min = Infinity;
  let max = -Infinity;
  const c = body.c;
  const s = body.s;
  for (const p of body.hullLocal) {
    const wx = c * p.x - s * p.y;
    const wy = s * p.x + c * p.y;
    const d = wx * px + wy * py;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return max > min ? max - min : 0;
}

export function autoDragCoef(body) {
  const k = body.geom.kind;
  if (k === 'circle') return 0.47;
  if (k === 'capsule') return 0.6;
  if (k === 'ngon') return body.geom.n >= 6 ? 0.6 : 0.9;
  if (k === 'wedge') return 0.8;
  return 1.05;
}

export function computeForces(world, dt) {
  const st = world.settings;
  const g = st.gravity;
  const rho = st.drag ? st.airDensity : 0;
  const mu = st.drag ? st.airViscosity : 0;
  const depth = st.depth;
  const bodies = world.bodies;
  for (const b of bodies) {
    b.fx = 0;
    b.fy = 0;
    b.torque = 0;
    const f = b.forces;
    f.drag.x = f.drag.y = 0;
    f.buoyancy.x = f.buoyancy.y = 0;
    f.other.x = f.other.y = 0;
    if (b.type !== 'dynamic') {
      f.gravity.x = f.gravity.y = 0;
      continue;
    }
    f.gravity.x = b.mass * g.x * b.gravityScale;
    f.gravity.y = b.mass * g.y * b.gravityScale;
  }

  // buoyancy & liquid drag first (gives submerged fraction)
  applyBuoyancy(world, dt);

  for (const b of bodies) {
    if (b.type !== 'dynamic' || !b.awake) continue;
    // air resistance
    if (rho > 0 || mu > 0) {
      const w = windAt(world, b.x, b.y);
      const rvx = b.vx - w.x;
      const rvy = b.vy - w.y;
      const speed = Math.hypot(rvx, rvy);
      const airFrac = 1 - b.submerged;
      if (speed > 1e-6 && airFrac > 0) {
        const dx = rvx / speed;
        const dy = rvy / speed;
        const width = projectedWidth(b, dx, dy);
        const cd = b.dragCoef ?? autoDragCoef(b);
        const area = width * depth;
        const fq = 0.5 * rho * cd * area * speed * speed;
        const fl = 3 * Math.PI * mu * width * speed;
        let F = (fq + fl) * airFrac;
        // never reverse the velocity within one step (stability for light bodies)
        const maxF = b.mass * speed / dt;
        if (F > maxF) F = maxF;
        b.fx -= F * dx;
        b.fy -= F * dy;
        b.forces.drag.x -= F * dx;
        b.forces.drag.y -= F * dy;
      }
      if (b.w !== 0 && airFrac > 0) {
        const R = b.radius;
        const k = (0.5 * rho * 0.05 * depth * R * R * R * R * Math.abs(b.w) + 2 * Math.PI * mu * R * R * depth) * airFrac;
        let tq = -k * b.w;
        const maxT = b.inertia * Math.abs(b.w) / dt;
        if (Math.abs(tq) > maxT) tq = -Math.sign(b.w) * maxT;
        b.torque += tq;
      }
    }
    // attractors
    for (const a of world.attractors) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const r2 = dx * dx + dy * dy;
      if (a.range > 0 && r2 > a.range * a.range) continue;
      const soft = a.radius * a.radius;
      const r = Math.sqrt(r2) || 1e-9;
      const F = (b.mass * a.strength) / (r2 + soft);
      b.fx += (F * dx) / r;
      b.fy += (F * dy) / r;
      b.forces.other.x += (F * dx) / r;
      b.forces.other.y += (F * dy) / r;
    }
  }

  // mutual gravity / electrostatics (O(n^2) over dynamic bodies)
  if (st.mutualGravity || st.coulomb) {
    const dyn = bodies.filter((b) => b.type === 'dynamic');
    for (let i = 0; i < dyn.length; i++) {
      const A = dyn[i];
      for (let j = i + 1; j < dyn.length; j++) {
        const B = dyn[j];
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const minR = Math.max(0.05, (A.radius + B.radius) * 0.5);
        const r2 = Math.max(dx * dx + dy * dy, minR * minR);
        const r = Math.sqrt(r2);
        let F = 0;
        if (st.mutualGravity) F += (st.G * A.mass * B.mass) / r2;
        if (st.coulomb && A.charge && B.charge) F -= (st.K * A.charge * B.charge) / r2;
        if (F === 0) continue;
        const fx = (F * dx) / r;
        const fy = (F * dy) / r;
        A.fx += fx;
        A.fy += fy;
        B.fx -= fx;
        B.fy -= fy;
        A.forces.other.x += fx;
        A.forces.other.y += fy;
        B.forces.other.x -= fx;
        B.forces.other.y -= fy;
        A.wake();
        B.wake();
      }
    }
  }

  // inner liquid: its weight acts at the liquid centroid, not the body COM
  for (const b of bodies) {
    if (b.type !== 'dynamic' || !b.awake || !b.innerLiquid || !b.liquidMass) continue;
    const st2 = innerLiquidState(b, g);
    if (!st2) continue;
    const wx = b.liquidMass * g.x * b.gravityScale;
    const wy = b.liquidMass * g.y * b.gravityScale;
    b.torque += (st2.cx - b.x) * wy - (st2.cy - b.y) * wx;
  }
}

// Polygon of liquid inside a hollow body (world coordinates) with its
// free surface perpendicular to gravity.
export function innerLiquidState(body, g) {
  if (!body.innerLiquid || !body.interiorLocal) return null;
  const frac = Math.max(0, Math.min(1, body.innerLiquid.fraction));
  if (frac <= 0) return null;
  const poly = body.interiorLocal.map((p) => body.localToWorld(p.x, p.y));
  const gl = Math.hypot(g.x, g.y);
  let ux;
  let uy;
  if (gl > 1e-6) {
    ux = -g.x / gl;
    uy = -g.y / gl;
  } else {
    ux = -body.s;
    uy = body.c;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of poly) {
    const d = p.x * ux + p.y * uy;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  const total = Math.abs(polygonCentroid(poly).area);
  const target = total * frac;
  let level = hi;
  if (frac < 0.999) {
    let a = lo;
    let bnd = hi;
    for (let i = 0; i < 24; i++) {
      const mid = (a + bnd) / 2;
      const clipped = clipPolygon(poly, ux, uy, mid);
      const ar = clipped.length >= 3 ? Math.abs(polygonCentroid(clipped).area) : 0;
      if (ar < target) a = mid;
      else bnd = mid;
    }
    level = (a + bnd) / 2;
  }
  const clipped = clipPolygon(poly, ux, uy, level);
  if (clipped.length < 3) return null;
  const c = polygonCentroid(clipped);
  return { poly: clipped, cx: c.x, cy: c.y, ux, uy, level };
}
