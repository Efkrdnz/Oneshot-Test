// Joints / connectors. Each joint links bodyA and bodyB (the world "ground"
// body is used for fixed anchors). Anchors are stored in body-local frames.
//
// Types:
//   revolute  - pin / hinge (optional motor, angle limits, angle lock = weld)
//   distance  - mode 'rod' (rigid), 'rope' (max length string),
//               'spring' (Hooke's law k, damping c), 'bungee' (tension-only spring)
//   pulley    - ideal pulley/Atwood rope over two fixed wheels
//   prismatic - slider / rail along an axis
//   mouse     - soft drag constraint used by the grab tool

import { makeSoft } from './solver.js';

let JOINT_UID = 1;
export function setJointUidFloor(n) {
  if (n >= JOINT_UID) JOINT_UID = n + 1;
}

function rotV(c, s, x, y) {
  return [c * x - s * y, s * x + c * y];
}

export class Joint {
  constructor(type, bodyA, bodyB, opts = {}) {
    this.id = opts.id ?? JOINT_UID++;
    setJointUidFloor(this.id);
    this.type = type;
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    this.localA = opts.localA ? { ...opts.localA } : { x: 0, y: 0 };
    this.localB = opts.localB ? { ...opts.localB } : { x: 0, y: 0 };
    this.collideConnected = opts.collideConnected ?? (type === 'distance' || type === 'pulley');
    this.breakForce = opts.breakForce || 0; // 0 = unbreakable
    this.color = opts.color || null;
    this.name = opts.name || '';
    this.showForce = opts.showForce ?? false;
    this.force = 0; // last reaction force magnitude (N)
    this.broken = false;
  }

  anchorA() {
    return this.bodyA.localToWorld(this.localA.x, this.localA.y);
  }

  anchorB() {
    return this.bodyB.localToWorld(this.localB.x, this.localB.y);
  }

  bodiesFor() {
    const A = this.bodyA;
    const B = this.bodyB;
    this.mA = A.awake ? A.invMass : 0;
    this.iA = A.awake ? A.invI : 0;
    this.mB = B.awake ? B.invMass : 0;
    this.iB = B.awake ? B.invI : 0;
  }

  prepareFrames() {
    const A = this.bodyA;
    const B = this.bodyB;
    [this.rA0x, this.rA0y] = rotV(A.c, A.s, this.localA.x, this.localA.y);
    [this.rB0x, this.rB0y] = rotV(B.c, B.s, this.localB.x, this.localB.y);
    this.dcx = B.x - A.x;
    this.dcy = B.y - A.y;
  }

  currentAnchors() {
    const A = this.bodyA;
    const B = this.bodyB;
    const ca = Math.cos(A.dq);
    const sa = Math.sin(A.dq);
    const cb = Math.cos(B.dq);
    const sb = Math.sin(B.dq);
    this.rAx = ca * this.rA0x - sa * this.rA0y;
    this.rAy = sa * this.rA0x + ca * this.rA0y;
    this.rBx = cb * this.rB0x - sb * this.rB0y;
    this.rBy = sb * this.rB0x + cb * this.rB0y;
  }

  applyLinear(px, py) {
    const A = this.bodyA;
    const B = this.bodyB;
    A.vx -= this.mA * px;
    A.vy -= this.mA * py;
    A.w -= this.iA * (this.rAx * py - this.rAy * px);
    B.vx += this.mB * px;
    B.vy += this.mB * py;
    B.w += this.iB * (this.rBx * py - this.rBy * px);
  }

  prepare() {}
  warmStart() {}
  solve() {}
  // Potential energy stored (springs) for energy accounting.
  energy() {
    return 0;
  }
}

// ---------------------------------------------------------------------------
export class RevoluteJoint extends Joint {
  constructor(bodyA, bodyB, opts = {}) {
    super('revolute', bodyA, bodyB, opts);
    this.referenceAngle = opts.referenceAngle ?? (bodyB.angle - bodyA.angle);
    this.enableMotor = !!opts.enableMotor;
    this.motorSpeed = opts.motorSpeed ?? 0; // rad/s
    this.maxMotorTorque = opts.maxMotorTorque ?? 100;
    this.lockAngle = !!opts.lockAngle; // weld
    this.enableLimit = !!opts.enableLimit;
    this.lowerAngle = opts.lowerAngle ?? -Math.PI / 4;
    this.upperAngle = opts.upperAngle ?? Math.PI / 4;
    this.linearImpulse = { x: 0, y: 0 };
    this.motorImpulse = 0;
    this.lowerImpulse = 0;
    this.upperImpulse = 0;
    this.angularImpulse = 0;
  }

  get kind() {
    if (this.lockAngle) return 'weld';
    if (this.enableMotor) return 'motor';
    return 'pin';
  }

  prepare(h, ctx) {
    this.bodiesFor();
    this.prepareFrames();
    const A = this.bodyA;
    const B = this.bodyB;
    this.deltaAngle = wrap(B.angle - A.angle - this.referenceAngle);
    const k = this.iA + this.iB;
    this.axialMass = k > 0 ? 1 / k : 0;
    this.soft = ctx.jointSoftness;
    if (!ctx.warmStart) {
      this.linearImpulse.x = this.linearImpulse.y = 0;
      this.motorImpulse = this.lowerImpulse = this.upperImpulse = this.angularImpulse = 0;
    }
  }

  warmStart() {
    this.currentAnchors();
    const axial = this.motorImpulse + this.lowerImpulse - this.upperImpulse + this.angularImpulse;
    const A = this.bodyA;
    const B = this.bodyB;
    const px = this.linearImpulse.x;
    const py = this.linearImpulse.y;
    A.vx -= this.mA * px;
    A.vy -= this.mA * py;
    A.w -= this.iA * (this.rAx * py - this.rAy * px + axial);
    B.vx += this.mB * px;
    B.vy += this.mB * py;
    B.w += this.iB * (this.rBx * py - this.rBy * px + axial);
  }

  solve(h, invH, useBias) {
    const A = this.bodyA;
    const B = this.bodyB;
    const { mA, mB, iA, iB } = this;
    const fixedRotation = iA + iB === 0;
    // motor
    if (this.enableMotor && !fixedRotation && !this.lockAngle) {
      const cdot = B.w - A.w - this.motorSpeed;
      let impulse = -this.axialMass * cdot;
      const old = this.motorImpulse;
      const maxI = this.maxMotorTorque * h;
      this.motorImpulse = Math.max(-maxI, Math.min(old + impulse, maxI));
      impulse = this.motorImpulse - old;
      A.w -= iA * impulse;
      B.w += iB * impulse;
    }
    const jointAngle = this.deltaAngle + B.dq - A.dq;
    if (this.lockAngle && !fixedRotation) {
      let bias = 0;
      let ms = 1;
      let is = 0;
      if (useBias) {
        bias = this.soft.biasRate * jointAngle;
        ms = this.soft.massScale;
        is = this.soft.impulseScale;
      }
      const cdot = B.w - A.w;
      const impulse = -this.axialMass * ms * (cdot + bias) - is * this.angularImpulse;
      this.angularImpulse += impulse;
      A.w -= iA * impulse;
      B.w += iB * impulse;
    } else if (this.enableLimit && !fixedRotation) {
      // lower
      {
        const C = jointAngle - this.lowerAngle;
        let bias = 0;
        let ms = 1;
        let is = 0;
        if (C > 0) bias = C * invH;
        else if (useBias) {
          bias = this.soft.biasRate * C;
          ms = this.soft.massScale;
          is = this.soft.impulseScale;
        }
        const cdot = B.w - A.w;
        let impulse = -this.axialMass * ms * (cdot + bias) - is * this.lowerImpulse;
        const ni = Math.max(this.lowerImpulse + impulse, 0);
        impulse = ni - this.lowerImpulse;
        this.lowerImpulse = ni;
        A.w -= iA * impulse;
        B.w += iB * impulse;
      }
      {
        const C = this.upperAngle - jointAngle;
        let bias = 0;
        let ms = 1;
        let is = 0;
        if (C > 0) bias = C * invH;
        else if (useBias) {
          bias = this.soft.biasRate * C;
          ms = this.soft.massScale;
          is = this.soft.impulseScale;
        }
        const cdot = A.w - B.w;
        let impulse = -this.axialMass * ms * (cdot + bias) - is * this.upperImpulse;
        const ni = Math.max(this.upperImpulse + impulse, 0);
        impulse = ni - this.upperImpulse;
        this.upperImpulse = ni;
        A.w += iA * impulse;
        B.w -= iB * impulse;
      }
    }
    // point-to-point
    this.currentAnchors();
    const { rAx, rAy, rBx, rBy } = this;
    const cdx = (B.vx - B.w * rBy) - (A.vx - A.w * rAy);
    const cdy = (B.vy + B.w * rBx) - (A.vy + A.w * rAx);
    let bx = 0;
    let by = 0;
    let ms = 1;
    let is = 0;
    if (useBias) {
      const sx = (B.dpx - A.dpx) + (rBx - rAx) + this.dcx;
      const sy = (B.dpy - A.dpy) + (rBy - rAy) + this.dcy;
      bx = this.soft.biasRate * sx;
      by = this.soft.biasRate * sy;
      ms = this.soft.massScale;
      is = this.soft.impulseScale;
    }
    const k11 = mA + mB + rAy * rAy * iA + rBy * rBy * iB;
    const k12 = -rAy * rAx * iA - rBy * rBx * iB;
    const k22 = mA + mB + rAx * rAx * iA + rBx * rBx * iB;
    let det = k11 * k22 - k12 * k12;
    if (Math.abs(det) < 1e-14) return;
    det = 1 / det;
    const r1 = cdx + bx;
    const r2 = cdy + by;
    const sx = det * (k22 * r1 - k12 * r2);
    const sy = det * (k11 * r2 - k12 * r1);
    const ix = -ms * sx - is * this.linearImpulse.x;
    const iy = -ms * sy - is * this.linearImpulse.y;
    this.linearImpulse.x += ix;
    this.linearImpulse.y += iy;
    this.applyLinear(ix, iy);
  }

  finish(h) {
    this.force = Math.hypot(this.linearImpulse.x, this.linearImpulse.y) / h;
    this.torque = (this.motorImpulse + this.angularImpulse + this.lowerImpulse - this.upperImpulse) / h;
  }
}

// ---------------------------------------------------------------------------
export class DistanceJoint extends Joint {
  constructor(bodyA, bodyB, opts = {}) {
    super('distance', bodyA, bodyB, opts);
    this.mode = opts.mode || 'rod'; // rod | rope | spring | bungee
    const pa = this.anchorA();
    const pb = this.anchorB();
    const cur = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    this.length = opts.length ?? cur; // rest length / max length
    this.k = opts.k ?? 50; // N/m
    this.c = opts.c ?? 0.5; // N*s/m
    this.coils = opts.coils ?? 12;
    this.impulse = 0;
    this.upperImpulse = 0;
    this.springImpulse = 0;
  }

  get kind() {
    return this.mode;
  }

  currentLength() {
    const pa = this.anchorA();
    const pb = this.anchorB();
    return Math.hypot(pb.x - pa.x, pb.y - pa.y);
  }

  prepare(h, ctx) {
    this.bodiesFor();
    this.prepareFrames();
    const dx = this.dcx + this.rB0x - this.rA0x;
    const dy = this.dcy + this.rB0y - this.rA0y;
    const l = Math.hypot(dx, dy) || 1e-9;
    const ax = dx / l;
    const ay = dy / l;
    const crA = this.rA0x * ay - this.rA0y * ax;
    const crB = this.rB0x * ay - this.rB0y * ax;
    const k = this.mA + this.mB + this.iA * crA * crA + this.iB * crB * crB;
    this.axialMass = k > 0 ? 1 / k : 0;
    this.invAxial = k;
    this.soft = ctx.jointSoftness;
    const denom = this.c + h * this.k;
    // light springs use symplectic (energy conserving) explicit integration;
    // stiff ones fall back to the unconditionally stable implicit form
    const omegaH = Math.sqrt(Math.max(0, this.k * k)) * h;
    this.explicit = (this.mode === 'spring' || this.mode === 'bungee') && omegaH < 0.5 && this.c * h * k < 0.5;
    this.explicitImpulse = 0;
    if (this.explicit) this.springImpulse = 0;
    if ((this.mode === 'spring' || this.mode === 'bungee') && denom > 0) {
      this.gamma = 1 / (h * denom);
      this.biasCoef = this.k / denom;
    } else {
      this.gamma = 0;
      this.biasCoef = 0;
    }
    if (!ctx.warmStart) {
      this.impulse = this.upperImpulse = this.springImpulse = 0;
    }
    if (this.mode !== 'rod') this.impulse = 0;
    if (this.mode !== 'rope') this.upperImpulse = 0;
    if (this.mode !== 'spring' && this.mode !== 'bungee') this.springImpulse = 0;
  }

  axis() {
    const A = this.bodyA;
    const B = this.bodyB;
    const dx = (B.dpx - A.dpx) + this.dcx + this.rBx - this.rAx;
    const dy = (B.dpy - A.dpy) + this.dcy + this.rBy - this.rAy;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) return { ax: 1, ay: 0, l: 0 };
    return { ax: dx / l, ay: dy / l, l };
  }

  warmStart() {
    this.currentAnchors();
    const { ax, ay } = this.axis();
    const total = this.impulse + this.springImpulse - this.upperImpulse;
    this.applyLinear(total * ax, total * ay);
  }

  solve(h, invH, useBias) {
    const A = this.bodyA;
    const B = this.bodyB;
    this.currentAnchors();
    const { ax, ay, l } = this.axis();
    const { rAx, rAy, rBx, rBy } = this;
    const dvx = (B.vx - B.w * rBy) - (A.vx - A.w * rAy);
    const dvy = (B.vy + B.w * rBx) - (A.vy + A.w * rAx);
    const vr = dvx * ax + dvy * ay;
    if (this.axialMass === 0) return;
    if (this.mode === 'spring' || this.mode === 'bungee') {
      // one-way band (slingshot): no force once the body passed the rest point
      if (this.oneWay && ax * this.oneWay.x + ay * this.oneWay.y > 0) {
        this.springImpulse = 0;
        return;
      }
      if (!useBias) return; // springs are physical forces: solve once per sub-step
      const C = l - this.length;
      if (this.explicit) {
        let impulse = -(this.k * C + this.c * vr) * h;
        if (this.mode === 'bungee' && (C <= 0 || impulse > 0)) impulse = C <= 0 ? 0 : Math.min(impulse, 0);
        this.explicitImpulse = impulse;
        this.applyLinear(impulse * ax, impulse * ay);
        return;
      }
      const bias = C * this.biasCoef;
      let impulse = -(vr + bias + this.gamma * this.springImpulse) / (this.invAxial + this.gamma);
      let ni = this.springImpulse + impulse;
      if (this.mode === 'bungee' && ni > 0) ni = 0;
      impulse = ni - this.springImpulse;
      this.springImpulse = ni;
      this.applyLinear(impulse * ax, impulse * ay);
    } else if (this.mode === 'rope') {
      const C = this.length - l;
      let bias = 0;
      let ms = 1;
      let is = 0;
      if (C > 0) bias = C * invH;
      else if (useBias) {
        bias = this.soft.biasRate * C;
        ms = this.soft.massScale;
        is = this.soft.impulseScale;
      }
      let impulse = -ms * this.axialMass * (-vr + bias) - is * this.upperImpulse;
      const ni = Math.max(0, this.upperImpulse + impulse);
      impulse = ni - this.upperImpulse;
      this.upperImpulse = ni;
      this.applyLinear(-impulse * ax, -impulse * ay);
    } else {
      const C = l - this.length;
      let bias = 0;
      let ms = 1;
      let is = 0;
      if (useBias) {
        bias = this.soft.biasRate * C;
        ms = this.soft.massScale;
        is = this.soft.impulseScale;
      }
      const impulse = -ms * this.axialMass * (vr + bias) - is * this.impulse;
      this.impulse += impulse;
      this.applyLinear(impulse * ax, impulse * ay);
    }
  }

  isSlack() {
    return (this.mode === 'rope' || this.mode === 'bungee') && this.currentLength() < this.length - 0.002;
  }

  finish(h) {
    // positive = tension
    const t = -(this.impulse + this.springImpulse + (this.explicit ? this.explicitImpulse : 0)) + this.upperImpulse;
    this.tension = t / h;
    this.force = Math.abs(this.tension);
  }

  energy() {
    if (this.mode !== 'spring' && this.mode !== 'bungee') return 0;
    const x = this.currentLength() - this.length;
    if (this.mode === 'bungee' && x < 0) return 0;
    return 0.5 * this.k * x * x;
  }
}

// ---------------------------------------------------------------------------
// Ideal pulley: |pA - gA| + ratio * |pB - gB| <= constant. Rope only pulls.
export class PulleyJoint extends Joint {
  constructor(bodyA, bodyB, opts = {}) {
    super('pulley', bodyA, bodyB, opts);
    this.groundA = { ...opts.groundA };
    this.groundB = { ...opts.groundB };
    this.ratio = opts.ratio ?? 1;
    this.wheelRadius = opts.wheelRadius ?? 0.15;
    const pa = this.anchorA();
    const pb = this.anchorB();
    const la = Math.hypot(pa.x - this.groundA.x, pa.y - this.groundA.y);
    const lb = Math.hypot(pb.x - this.groundB.x, pb.y - this.groundB.y);
    this.constant = opts.constant ?? la + this.ratio * lb;
    this.impulse = 0;
  }

  get kind() {
    return 'pulley';
  }

  prepare(h, ctx) {
    this.bodiesFor();
    this.prepareFrames();
    this.soft = ctx.jointSoftness;
    if (!ctx.warmStart) this.impulse = 0;
  }

  geometry() {
    const A = this.bodyA;
    const B = this.bodyB;
    // body positions are integrated every sub-step, so A.x is current
    const ax = (A.x + this.rAx) - this.groundA.x;
    const ay = (A.y + this.rAy) - this.groundA.y;
    const bx = (B.x + this.rBx) - this.groundB.x;
    const by = (B.y + this.rBy) - this.groundB.y;
    const la = Math.hypot(ax, ay) || 1e-9;
    const lb = Math.hypot(bx, by) || 1e-9;
    return { uax: ax / la, uay: ay / la, ubx: bx / lb, uby: by / lb, la, lb };
  }

  warmStart() {
    this.currentAnchors();
    const g = this.geometry();
    this.applyPulley(this.impulse, g);
  }

  applyPulley(impulse, g) {
    const A = this.bodyA;
    const B = this.bodyB;
    const pax = -impulse * g.uax;
    const pay = -impulse * g.uay;
    const pbx = -this.ratio * impulse * g.ubx;
    const pby = -this.ratio * impulse * g.uby;
    A.vx += this.mA * pax;
    A.vy += this.mA * pay;
    A.w += this.iA * (this.rAx * pay - this.rAy * pax);
    B.vx += this.mB * pbx;
    B.vy += this.mB * pby;
    B.w += this.iB * (this.rBx * pby - this.rBy * pbx);
  }

  solve(h, invH, useBias) {
    const A = this.bodyA;
    const B = this.bodyB;
    this.currentAnchors();
    const g = this.geometry();
    const { rAx, rAy, rBx, rBy } = this;
    const crA = rAx * g.uay - rAy * g.uax;
    const crB = rBx * g.uby - rBy * g.ubx;
    const k = this.mA + this.iA * crA * crA + this.ratio * this.ratio * (this.mB + this.iB * crB * crB);
    if (k <= 0) return;
    const mass = 1 / k;
    const vpAx = A.vx - A.w * rAy;
    const vpAy = A.vy + A.w * rAx;
    const vpBx = B.vx - B.w * rBy;
    const vpBy = B.vy + B.w * rBx;
    const cdot = -(g.uax * vpAx + g.uay * vpAy) - this.ratio * (g.ubx * vpBx + g.uby * vpBy);
    const C = this.constant - g.la - this.ratio * g.lb;
    let bias = 0;
    let ms = 1;
    let is = 0;
    if (C > 0) bias = C * invH;
    else if (useBias) {
      bias = this.soft.biasRate * C;
      ms = this.soft.massScale;
      is = this.soft.impulseScale;
    }
    let impulse = -ms * mass * (cdot + bias) - is * this.impulse;
    const ni = Math.max(0, this.impulse + impulse);
    impulse = ni - this.impulse;
    this.impulse = ni;
    this.applyPulley(impulse, g);
  }

  finish(h) {
    this.tension = this.impulse / h;
    this.force = this.tension;
  }
}

// ---------------------------------------------------------------------------
// Prismatic / rail: body B slides along an axis fixed in body A.
export class PrismaticJoint extends Joint {
  constructor(bodyA, bodyB, opts = {}) {
    super('prismatic', bodyA, bodyB, opts);
    const ax = opts.axis || { x: 1, y: 0 }; // world axis at creation
    const l = Math.hypot(ax.x, ax.y) || 1;
    // store in A's local frame
    const A = bodyA;
    this.localAxis = opts.localAxis || { x: (A.c * ax.x + A.s * ax.y) / l, y: (-A.s * ax.x + A.c * ax.y) / l };
    this.referenceAngle = opts.referenceAngle ?? (bodyB.angle - bodyA.angle);
    this.lockRotation = opts.lockRotation ?? true;
    this.enableLimit = !!opts.enableLimit;
    this.lower = opts.lower ?? -1;
    this.upper = opts.upper ?? 1;
    this.perpImpulse = 0;
    this.angularImpulse = 0;
    this.lowerImpulse = 0;
    this.upperImpulse = 0;
  }

  get kind() {
    return 'rail';
  }

  prepare(h, ctx) {
    this.bodiesFor();
    this.prepareFrames();
    const A = this.bodyA;
    const B = this.bodyB;
    [this.ax0, this.ay0] = rotV(A.c, A.s, this.localAxis.x, this.localAxis.y);
    this.deltaAngle = wrap(B.angle - A.angle - this.referenceAngle);
    const k = this.iA + this.iB;
    this.axialMass = k > 0 ? 1 / k : 0;
    this.soft = ctx.jointSoftness;
    if (!ctx.warmStart) this.perpImpulse = this.angularImpulse = this.lowerImpulse = this.upperImpulse = 0;
  }

  frame() {
    const A = this.bodyA;
    const B = this.bodyB;
    const ca = Math.cos(A.dq);
    const sa = Math.sin(A.dq);
    const ax = ca * this.ax0 - sa * this.ay0;
    const ay = sa * this.ax0 + ca * this.ay0;
    const dx = (B.dpx - A.dpx) + this.dcx + this.rBx - this.rAx;
    const dy = (B.dpy - A.dpy) + this.dcy + this.rBy - this.rAy;
    return { ax, ay, px: -ay, py: ax, dx, dy };
  }

  warmStart() {
    this.currentAnchors();
    const f = this.frame();
    const A = this.bodyA;
    const B = this.bodyB;
    const s1 = (f.dx + this.rAx) * f.py - (f.dy + this.rAy) * f.px;
    const s2 = this.rBx * f.py - this.rBy * f.px;
    const a1 = (f.dx + this.rAx) * f.ay - (f.dy + this.rAy) * f.ax;
    const a2 = this.rBx * f.ay - this.rBy * f.ax;
    const axial = this.lowerImpulse - this.upperImpulse;
    const Px = this.perpImpulse * f.px + axial * f.ax;
    const Py = this.perpImpulse * f.py + axial * f.ay;
    const LA = this.perpImpulse * s1 + axial * a1 + this.angularImpulse;
    const LB = this.perpImpulse * s2 + axial * a2 + this.angularImpulse;
    A.vx -= this.mA * Px;
    A.vy -= this.mA * Py;
    A.w -= this.iA * LA;
    B.vx += this.mB * Px;
    B.vy += this.mB * Py;
    B.w += this.iB * LB;
  }

  solve(h, invH, useBias) {
    const A = this.bodyA;
    const B = this.bodyB;
    const { mA, mB, iA, iB } = this;
    this.currentAnchors();
    // angular lock
    if (this.lockRotation && iA + iB > 0) {
      const C = this.deltaAngle + B.dq - A.dq;
      let bias = 0;
      let ms = 1;
      let is = 0;
      if (useBias) {
        bias = this.soft.biasRate * C;
        ms = this.soft.massScale;
        is = this.soft.impulseScale;
      }
      const impulse = -this.axialMass * ms * (B.w - A.w + bias) - is * this.angularImpulse;
      this.angularImpulse += impulse;
      A.w -= iA * impulse;
      B.w += iB * impulse;
    }
    const f = this.frame();
    // limits along axis
    if (this.enableLimit) {
      const a1 = (f.dx + this.rAx) * f.ay - (f.dy + this.rAy) * f.ax;
      const a2 = this.rBx * f.ay - this.rBy * f.ax;
      const k = mA + mB + iA * a1 * a1 + iB * a2 * a2;
      const am = k > 0 ? 1 / k : 0;
      const trans = f.ax * f.dx + f.ay * f.dy;
      for (let side = 0; side < 2; side++) {
        const C = side === 0 ? trans - this.lower : this.upper - trans;
        let bias = 0;
        let ms = 1;
        let is = 0;
        if (C > 0) bias = C * invH;
        else if (useBias) {
          bias = this.soft.biasRate * C;
          ms = this.soft.massScale;
          is = this.soft.impulseScale;
        }
        const sign = side === 0 ? 1 : -1;
        const cdot = sign * (f.ax * (B.vx - A.vx) + f.ay * (B.vy - A.vy) + a2 * B.w - a1 * A.w);
        const acc = side === 0 ? this.lowerImpulse : this.upperImpulse;
        let impulse = -am * ms * (cdot + bias) - is * acc;
        const ni = Math.max(0, acc + impulse);
        impulse = ni - acc;
        if (side === 0) this.lowerImpulse = ni;
        else this.upperImpulse = ni;
        const s = sign * impulse;
        A.vx -= mA * s * f.ax;
        A.vy -= mA * s * f.ay;
        A.w -= iA * s * a1;
        B.vx += mB * s * f.ax;
        B.vy += mB * s * f.ay;
        B.w += iB * s * a2;
      }
    }
    // perpendicular constraint
    const s1 = (f.dx + this.rAx) * f.py - (f.dy + this.rAy) * f.px;
    const s2 = this.rBx * f.py - this.rBy * f.px;
    const k = mA + mB + iA * s1 * s1 + iB * s2 * s2;
    if (k <= 0) return;
    const C = f.px * f.dx + f.py * f.dy;
    let bias = 0;
    let ms = 1;
    let is = 0;
    if (useBias) {
      bias = this.soft.biasRate * C;
      ms = this.soft.massScale;
      is = this.soft.impulseScale;
    }
    const cdot = f.px * (B.vx - A.vx) + f.py * (B.vy - A.vy) + s2 * B.w - s1 * A.w;
    const impulse = -ms * (cdot + bias) / k - is * this.perpImpulse;
    this.perpImpulse += impulse;
    A.vx -= mA * impulse * f.px;
    A.vy -= mA * impulse * f.py;
    A.w -= iA * impulse * s1;
    B.vx += mB * impulse * f.px;
    B.vy += mB * impulse * f.py;
    B.w += iB * impulse * s2;
  }

  finish(h) {
    this.force = Math.abs(this.perpImpulse) / h;
  }
}

// ---------------------------------------------------------------------------
export class MouseJoint extends Joint {
  constructor(ground, body, opts = {}) {
    super('mouse', ground, body, opts);
    this.target = { ...opts.target };
    this.hertz = opts.hertz ?? 5;
    this.damping = opts.damping ?? 0.9;
    this.maxForce = opts.maxForce ?? 1000 * Math.max(body.mass, 0.1);
    this.linearImpulse = { x: 0, y: 0 };
    this.angularImpulse = 0;
    this.collideConnected = true;
  }

  get kind() {
    return 'mouse';
  }

  prepare(h) {
    const B = this.bodyB;
    this.mA = 0;
    this.iA = 0;
    this.mB = B.invMass;
    this.iB = B.invI;
    [this.rB0x, this.rB0y] = rotV(B.c, B.s, this.localB.x, this.localB.y);
    this.rA0x = 0;
    this.rA0y = 0;
    this.dcx = B.x - this.target.x;
    this.dcy = B.y - this.target.y;
    this.linSoft = makeSoft(this.hertz, this.damping, h);
    this.angSoft = makeSoft(this.hertz * 0.5, 1, h);
    this.linearImpulse.x = this.linearImpulse.y = 0;
    this.angularImpulse = 0;
  }

  warmStart() {}

  solve(h) {
    const B = this.bodyB;
    if (!B.awake) B.wake();
    const cb = Math.cos(B.dq);
    const sb = Math.sin(B.dq);
    const rBx = cb * this.rB0x - sb * this.rB0y;
    const rBy = sb * this.rB0x + cb * this.rB0y;
    this.rAx = this.rAy = 0;
    this.rBx = rBx;
    this.rBy = rBy;
    // angular damping so dragged bodies don't spin forever
    if (this.iB > 0) {
      const am = 1 / this.iB;
      const impulse = -am * this.angSoft.massScale * B.w * 0.05 - this.angSoft.impulseScale * this.angularImpulse;
      this.angularImpulse += impulse;
      B.w += this.iB * impulse;
    }
    const sx = B.dpx + rBx + this.dcx - this.rB0x * 0;
    const sy = B.dpy + rBy + this.dcy;
    const soft = this.linSoft;
    const bx = soft.biasRate * sx;
    const by = soft.biasRate * sy;
    const cdx = B.vx - B.w * rBy;
    const cdy = B.vy + B.w * rBx;
    const mB = this.mB;
    const iB = this.iB;
    const k11 = mB + rBy * rBy * iB;
    const k12 = -rBy * rBx * iB;
    const k22 = mB + rBx * rBx * iB;
    let det = k11 * k22 - k12 * k12;
    if (Math.abs(det) < 1e-14) return;
    det = 1 / det;
    const r1 = cdx + bx;
    const r2 = cdy + by;
    let ix = -soft.massScale * det * (k22 * r1 - k12 * r2) - soft.impulseScale * this.linearImpulse.x;
    let iy = -soft.massScale * det * (k11 * r2 - k12 * r1) - soft.impulseScale * this.linearImpulse.y;
    const ox = this.linearImpulse.x;
    const oy = this.linearImpulse.y;
    let nx = ox + ix;
    let ny = oy + iy;
    const maxI = this.maxForce * h;
    const l = Math.hypot(nx, ny);
    if (l > maxI) {
      nx *= maxI / l;
      ny *= maxI / l;
    }
    ix = nx - ox;
    iy = ny - oy;
    this.linearImpulse.x = nx;
    this.linearImpulse.y = ny;
    B.vx += mB * ix;
    B.vy += mB * iy;
    B.w += iB * (rBx * iy - rBy * ix);
  }

  finish(h) {
    this.force = Math.hypot(this.linearImpulse.x, this.linearImpulse.y) / h;
  }
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
