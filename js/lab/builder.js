// Convenience API for building scenes in code (used by presets and tools).

import { Body } from '../engine/body.js';
import { Gate, Timer, Ruler, Label } from '../engine/instruments.js';
import { Cannon, Slingshot, Emitter, Drain } from '../engine/devices.js';
import { Attractor, Fan } from '../engine/forces.js';
import { WaveString } from '../engine/wavestring.js';
import { MATERIALS } from '../engine/materials.js';

export class Builder {
  constructor(world) {
    this.w = world;
  }

  body(geom, x, y, opts = {}) {
    const b = new Body({ geom, x, y, depth: this.w.settings.depth, ...opts });
    if (opts.mass) b.setMass(opts.mass);
    this.w.addBody(b);
    if (opts.design) b.setDesignPosition(x, y);
    return b;
  }

  box(x, y, w, h, mat = 'wood', opts = {}) {
    return this.body({ kind: 'box', w, h }, x, y, { materialKey: mat, ...opts });
  }

  ball(x, y, r, mat = 'rubber', opts = {}) {
    return this.body({ kind: 'circle', r }, x, y, { materialKey: mat, ...opts });
  }

  wall(x, y, w, h, mat = 'concrete', opts = {}) {
    return this.box(x, y, w, h, mat, { type: 'static', ...opts });
  }

  // Wedge (right triangle) with its bounding box centred at (x, y).
  wedge(x, y, w, h, mat = 'wood', opts = {}) {
    const b = new Body({ geom: { kind: 'wedge', w, h, flip: !!opts.flip }, x, y, depth: this.w.settings.depth, materialKey: mat, ...opts });
    this.w.addBody(b);
    b.setDesignPosition(x, y);
    return b;
  }

  // Static incline descending to the right from (x0, y0+h) to (x0+w, y0).
  incline(x0, y0, w, angleDeg, mat = 'wood', opts = {}) {
    const h = w * Math.tan((angleDeg * Math.PI) / 180);
    const wd = this.wedge(x0 + w / 2, y0 + h / 2, w, h, mat, { type: 'static', name: 'Slope ' + angleDeg + '°', ...opts });
    wd.slope = { x0, y0, w, h, angle: angleDeg };
    return wd;
  }

  // Point on an incline surface at fraction f from the top, plus offset along the normal.
  onIncline(inc, f, normalOffset = 0) {
    const { x0, y0, w, h } = inc.slope;
    const th = Math.atan2(h, w);
    const px = x0 + f * w;
    const py = y0 + h - f * h;
    return { x: px + Math.sin(th) * normalOffset, y: py + Math.cos(th) * normalOffset, angle: -th, nx: Math.sin(th), ny: Math.cos(th) };
  }

  track(points, opts = {}) {
    return this.body({ kind: 'track', points, thickness: opts.thickness ?? 0.15 }, 0, 0, {
      type: 'static', materialKey: opts.material || 'wood', design: true, name: opts.name || 'Track', ...opts,
    });
  }

  container(x, y, w, h, t = 0.08, mat = 'glass', opts = {}) {
    return this.body({ kind: 'container', w, h, t }, x, y, { materialKey: mat, design: true, ...opts });
  }

  // --- joints ------------------------------------------------------------------
  anchor(body, wx, wy) {
    if (!body || body === this.w.ground) return { body: this.w.ground, local: { x: wx, y: wy } };
    return { body, local: body.worldToLocal(wx, wy) };
  }

  pin(body, wx, wy, opts = {}) {
    return this.hinge(null, body, wx, wy, opts);
  }

  hinge(a, b, wx, wy, opts = {}) {
    const A = this.anchor(a, wx, wy);
    const B = this.anchor(b, wx, wy);
    return this.w.createJoint('revolute', A.body, B.body, { localA: A.local, localB: B.local, ...opts });
  }

  weld(a, b, wx, wy, opts = {}) {
    return this.hinge(a, b, wx, wy, { lockAngle: true, ...opts });
  }

  distance(mode, a, pa, b, pb, opts = {}) {
    const A = this.anchor(a, pa.x, pa.y);
    const B = this.anchor(b, pb.x, pb.y);
    return this.w.createJoint('distance', A.body, B.body, { mode, localA: A.local, localB: B.local, ...opts });
  }

  rope(a, pa, b, pb, opts = {}) {
    return this.distance('rope', a, pa, b, pb, opts);
  }

  rod(a, pa, b, pb, opts = {}) {
    return this.distance('rod', a, pa, b, pb, opts);
  }

  spring(a, pa, b, pb, k, rest, opts = {}) {
    return this.distance('spring', a, pa, b, pb, { k, length: rest, c: opts.c ?? 0, ...opts });
  }

  pulley(a, pa, b, pb, ga, gb, opts = {}) {
    const A = this.anchor(a, pa.x, pa.y);
    const B = this.anchor(b, pb.x, pb.y);
    return this.w.createJoint('pulley', A.body, B.body, { localA: A.local, localB: B.local, groundA: ga, groundB: gb, ...opts });
  }

  rail(body, wx, wy, axis = { x: 1, y: 0 }, opts = {}) {
    const B = this.anchor(body, wx, wy);
    return this.w.createJoint('prismatic', this.w.ground, body, { localA: { x: wx, y: wy }, localB: B.local, axis, ...opts });
  }

  // --- instruments -----------------------------------------------------------------
  timer(x, y, name, opts = {}) {
    const t = new Timer({ x, y, name, ...opts });
    this.w.timers.push(t);
    return t;
  }

  gate(x1, y1, x2, y2, opts = {}) {
    const g = new Gate({ x1, y1, x2, y2, ...opts });
    this.w.gates.push(g);
    return g;
  }

  label(x, y, text, opts = {}) {
    const l = new Label({ x, y, text, ...opts });
    this.w.labels.push(l);
    return l;
  }

  ruler(x1, y1, x2, y2, opts = {}) {
    const r = new Ruler({ x1, y1, x2, y2, ...opts });
    this.w.rulers.push(r);
    return r;
  }

  pool(x0, x1, bottom, level, liquid = 'water', opts = {}) {
    return this.w.addPool({ x0, x1, bottom, level, liquid, ...opts });
  }

  cannon(x, y, angle, speed, opts = {}) {
    const c = new Cannon({ x, y, angle, speed, ...opts });
    this.w.cannons.push(c);
    return c;
  }

  slingshot(x, y, opts = {}) {
    const s = new Slingshot({ x, y, ...opts });
    this.w.slingshots.push(s);
    return s;
  }

  faucet(x, y, opts = {}) {
    const e = new Emitter({ x, y, ...opts });
    this.w.emitters.push(e);
    return e;
  }

  drain(x, y, w, h, opts = {}) {
    const d = new Drain({ x, y, w, h, ...opts });
    this.w.drains.push(d);
    return d;
  }

  attractor(x, y, strength, opts = {}) {
    const a = new Attractor({ x, y, strength, ...opts });
    this.w.attractors.push(a);
    return a;
  }

  fan(x, y, w, h, angleDeg, speed, opts = {}) {
    const f = new Fan({ x, y, w, h, angle: (angleDeg * Math.PI) / 180, speed, ...opts });
    this.w.fans.push(f);
    return f;
  }

  waveString(x1, y1, x2, y2, opts = {}) {
    const s = new WaveString({ x1, y1, x2, y2, ...opts });
    this.w.waveStrings.push(s);
    return s;
  }

  room(opts) {
    Object.assign(this.w.settings.room, opts);
    this.w.rebuildRoom();
  }

  material(key, overrides = {}) {
    const m = MATERIALS[key];
    return { density: m.density, staticFriction: m.staticFriction, friction: m.friction, restitution: m.restitution, ...overrides };
  }
}
