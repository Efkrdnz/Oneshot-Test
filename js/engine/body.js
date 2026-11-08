// Rigid body: a set of convex shapes sharing one transform. Positions refer
// to the centre of mass; shapes are stored relative to it.

import { buildGeometry, compoundMass, makeCircleShape, makePolyShape, computeSmoothNeighbors } from './shapes.js';
import { materialFrom } from './materials.js';

let BODY_UID = 1;

export function setBodyUidFloor(n) {
  if (n >= BODY_UID) BODY_UID = n + 1;
}

export class Body {
  constructor(opts = {}) {
    this.id = opts.id ?? BODY_UID++;
    setBodyUidFloor(this.id);
    this.name = opts.name || '';
    this.type = opts.type || 'dynamic'; // dynamic | static | kinematic
    this.geom = opts.geom || { kind: 'box', w: 1, h: 1 };
    this.material = Object.assign(materialFrom(opts.materialKey || 'wood'), opts.material || {});
    this.color = opts.color || null; // null -> material color

    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.angle = opts.angle || 0;
    this.c = Math.cos(this.angle);
    this.s = Math.sin(this.angle);
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.w = opts.w || 0;

    this.fx = 0;
    this.fy = 0;
    this.torque = 0;

    this.gravityScale = opts.gravityScale ?? 1;
    this.dragCoef = opts.dragCoef ?? null; // null => auto from shape
    this.linearDamping = opts.linearDamping ?? 0;
    this.angularDamping = opts.angularDamping ?? 0;
    this.fixedRotation = !!opts.fixedRotation;
    this.collide = opts.collide ?? true;
    this.layer = opts.layer ?? 1; // bitmask category
    this.mask = opts.mask ?? 0xffff;
    this.hull = !!opts.hull; // buoyancy uses the outer hull (boats, sealed tanks)
    this.innerLiquid = opts.innerLiquid || null; // { liquid, fraction }
    this.surfaceSpeed = opts.surfaceSpeed || 0; // conveyor belt speed (m/s) along local +x
    this.motion = opts.motion || null; // kinematic motion description
    this.trail = !!opts.trail;
    this.record = !!opts.record;
    this.showLabel = !!opts.showLabel;
    this.charge = opts.charge || 0;
    this.locked = !!opts.locked; // not movable by the user

    // Derived
    this.shapes = [];
    this.area = 0;
    this.mass = 0;
    this.invMass = 0;
    this.inertia = 0;
    this.invI = 0;
    this.hullLocal = [];
    this.interiorLocal = null;
    this.interiorArea = 0;
    this.liquidMass = 0;
    this.radius = 0; // bounding radius
    this.aabb = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

    // Solver state
    this.awake = true;
    this.sleepTime = 0;
    this.dpx = 0;
    this.dpy = 0;
    this.dq = 0;
    this.island = 0;
    this.index = 0;

    // Previous transform for render interpolation & detectors
    this.px = this.x;
    this.py = this.y;
    this.pa = this.angle;

    // Diagnostics (filled by the world each step)
    this.forces = {
      gravity: { x: 0, y: 0 }, normal: { x: 0, y: 0 }, friction: { x: 0, y: 0 },
      drag: { x: 0, y: 0 }, buoyancy: { x: 0, y: 0 }, other: { x: 0, y: 0 },
    };
    this.ax = 0;
    this.ay = 0;
    this.submerged = 0;
    this.trailPts = [];
    this.strobe = [];

    this.depth = opts.depth || 0.1;
    this.setGeometry(this.geom, true);
    if (opts.mass && this.type === 'dynamic') this.setMass(opts.mass);
  }

  get isDynamic() {
    return this.type === 'dynamic';
  }

  get isStatic() {
    return this.type === 'static';
  }

  get displayColor() {
    return this.color || null;
  }

  setGeometry(geom, keepPosition = true) {
    this.geom = geom;
    const { pieces, hull, interior } = buildGeometry(geom);
    const mp = compoundMass(pieces);
    const ox = mp.cx;
    const oy = mp.cy;
    // If keepPosition we keep the COM position in world (simplest & stable).
    this.comOffset = { x: ox, y: oy };
    this.shapes = pieces.map((p) => {
      if (p.type === 'circle') return makeCircleShape(p.x - ox, p.y - oy, p.r);
      return makePolyShape(p.points.map((q) => ({ x: q.x - ox, y: q.y - oy })), p.ghost);
    });
    for (const s of this.shapes) s.body = this;
    computeSmoothNeighbors(this.shapes);
    this.hullLocal = hull.map((q) => ({ x: q.x - ox, y: q.y - oy }));
    this.interiorLocal = interior ? interior.map((q) => ({ x: q.x - ox, y: q.y - oy })) : null;
    this.interiorArea = interior ? Math.abs(areaSigned(interior)) : 0;
    this.area = mp.area;
    this.unitInertia = mp.I; // area moment about COM
    let r = 0;
    for (const s of this.shapes) {
      if (s.type === 'circle') r = Math.max(r, Math.hypot(s.x, s.y) + s.r);
      else for (const v of s.verts) r = Math.max(r, Math.hypot(v.x, v.y));
    }
    this.radius = r;
    this.updateMass();
    this.updateTransform();
  }

  updateMass() {
    const d = this.depth;
    const m = this.material.density * this.area * d;
    this.liquidMass = 0;
    if (this.innerLiquid && this.interiorArea > 0) {
      this.liquidMass = this.innerLiquid.density * this.interiorArea * clamp01(this.innerLiquid.fraction) * d;
    }
    const total = m + this.liquidMass;
    this.mass = total;
    this.shellMass = m;
    if (this.type === 'dynamic' && total > 0) {
      this.invMass = 1 / total;
      // inertia scales with mass of the shell + approximate liquid as interior area slab
      const I = this.material.density * this.unitInertia * d + this.liquidMass * (this.interiorArea / 6);
      this.inertia = I;
      this.invI = this.fixedRotation || I <= 0 ? 0 : 1 / I;
    } else {
      this.invMass = 0;
      this.invI = 0;
      this.inertia = this.material.density * this.unitInertia * d;
    }
  }

  setMass(mass) {
    if (this.area <= 0) return;
    const shell = Math.max(1e-6, mass - this.liquidMass);
    this.material.density = shell / (this.area * this.depth);
    this.updateMass();
  }

  setType(type) {
    this.type = type;
    if (type !== 'dynamic') {
      if (type === 'static') {
        this.vx = 0;
        this.vy = 0;
        this.w = 0;
      }
    }
    this.updateMass();
    this.wake();
  }

  wake() {
    this.awake = true;
    this.sleepTime = 0;
  }

  updateTransform() {
    this.c = Math.cos(this.angle);
    this.s = Math.sin(this.angle);
  }

  // Update world-space caches for all shapes and the body AABB.
  syncShapes() {
    const c = this.c;
    const s = this.s;
    const x = this.x;
    const y = this.y;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const sh of this.shapes) {
      const bb = sh.aabb;
      if (sh.type === 'circle') {
        sh.wx = x + c * sh.x - s * sh.y;
        sh.wy = y + s * sh.x + c * sh.y;
        bb.minX = sh.wx - sh.r;
        bb.maxX = sh.wx + sh.r;
        bb.minY = sh.wy - sh.r;
        bb.maxY = sh.wy + sh.r;
      } else {
        const wv = sh.wv;
        const wn = sh.wn;
        let a = Infinity;
        let b = Infinity;
        let cc = -Infinity;
        let d = -Infinity;
        for (let i = 0; i < sh.count; i++) {
          const v = sh.verts[i];
          const n = sh.normals[i];
          const vx = x + c * v.x - s * v.y;
          const vy = y + s * v.x + c * v.y;
          wv[i * 2] = vx;
          wv[i * 2 + 1] = vy;
          wn[i * 2] = c * n.x - s * n.y;
          wn[i * 2 + 1] = s * n.x + c * n.y;
          if (vx < a) a = vx;
          if (vy < b) b = vy;
          if (vx > cc) cc = vx;
          if (vy > d) d = vy;
        }
        bb.minX = a;
        bb.minY = b;
        bb.maxX = cc;
        bb.maxY = d;
      }
      if (bb.minX < minX) minX = bb.minX;
      if (bb.minY < minY) minY = bb.minY;
      if (bb.maxX > maxX) maxX = bb.maxX;
      if (bb.maxY > maxY) maxY = bb.maxY;
    }
    this.aabb.minX = minX;
    this.aabb.minY = minY;
    this.aabb.maxX = maxX;
    this.aabb.maxY = maxY;
  }

  // Place the body so that its design origin (e.g. a wedge's bounding-box
  // centre) lands on (x, y). Positions otherwise refer to the centre of mass.
  setDesignPosition(x, y) {
    const o = this.comOffset || { x: 0, y: 0 };
    this.x = x + this.c * o.x - this.s * o.y;
    this.y = y + this.s * o.x + this.c * o.y;
    this.syncShapes();
    return this;
  }

  designPosition() {
    const o = this.comOffset || { x: 0, y: 0 };
    return { x: this.x - (this.c * o.x - this.s * o.y), y: this.y - (this.s * o.x + this.c * o.y) };
  }

  localToWorld(lx, ly) {
    return { x: this.x + this.c * lx - this.s * ly, y: this.y + this.s * lx + this.c * ly };
  }

  worldToLocal(wx, wy) {
    const dx = wx - this.x;
    const dy = wy - this.y;
    return { x: this.c * dx + this.s * dy, y: -this.s * dx + this.c * dy };
  }

  velocityAt(wx, wy) {
    return { x: this.vx - this.w * (wy - this.y), y: this.vy + this.w * (wx - this.x) };
  }

  applyImpulse(jx, jy, wx, wy) {
    if (this.type !== 'dynamic') return;
    this.vx += jx * this.invMass;
    this.vy += jy * this.invMass;
    this.w += this.invI * ((wx - this.x) * jy - (wy - this.y) * jx);
  }

  applyForce(fx, fy, wx, wy) {
    this.fx += fx;
    this.fy += fy;
    if (wx !== undefined) this.torque += (wx - this.x) * fy - (wy - this.y) * fx;
  }

  // World-space hull polygon (for buoyancy and rendering).
  worldHull() {
    return this.hullLocal.map((p) => this.localToWorld(p.x, p.y));
  }

  containsPoint(px, py) {
    const l = this.worldToLocal(px, py);
    for (const sh of this.shapes) {
      if (sh.type === 'circle') {
        if ((l.x - sh.x) ** 2 + (l.y - sh.y) ** 2 <= sh.r * sh.r) return true;
      } else {
        let inside = true;
        for (let i = 0; i < sh.count; i++) {
          const v = sh.verts[i];
          const n = sh.normals[i];
          if ((l.x - v.x) * n.x + (l.y - v.y) * n.y > 0) {
            inside = false;
            break;
          }
        }
        if (inside) return true;
      }
    }
    return false;
  }

  kineticEnergy() {
    return 0.5 * this.mass * (this.vx * this.vx + this.vy * this.vy) + 0.5 * this.inertia * this.w * this.w;
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function areaSigned(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
