// Launchers and liquid devices: cannons, slingshots, faucets (particle
// emitters) and drains.

import { Body } from './body.js';
import { fieldUid, windAt, autoDragCoef } from './forces.js';

export class Cannon {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Cannon';
    this.x = o.x ?? 0;
    this.y = o.y ?? 0.5;
    this.angle = o.angle ?? 45; // degrees
    this.speed = o.speed ?? 12; // m/s
    this.barrel = o.barrel ?? 0.9;
    this.projectile = Object.assign({ kind: 'circle', r: 0.12, material: 'steel', dragCoef: null, color: null }, o.projectile || {});
    this.fireOnStart = !!o.fireOnStart;
    this.autoFire = !!o.autoFire;
    this.interval = o.interval ?? 1;
    this.maxShots = o.maxShots ?? 25;
    this.trail = o.trail ?? true;
    this.showPrediction = o.showPrediction ?? true;
    this.hideLabel = !!o.hideLabel;
    this.color = o.color || '#94a3b8';
    this.shots = [];
    this.lastFire = -Infinity;
  }

  muzzle() {
    const a = (this.angle * Math.PI) / 180;
    return { x: this.x + Math.cos(a) * this.barrel, y: this.y + Math.sin(a) * this.barrel, dx: Math.cos(a), dy: Math.sin(a) };
  }

  fire(world) {
    const m = this.muzzle();
    const p = this.projectile;
    const geom = p.kind === 'box' ? { kind: 'box', w: p.r * 2, h: p.r * 2 } : { kind: 'circle', r: p.r };
    const b = new Body({
      geom, x: m.x, y: m.y, angle: (this.angle * Math.PI) / 180, materialKey: p.material, depth: world.settings.depth,
      vx: m.dx * this.speed, vy: m.dy * this.speed, trail: this.trail, name: 'Shot', dragCoef: p.dragCoef ?? null,
      color: p.color || null,
    });
    if (p.mass) b.setMass(p.mass);
    if (p.layer) b.layer = p.layer;
    if (p.mask) b.mask = p.mask;
    if (p.restitution !== undefined && p.restitution !== null) b.material.restitution = p.restitution;
    world.addBody(b);
    b.launchedBy = this.id;
    this.shots.push(b.id);
    while (this.shots.length > this.maxShots) {
      const id = this.shots.shift();
      const old = world.getBody(id);
      if (old) world.removeBody(old);
    }
    this.lastFire = world.time;
    world.emit('fire', { device: this.id, name: this.name, speed: this.speed, angle: this.angle, body: b.id });
    return b;
  }
}

export class Slingshot {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Slingshot';
    this.x = o.x ?? 0; // rest point of the pouch (between the fork tips)
    this.y = o.y ?? 1.2;
    this.k = o.k ?? 250; // band stiffness N/m (both bands combined)
    this.fork = o.fork ?? 0.45; // fork width
    this.maxStretch = o.maxStretch ?? 2.2;
    this.projectile = Object.assign({ kind: 'circle', r: 0.15, material: 'rubber' }, o.projectile || {});
    this.color = o.color || '#b45309';
    this.state = 'idle'; // idle | held | launching
    this.body = null;
    this.hold = null;
    this.trail = o.trail ?? true;
  }

  forkTips() {
    return [
      { x: this.x - this.fork / 2, y: this.y },
      { x: this.x + this.fork / 2, y: this.y },
    ];
  }

  // Begin pulling with a new or existing body at (wx, wy).
  grab(world, wx, wy, body) {
    let b = body;
    if (!b) {
      const p = this.projectile;
      const geom = p.kind === 'box' ? { kind: 'box', w: p.r * 2, h: p.r * 2 } : { kind: 'circle', r: p.r };
      b = new Body({ geom, x: wx, y: wy, materialKey: p.material, depth: world.settings.depth, trail: this.trail, name: 'Stone' });
      world.addBody(b);
    }
    this.body = b;
    this.state = 'held';
    this.pull(wx, wy);
    return b;
  }

  pull(wx, wy) {
    let dx = wx - this.x;
    let dy = wy - this.y;
    const l = Math.hypot(dx, dy);
    if (l > this.maxStretch) {
      dx *= this.maxStretch / l;
      dy *= this.maxStretch / l;
    }
    this.hold = { x: this.x + dx, y: this.y + dy };
  }

  release(world) {
    if (this.state !== 'held' || !this.body) return;
    this.state = 'launching';
    const dx = this.x - this.hold.x;
    const dy = this.y - this.hold.y;
    const l = Math.hypot(dx, dy) || 1;
    this.launchDir = { x: dx / l, y: dy / l };
    this.hold = null;
    this.body.wake();
    // the elastic band: an implicit, tension-only spring to the rest point
    if (world) {
      this.band = world.createJoint('distance', world.ground, this.body, {
        mode: 'bungee', localA: { x: this.x, y: this.y }, localB: { x: 0, y: 0 }, length: 0, k: this.k, c: 0, collideConnected: true,
      });
      this.band.internal = true;
      this.band.oneWay = { x: this.launchDir.x, y: this.launchDir.y };
    }
  }

  // Ideal launch speed from elastic energy (ignores gravity during release).
  predictedSpeed() {
    if (!this.body || !this.hold) return 0;
    const s = Math.hypot(this.hold.x - this.x, this.hold.y - this.y);
    return s * Math.sqrt(this.k / this.body.mass);
  }
}

export class Emitter {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Faucet';
    this.x = o.x ?? 0;
    this.y = o.y ?? 4;
    this.angle = o.angle ?? -90; // degrees
    this.speed = o.speed ?? 2;
    this.rate = o.rate ?? 60; // particles per second
    this.width = o.width ?? 0.3;
    this.liquid = o.liquid || 'water';
    this.on = o.on ?? true;
    this.limit = o.limit ?? 0; // 0 = unlimited
    this.emitted = 0;
    this._acc = 0;
  }
}

export class Drain {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Drain';
    this.x = o.x ?? 0;
    this.y = o.y ?? 0.2;
    this.w = o.w ?? 1;
    this.h = o.h ?? 0.4;
    this.count = 0;
  }
}

export function stepDevicesPre(world, dt) {
  const firstStep = world.time === 0;
  for (const c of world.cannons) {
    if (firstStep && c.fireOnStart) c.fire(world);
    else if (c.autoFire && world.time - c.lastFire >= c.interval - 1e-9) c.fire(world);
  }
  for (const s of world.slingshots) {
    if (s.state === 'held' && s.body) {
      const b = s.body;
      if (!world.bodies.includes(b)) {
        s.state = 'idle';
        s.body = null;
        continue;
      }
      b.x = s.hold.x;
      b.y = s.hold.y;
      b.vx = b.vy = b.w = 0;
      b.updateTransform();
      b.syncShapes();
      b.wake();
    }
  }
  const fluid = world.fluid;
  const sp = fluid.radius * 1.15; // rest spacing of particles
  for (const e of world.emitters) {
    if (!e.on) continue;
    if (e.limit && e.emitted >= e.limit) continue;
    // never emit denser than the liquid's rest spacing (avoids explosive spray)
    const lanes = Math.max(1, Math.round(e.width / sp));
    const maxRate = (Math.max(0.3, e.speed) * lanes) / sp;
    e._acc += Math.min(e.rate, maxRate) * dt;
    const a = (e.angle * Math.PI) / 180;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    while (e._acc >= 1) {
      e._acc -= 1;
      e._lane = ((e._lane || 0) + 1) % lanes;
      const off = lanes > 1 ? (e._lane / (lanes - 1) - 0.5) * (lanes - 1) * sp : 0;
      const jitter = (Math.random() - 0.5) * sp * 0.1;
      const px = e.x - dy * (off + jitter);
      const py = e.y + dx * (off + jitter);
      if (fluid.add(px, py, dx * e.speed, dy * e.speed, e.liquid) < 0) break;
      e.emitted++;
    }
  }
}

// Forces that must be added after the generic force pass.
export function stepDevicesForces(world) {
  for (const s of world.slingshots) {
    if (s.state !== 'launching' || !s.body) continue;
    const b = s.body;
    if (!world.bodies.includes(b)) {
      s.state = 'idle';
      s.body = null;
      continue;
    }
    const dx = s.x - b.x;
    const dy = s.y - b.y;
    // released once the projectile passes the rest point
    if (dx * s.launchDir.x + dy * s.launchDir.y <= 0.002) {
      s.state = 'idle';
      if (s.band) world.removeJoint(s.band);
      s.band = null;
      world.emit('fire', { device: s.id, name: s.name, speed: Math.hypot(b.vx, b.vy), body: b.id });
      s.body = null;
      continue;
    }
    if (!s.band) {
      b.fx += s.k * dx;
      b.fy += s.k * dy;
    }
  }
}

export function stepDevicesPost() {}

// Integrate a point-mass trajectory including gravity and air drag; used
// for aiming previews. Returns array of points.
export function predictTrajectory(world, x, y, vx, vy, body, maxTime = 4, opts = {}) {
  const st = world.settings;
  const g = st.gravity;
  const pts = [{ x, y }];
  const dt = 1 / 120;
  const rho = st.drag ? st.airDensity : 0;
  let width = 0.3;
  let mass = 1;
  let cd = 0.47;
  if (body) {
    width = body.radius * 2;
    mass = body.mass;
    cd = body.dragCoef ?? autoDragCoef(body);
  } else if (opts.radius) {
    width = opts.radius * 2;
    mass = opts.mass || 1;
  }
  const k = (0.5 * rho * cd * width * st.depth) / Math.max(mass, 1e-6);
  const room = st.room;
  for (let t = 0; t < maxTime; t += dt) {
    const w = windAt(world, x, y);
    const rx = vx - w.x;
    const ry = vy - w.y;
    const sp = Math.hypot(rx, ry);
    vx += (g.x - k * sp * rx) * dt;
    vy += (g.y - k * sp * ry) * dt;
    x += vx * dt;
    y += vy * dt;
    if (pts.length % 3 === 0 || t + dt >= maxTime) pts.push({ x, y });
    if (y < room.bottom - 0.5 || x < room.left - 5 || x > room.right + 5) break;
    if (opts.stopOnHit && world.bodyAt(x, y)) break;
  }
  pts.push({ x, y });
  return pts;
}
