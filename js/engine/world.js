// The World owns every simulated thing in the lab and advances it with a
// fixed time step. Rigid bodies are solved with a sub-stepped soft solver;
// fluids, waves, detectors and devices are updated around it.

import { Body } from './body.js';
import { Contact, updateManifold, prepareContacts, warmStartContacts, solveContacts, applyRestitution, makeSoft, correctPositions } from './solver.js';
import { collideShapes, LINEAR_SLOP, raycastShape } from './collision.js';
import { RevoluteJoint, DistanceJoint, PulleyJoint, PrismaticJoint, MouseJoint } from './joints.js';
import { computeForces } from './forces.js';
import { Pool, stepPools } from './pools.js';
import { ParticleFluid } from './fluid.js';
import { stepInstrumentsSubstep, stepInstrumentsPost, Gate, Timer } from './instruments.js';
import { stepDevicesPre, stepDevicesPost, stepDevicesForces } from './devices.js';
import { stepWaveStrings } from './wavestring.js';

export const DEFAULT_SETTINGS = () => ({
  gravity: { x: 0, y: -9.81 },
  airDensity: 1.225,
  airViscosity: 1.8e-5,
  wind: { x: 0, y: 0 },
  drag: true,
  depth: 0.1, // slab thickness (m) used to turn areas into volumes
  stepRate: 120,
  substeps: 4,
  sleeping: true,
  restitutionThreshold: 0.3,
  frictionMix: 'geo',
  restitutionMix: 'max',
  staticSpeed: 0.02,
  contactHertz: 60,
  positionIterations: 3,
  contactDampingRatio: 10,
  pushoutVelocity: 3,
  jointHertz: 60,
  jointDampingRatio: 2,
  warmStart: true,
  mutualGravity: false,
  G: 1, // scaled gravitational constant for mutual attraction (N m^2 / kg^2)
  coulomb: false,
  K: 50, // scaled Coulomb constant
  collisions: true,
  room: { left: -12, right: 12, bottom: 0, top: 14, floor: true, left_wall: true, right_wall: true, ceiling: false, material: 'concrete' },
  fluid: { radius: 0.09, stiffness: 1, viscosity: 1 },
});

export class World {
  constructor(settings) {
    this.settings = Object.assign(DEFAULT_SETTINGS(), settings || {});
    this.ground = new Body({ id: 0, type: 'static', geom: { kind: 'compound', parts: [] } });
    this.ground.awake = true;
    this.bodies = [];
    this.joints = [];
    this.pools = [];
    this.gates = [];
    this.timers = [];
    this.rulers = [];
    this.labels = [];
    this.cannons = [];
    this.slingshots = [];
    this.emitters = [];
    this.drains = [];
    this.attractors = [];
    this.fans = [];
    this.waveStrings = [];
    this.fluid = new ParticleFluid(this);
    this.contactMap = new Map();
    this.contacts = [];
    this.jointExclusions = new Set();
    this.time = 0;
    this.stepCount = 0;
    this.events = [];
    this.roomBodies = [];
    this.mouseJoint = null;
    this.recorder = null; // set by UI
    this.trailInterval = 1 / 30;
    this.strobeInterval = 0.1;
    this._lastTrail = -1;
    this._lastStrobe = -1;
    this.splashes = [];
    this.rebuildRoom();
  }

  // --- configuration -------------------------------------------------------
  rebuildRoom() {
    for (const b of this.roomBodies) this._removeBodyRaw(b);
    this.roomBodies = [];
    const r = this.settings.room;
    const t = 2;
    const w = r.right - r.left;
    const hgt = r.top - r.bottom;
    const mk = (cx, cy, bw, bh, name) => {
      const b = new Body({
        type: 'static', geom: { kind: 'box', w: bw, h: bh }, x: cx, y: cy, materialKey: r.material || 'concrete', depth: this.settings.depth,
      });
      b.room = true;
      b.name = name;
      b.locked = true;
      b.syncShapes();
      this.roomBodies.push(b);
      this.bodies.unshift(b);
    };
    if (r.floor) mk((r.left + r.right) / 2, r.bottom - t / 2, w + 2 * t, t, 'Floor');
    if (r.ceiling) mk((r.left + r.right) / 2, r.top + t / 2, w + 2 * t, t, 'Ceiling');
    if (r.left_wall) mk(r.left - t / 2, (r.bottom + r.top) / 2, t, hgt + 2 * t, 'Left wall');
    if (r.right_wall) mk(r.right + t / 2, (r.bottom + r.top) / 2, t, hgt + 2 * t, 'Right wall');
  }

  setDepth(d) {
    this.settings.depth = d;
    for (const b of this.bodies) {
      b.depth = d;
      b.updateMass();
    }
  }

  wakeAll() {
    for (const b of this.bodies) b.wake();
  }

  // --- bodies ---------------------------------------------------------------
  addBody(body) {
    body.depth = this.settings.depth;
    body.updateMass();
    body.syncShapes();
    this.bodies.push(body);
    body.wake();
    return body;
  }

  createBody(opts) {
    return this.addBody(new Body({ depth: this.settings.depth, ...opts }));
  }

  _removeBodyRaw(body) {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    for (const [k, c] of this.contactMap) {
      if (c.bodyA === body || c.bodyB === body) this.contactMap.delete(k);
    }
    this.contacts = this.contacts.filter((c) => c.bodyA !== body && c.bodyB !== body);
  }

  removeBody(body) {
    this._removeBodyRaw(body);
    for (const j of this.joints.slice()) {
      if (j.bodyA === body || j.bodyB === body) this.removeJoint(j);
    }
    if (this.mouseJoint && this.mouseJoint.bodyB === body) this.mouseJoint = null;
    for (const s of this.slingshots) if (s.loaded === body) s.loaded = null;
    for (const g of this.gates) if (g.filterBody === body.id) g.filterBody = 0;
    this.wakeAll();
  }

  getBody(id) {
    if (id === 0) return this.ground;
    return this.bodies.find((b) => b.id === id) || null;
  }

  // --- joints -----------------------------------------------------------------
  addJoint(j) {
    this.joints.push(j);
    j.bodyA.wake();
    j.bodyB.wake();
    this.rebuildExclusions();
    return j;
  }

  createJoint(type, bodyA, bodyB, opts) {
    let j;
    switch (type) {
      case 'revolute': j = new RevoluteJoint(bodyA, bodyB, opts); break;
      case 'distance': j = new DistanceJoint(bodyA, bodyB, opts); break;
      case 'pulley': j = new PulleyJoint(bodyA, bodyB, opts); break;
      case 'prismatic': j = new PrismaticJoint(bodyA, bodyB, opts); break;
      default: throw new Error('unknown joint ' + type);
    }
    return this.addJoint(j);
  }

  removeJoint(j) {
    const i = this.joints.indexOf(j);
    if (i >= 0) this.joints.splice(i, 1);
    j.bodyA.wake();
    j.bodyB.wake();
    this.rebuildExclusions();
  }

  rebuildExclusions() {
    this.jointExclusions.clear();
    for (const j of this.joints) {
      if (!j.collideConnected) this.jointExclusions.add(pairKey(j.bodyA.id, j.bodyB.id));
    }
  }

  // --- mouse drag -------------------------------------------------------------
  startDrag(body, wx, wy) {
    if (body.type !== 'dynamic') return null;
    const local = body.worldToLocal(wx, wy);
    this.mouseJoint = new MouseJoint(this.ground, body, {
      localB: local, target: { x: wx, y: wy },
      maxForce: 300 * body.mass * Math.max(9.81, Math.hypot(this.settings.gravity.x, this.settings.gravity.y)),
    });
    body.wake();
    return this.mouseJoint;
  }

  updateDrag(wx, wy) {
    if (!this.mouseJoint) return;
    this.mouseJoint.target.x = wx;
    this.mouseJoint.target.y = wy;
    this.mouseJoint.bodyB.wake();
  }

  endDrag() {
    this.mouseJoint = null;
  }

  // --- queries -----------------------------------------------------------------
  bodyAt(wx, wy, includeRoom = false) {
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.room && !includeRoom) continue;
      if (wx < b.aabb.minX - 0.01 || wx > b.aabb.maxX + 0.01 || wy < b.aabb.minY - 0.01 || wy > b.aabb.maxY + 0.01) continue;
      if (b.containsPoint(wx, wy)) return b;
    }
    return null;
  }

  bodiesInRect(x0, y0, x1, y1) {
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    return this.bodies.filter((b) => !b.room && b.aabb.minX >= minX && b.aabb.maxX <= maxX && b.aabb.minY >= minY && b.aabb.maxY <= maxY);
  }

  raycast(ax, ay, bx, by, ignore) {
    let best = null;
    let bestT = 1;
    for (const b of this.bodies) {
      if (b === ignore) continue;
      for (const sh of b.shapes) {
        const t = raycastShape(sh, ax, ay, bx, by);
        if (t >= 0 && t < bestT) {
          bestT = t;
          best = b;
        }
      }
    }
    return best ? { body: best, t: bestT, x: ax + (bx - ax) * bestT, y: ay + (by - ay) * bestT } : null;
  }

  emit(type, data) {
    this.events.push({ type, time: this.time, ...data });
    if (this.events.length > 500) this.events.splice(0, this.events.length - 500);
  }

  // --- stepping ------------------------------------------------------------------
  get dt() {
    return 1 / this.settings.stepRate;
  }

  step() {
    const st = this.settings;
    const dt = 1 / st.stepRate;
    const sub = Math.max(1, Math.round(st.substeps));
    const h = dt / sub;
    const invH = 1 / h;
    this.stepCount++;

    for (const b of this.bodies) {
      b.px = b.x;
      b.py = b.y;
      b.pa = b.angle;
      b._sx = b.x;
      b._sy = b.y;
      b._sa = b.angle;
      b.dpx = 0;
      b.dpy = 0;
      b.dq = 0;
    }

    stepDevicesPre(this, dt);
    this.updateKinematics(dt);
    computeForces(this, dt);
    stepDevicesForces(this, dt);
    this.collide(dt);

    const cfg = st;
    const jointSoftness = makeSoft(2 * Math.min(st.contactHertz, 0.25 / h), st.jointDampingRatio, h);
    const ctx = { jointSoftness, warmStart: st.warmStart };
    const solverContacts = [];
    for (const c of this.contacts) {
      if (!(c.bodyA.awake && c.bodyA.type === 'dynamic') && !(c.bodyB.awake && c.bodyB.type === 'dynamic')) continue;
      if (!st.warmStart) for (const p of c.points) p.normalImpulse = p.tangentImpulse = 0;
      solverContacts.push(c);
    }
    prepareContacts(solverContacts, h, cfg);
    const joints = [];
    for (const j of this.joints) {
      if (!j.bodyA.awake && !j.bodyB.awake) continue;
      if (j.bodyA.type !== 'dynamic' && j.bodyB.type !== 'dynamic') continue;
      j.prepare(h, ctx);
      joints.push(j);
    }
    if (this.mouseJoint) {
      this.mouseJoint.prepare(h, ctx);
      joints.push(this.mouseJoint);
    }

    // bodies in free flight get the exact constant-acceleration position update
    for (const b of this.bodies) b._free = b.type === 'dynamic';
    for (const c of solverContacts) {
      c.bodyA._free = false;
      c.bodyB._free = false;
    }
    for (const j of joints) {
      j.bodyA._free = false;
      j.bodyB._free = false;
    }
    const g = st.gravity;
    const t0 = this.time;
    for (let i = 0; i < sub; i++) {
      // integrate velocities
      for (const b of this.bodies) {
        if (b.type !== 'dynamic' || !b.awake) continue;
        const gs = b.gravityScale;
        const ld = 1 / (1 + h * b.linearDamping);
        const ad = 1 / (1 + h * b.angularDamping);
        b.vx = b.vx * ld + h * (g.x * gs + b.fx * b.invMass);
        b.vy = b.vy * ld + h * (g.y * gs + b.fy * b.invMass);
        b.w = b.w * ad + h * b.invI * b.torque;
      }
      for (const j of joints) j.warmStart();
      warmStartContacts(solverContacts);
      for (const j of joints) j.solve(h, invH, true);
      solveContacts(solverContacts, invH, true, cfg);
      // integrate positions
      for (const b of this.bodies) {
        if (b.type === 'static' || !b.awake) continue;
        // clamp extreme velocities for robustness
        const v2 = b.vx * b.vx + b.vy * b.vy;
        const maxV = 2000;
        if (v2 > maxV * maxV) {
          const s = maxV / Math.sqrt(v2);
          b.vx *= s;
          b.vy *= s;
        }
        if (b.w > 300) b.w = 300;
        else if (b.w < -300) b.w = -300;
        // exact for constant acceleration: x += h v - h^2 a / 2 (v already includes a h)
        let mx = h * b.vx;
        let my = h * b.vy;
        if (b._free) {
          const hh = 0.5 * h * h;
          mx -= hh * (g.x * b.gravityScale + b.fx * b.invMass);
          my -= hh * (g.y * b.gravityScale + b.fy * b.invMass);
        }
        b.x += mx;
        b.y += my;
        b.angle += h * b.w;
        b.dpx += mx;
        b.dpy += my;
        b.dq += h * b.w;
      }
      for (const j of joints) j.solve(h, invH, false);
      solveContacts(solverContacts, invH, false, cfg);
      stepInstrumentsSubstep(this, t0 + (i + 1) * h, h);
    }
    applyRestitution(solverContacts, st.restitutionThreshold);
    if (st.positionIterations > 0) correctPositions(solverContacts, st.positionIterations, LINEAR_SLOP, 0.2, 0.2);

    for (const b of this.bodies) {
      if (b.type !== 'static') {
        b.updateTransform();
        b.syncShapes();
      }
    }
    this.contactDiagnostics(solverContacts, h);
    for (const j of joints) {
      j.finish(h);
      if (j.breakForce > 0 && j.force > j.breakForce && j !== this.mouseJoint) {
        j.broken = true;
        this.removeJoint(j);
        this.emit('break', { joint: j.id, force: j.force });
      }
    }

    this.fluid.step(dt);
    stepPools(this, dt);
    stepWaveStrings(this, dt);
    this.time = t0 + dt;
    this.updateSleep(dt);
    this.cullOutOfBounds();
    stepDevicesPost(this, dt);
    stepInstrumentsPost(this, dt);
    this.updateTrails();
    for (const b of this.bodies) {
      if (b.type === 'dynamic') {
        // acceleration estimate (for display)
        b.ax = (b.vx - (b._lvx ?? b.vx)) / dt;
        b.ay = (b.vy - (b._lvy ?? b.vy)) / dt;
        b._lvx = b.vx;
        b._lvy = b.vy;
      }
    }
    if (this.recorder) this.recorder.sample(this);
  }

  updateKinematics(dt) {
    const t1 = this.time + dt;
    for (const b of this.bodies) {
      if (b.type !== 'kinematic' || !b.motion) continue;
      const m = b.motion;
      if (!m.origin) m.origin = { x: b.x, y: b.y, angle: b.angle };
      const o = m.origin;
      let tx = o.x;
      let ty = o.y;
      let ta = o.angle;
      const ph = (m.phase || 0) * Math.PI / 180;
      if (m.type === 'oscillate' || m.type === 'platform') {
        const w = 2 * Math.PI / Math.max(0.05, m.period || 2);
        const s = Math.sin(w * t1 + ph);
        const ang = (m.direction || 0) * Math.PI / 180;
        tx = o.x + Math.cos(ang) * (m.amplitude || 1) * s;
        ty = o.y + Math.sin(ang) * (m.amplitude || 1) * s;
      } else if (m.type === 'rotate') {
        ta = o.angle + (m.speed || 1) * t1;
      } else if (m.type === 'swing') {
        const w = 2 * Math.PI / Math.max(0.05, m.period || 2);
        ta = o.angle + ((m.amplitude || 30) * Math.PI / 180) * Math.sin(w * t1 + ph);
      } else if (m.type === 'path' && m.points && m.points.length > 1) {
        const p = pathPosition(m.points, (m.speed || 1) * t1, m.loop !== false);
        tx = o.x + p.x;
        ty = o.y + p.y;
      }
      b.vx = (tx - b.x) / dt;
      b.vy = (ty - b.y) / dt;
      b.w = (ta - b.angle) / dt;
      b.awake = true;
    }
  }

  resetKinematicOrigins() {
    for (const b of this.bodies) if (b.motion) b.motion.origin = null;
  }

  collide(dt) {
    const st = this.settings;
    this.stamp = (this.stamp || 0) + 1;
    const stamp = this.stamp;
    const spec = 4 * LINEAR_SLOP;
    const list = [];
    for (const b of this.bodies) {
      if (!b.shapes.length || !b.collide) continue;
      const speed = Math.hypot(b.vx, b.vy) + Math.abs(b.w) * b.radius;
      b._margin = speed * dt;
      list.push(b);
    }
    list.sort((a, b) => a.aabb.minX - a._margin - (b.aabb.minX - b._margin));
    const active = [];
    if (st.collisions) {
      for (let i = 0; i < list.length; i++) {
        const A = list[i];
        const aMaxX = A.aabb.maxX + A._margin + spec;
        for (let j = i + 1; j < list.length; j++) {
          const B = list[j];
          if (B.aabb.minX - B._margin > aMaxX) break;
          const aDyn = A.type === 'dynamic';
          const bDyn = B.type === 'dynamic';
          if (!aDyn && !bDyn) continue;
          if ((!A.awake || !aDyn) && (!B.awake || !bDyn)) continue;
          if (!(A.layer & B.mask) || !(B.layer & A.mask)) continue;
          const m = A._margin + B._margin + spec;
          if (A.aabb.maxY + m < B.aabb.minY || B.aabb.maxY + m < A.aabb.minY) continue;
          if (this.jointExclusions.size && this.jointExclusions.has(pairKey(A.id, B.id))) continue;
          for (const sa of A.shapes) {
            for (const sb of B.shapes) {
              const ba = sa.aabb;
              const bb = sb.aabb;
              if (ba.maxX + m < bb.minX || bb.maxX + m < ba.minX || ba.maxY + m < bb.minY || bb.maxY + m < ba.minY) continue;
              let s1 = sa;
              let s2 = sb;
              if (s1.uid > s2.uid) {
                s1 = sb;
                s2 = sa;
              }
              const manifold = collideShapes(s1, s2, m);
              const key = s1.uid * 4194304 + s2.uid;
              if (!manifold) continue;
              let c = this.contactMap.get(key);
              if (!c) {
                c = new Contact(s1, s2, key);
                this.contactMap.set(key, c);
              }
              updateManifold(c, manifold);
              c.stamp = stamp;
              active.push(c);
              // a sleeping body touched by an awake one must take part in this
              // step's solve, otherwise it would act as an immovable wall
              if (!A.awake && aDyn) A.wake();
              if (!B.awake && bDyn) B.wake();
            }
          }
        }
      }
    }
    // keep contacts of sleeping pairs alive (they were not re-tested)
    for (const [k, c] of this.contactMap) {
      if (c.stamp === stamp) continue;
      const sleepingPair = (!c.bodyA.awake || c.bodyA.type !== 'dynamic') && (!c.bodyB.awake || c.bodyB.type !== 'dynamic');
      if (sleepingPair) {
        c.stamp = stamp;
        active.push(c);
      } else this.contactMap.delete(k);
    }
    this.contacts = active;
  }

  contactDiagnostics(contacts, h) {
    for (const b of this.bodies) {
      const f = b.forces;
      f.normal.x = f.normal.y = f.friction.x = f.friction.y = 0;
    }
    const inv = 1 / h;
    for (const c of contacts) {
      let ni = 0;
      let ti = 0;
      for (const p of c.points) {
        ni += p.normalImpulse;
        ti += p.tangentImpulse;
      }
      c.normalForce = ni * inv;
      c.tangentForce = ti * inv;
      const nx = c.nx * ni * inv;
      const ny = c.ny * ni * inv;
      const tx = c.ny * ti * inv;
      const ty = -c.nx * ti * inv;
      const A = c.bodyA.forces;
      const B = c.bodyB.forces;
      B.normal.x += nx;
      B.normal.y += ny;
      A.normal.x -= nx;
      A.normal.y -= ny;
      B.friction.x += tx;
      B.friction.y += ty;
      A.friction.x -= tx;
      A.friction.y -= ty;
    }
  }

  updateSleep(dt) {
    const bodies = this.bodies;
    if (!this.settings.sleeping) {
      for (const b of bodies) {
        b.awake = true;
        b.sleepTime = 0;
      }
      return;
    }
    const linTol = 0.01;
    const angTol = 0.02;
    const timeToSleep = 1.0;
    const dyn = [];
    for (const b of bodies) {
      if (b.type !== 'dynamic') continue;
      b.index = dyn.length;
      dyn.push(b);
      if (b.awake) {
        if (b.vx * b.vx + b.vy * b.vy > linTol * linTol || b.w * b.w > angTol * angTol || b.keepAwake) b.sleepTime = 0;
        else b.sleepTime += dt;
      }
    }
    const parent = new Int32Array(dyn.length);
    for (let i = 0; i < dyn.length; i++) parent[i] = i;
    const find = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };
    for (const c of this.contacts) {
      const A = c.bodyA;
      const B = c.bodyB;
      if (A.type === 'dynamic' && B.type === 'dynamic') union(A.index, B.index);
      else if (A.type === 'kinematic' && B.type === 'dynamic' && (A.vx || A.vy || A.w)) B.sleepTime = 0;
      else if (B.type === 'kinematic' && A.type === 'dynamic' && (B.vx || B.vy || B.w)) A.sleepTime = 0;
      if (A.type === 'static' && A.surfaceSpeed && B.type === 'dynamic') B.sleepTime = 0;
      if (B.type === 'static' && B.surfaceSpeed && A.type === 'dynamic') A.sleepTime = 0;
    }
    for (const j of this.joints) {
      const A = j.bodyA;
      const B = j.bodyB;
      if (A.type === 'dynamic' && B.type === 'dynamic') union(A.index, B.index);
      if (j.enableMotor) {
        if (A.type === 'dynamic') A.sleepTime = 0;
        if (B.type === 'dynamic') B.sleepTime = 0;
      }
    }
    if (this.mouseJoint) this.mouseJoint.bodyB.sleepTime = 0;
    const minSleep = new Float64Array(dyn.length).fill(Infinity);
    for (const b of dyn) {
      const r = find(b.index);
      if (b.sleepTime < minSleep[r]) minSleep[r] = b.sleepTime;
    }
    for (const b of dyn) {
      const r = find(b.index);
      if (minSleep[r] >= timeToSleep) {
        if (b.awake) {
          b.awake = false;
          b.vx = b.vy = b.w = 0;
        }
      } else if (!b.awake) {
        b.awake = true;
        b.sleepTime = 0;
      }
    }
  }

  cullOutOfBounds() {
    const r = this.settings.room;
    const margin = 60;
    for (const b of this.bodies.slice()) {
      if (b.type !== 'dynamic') continue;
      if (b.y < r.bottom - margin || b.y > r.top + margin * 4 || b.x < r.left - margin * 2 || b.x > r.right + margin * 2) {
        this.removeBody(b);
        this.emit('lost', { body: b.id });
      }
    }
  }

  updateTrails() {
    const t = this.time;
    if (t - this._lastTrail >= this.trailInterval - 1e-9) {
      this._lastTrail = t;
      for (const b of this.bodies) {
        if (!b.trail || b.type === 'static') continue;
        b.trailPts.push(b.x, b.y);
        if (b.trailPts.length > 2400) b.trailPts.splice(0, b.trailPts.length - 2400);
      }
    }
    if (t - this._lastStrobe >= this.strobeInterval - 1e-9) {
      this._lastStrobe = t;
      for (const b of this.bodies) {
        if (!b.trail || b.type === 'static') continue;
        b.strobe.push({ x: b.x, y: b.y, a: b.angle });
        if (b.strobe.length > 80) b.strobe.shift();
      }
    }
  }

  clearTrails() {
    for (const b of this.bodies) {
      b.trailPts = [];
      b.strobe = [];
    }
    this._lastTrail = -1;
    this._lastStrobe = -1;
  }

  // --- energy & stats ----------------------------------------------------------
  energy() {
    const g = this.settings.gravity;
    let ke = 0;
    let pe = 0;
    let elastic = 0;
    for (const b of this.bodies) {
      if (b.type !== 'dynamic') continue;
      ke += b.kineticEnergy();
      pe += -b.mass * b.gravityScale * (g.x * b.x + g.y * (b.y - this.settings.room.bottom));
    }
    for (const j of this.joints) elastic += j.energy();
    return { kinetic: ke, potential: pe, elastic, total: ke + pe + elastic };
  }

  momentum() {
    let px = 0;
    let py = 0;
    for (const b of this.bodies) {
      if (b.type !== 'dynamic') continue;
      px += b.mass * b.vx;
      py += b.mass * b.vy;
    }
    return { x: px, y: py };
  }

  // --- helpers for other modules -----------------------------------------------
  addPool(opts) {
    const p = new Pool(opts);
    this.pools.push(p);
    this.wakeAll();
    return p;
  }

  addGate(opts) {
    const g = new Gate(opts);
    this.gates.push(g);
    return g;
  }

  addTimer(opts) {
    const t = new Timer(opts);
    this.timers.push(t);
    return t;
  }

  getTimer(id) {
    return this.timers.find((t) => t.id === id) || null;
  }
}

export function pairKey(a, b) {
  return a < b ? a * 1048576 + b : b * 1048576 + a;
}

function pathPosition(points, s, loop) {
  // points relative to origin; travel along polyline (ping-pong if !loop)
  let total = 0;
  const segs = [];
  const pts = loop ? points.concat([points[0]]) : points;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segs.push(l);
    total += l;
  }
  if (total < 1e-9) return { x: points[0].x, y: points[0].y };
  let d;
  if (loop) d = ((s % total) + total) % total;
  else {
    const p = ((s % (2 * total)) + 2 * total) % (2 * total);
    d = p <= total ? p : 2 * total - p;
  }
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const t = segs[i] > 0 ? Math.min(1, d / segs[i]) : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    d -= segs[i];
  }
  return { x: points[0].x, y: points[0].y };
}
