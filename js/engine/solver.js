// Contact constraint solver using a sub-stepped "soft step" scheme
// (solve with soft position bias, integrate, relax without bias, then apply
// restitution) in the spirit of Box2D v3.

export function makeSoft(hertz, zeta, h) {
  if (hertz === 0) return { biasRate: 0, massScale: 1, impulseScale: 0 };
  const omega = 2 * Math.PI * hertz;
  const a1 = 2 * zeta + h * omega;
  const a2 = h * omega * a1;
  const a3 = 1 / (1 + a2);
  return { biasRate: omega / a1, massScale: a2 * a3, impulseScale: a3 };
}

export class Contact {
  constructor(shapeA, shapeB, key) {
    this.key = key;
    this.shapeA = shapeA;
    this.shapeB = shapeB;
    this.bodyA = shapeA.body;
    this.bodyB = shapeB.body;
    this.nx = 0;
    this.ny = 0;
    this.points = [];
    this.touching = false;
    this.stamp = 0;
    this.restitution = 0;
    this.staticFriction = 0;
    this.friction = 0;
    this.tangentSpeed = 0;
    this.soft = null;
  }
}

// Update manifold, keeping accumulated impulses of matching points.
export function updateManifold(contact, manifold) {
  const old = contact.points;
  const pts = [];
  contact.nx = manifold.nx;
  contact.ny = manifold.ny;
  let touching = false;
  for (const mp of manifold.points) {
    const cp = {
      x: mp.x, y: mp.y, sep: mp.sep, id: mp.id,
      rAx: 0, rAy: 0, rBx: 0, rBy: 0, adjSep: 0,
      normalImpulse: 0, tangentImpulse: 0, maxNormalImpulse: 0,
      normalMass: 0, tangentMass: 0, relVel: 0, friction: 0,
    };
    for (const o of old) {
      if (o.id === mp.id) {
        cp.normalImpulse = o.normalImpulse;
        cp.tangentImpulse = o.tangentImpulse;
        break;
      }
    }
    if (mp.sep < 0.0) touching = true;
    pts.push(cp);
  }
  contact.points = pts;
  contact.touching = touching;
}

export function prepareContacts(contacts, h, cfg) {
  const contactHertz = Math.min(cfg.contactHertz, 0.25 / h);
  const soft = makeSoft(contactHertz, cfg.contactDampingRatio, h);
  const staticSoft = makeSoft(2 * contactHertz, cfg.contactDampingRatio, h);
  for (const c of contacts) {
    const A = c.bodyA;
    const B = c.bodyB;
    const mA = A.awake ? A.invMass : 0;
    const iA = A.awake ? A.invI : 0;
    const mB = B.awake ? B.invMass : 0;
    const iB = B.awake ? B.invI : 0;
    c.mA = mA;
    c.iA = iA;
    c.mB = mB;
    c.iB = iB;
    c.soft = (A.type !== 'dynamic' || B.type !== 'dynamic') ? staticSoft : soft;
    const matA = A.material;
    const matB = B.material;
    c.staticFriction = mixFriction(matA.staticFriction, matB.staticFriction, cfg.frictionMix);
    c.friction = mixFriction(matA.friction, matB.friction, cfg.frictionMix);
    c.restitution = mixRestitution(matA.restitution, matB.restitution, cfg.restitutionMix);
    c.tangentSpeed = -(A.surfaceSpeed || 0) - (B.surfaceSpeed || 0);
    const nx = c.nx;
    const ny = c.ny;
    const tx = ny;
    const ty = -nx;
    for (const cp of c.points) {
      const rAx = cp.x - A.x;
      const rAy = cp.y - A.y;
      const rBx = cp.x - B.x;
      const rBy = cp.y - B.y;
      cp.rAx = rAx;
      cp.rAy = rAy;
      cp.rBx = rBx;
      cp.rBy = rBy;
      cp.adjSep = cp.sep - ((rBx - rAx) * nx + (rBy - rAy) * ny);
      const rnA = rAx * ny - rAy * nx;
      const rnB = rBx * ny - rBy * nx;
      const kN = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
      cp.normalMass = kN > 0 ? 1 / kN : 0;
      const rtA = rAx * ty - rAy * tx;
      const rtB = rBx * ty - rBy * tx;
      const kT = mA + mB + iA * rtA * rtA + iB * rtB * rtB;
      cp.tangentMass = kT > 0 ? 1 / kT : 0;
      // relative velocity at the start of the step
      const dvx = (B.vx - B.w * rBy) - (A.vx - A.w * rAy);
      const dvy = (B.vy + B.w * rBx) - (A.vy + A.w * rAx);
      cp.relVel = dvx * nx + dvy * ny;
      const vt = dvx * tx + dvy * ty + c.tangentSpeed;
      // static friction applies while the surfaces are (nearly) at rest
      cp.friction = Math.abs(vt) < cfg.staticSpeed ? Math.max(c.staticFriction, c.friction) : c.friction;
      cp.maxNormalImpulse = 0;
    }
  }
}

function mixFriction(a, b, mode) {
  switch (mode) {
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    case 'avg': return (a + b) / 2;
    default: return Math.sqrt(Math.max(a, 0) * Math.max(b, 0));
  }
}

function mixRestitution(a, b, mode) {
  switch (mode) {
    case 'min': return Math.min(a, b);
    case 'avg': return (a + b) / 2;
    case 'mul': return a * b;
    default: return Math.max(a, b);
  }
}

export function warmStartContacts(contacts) {
  for (const c of contacts) {
    const A = c.bodyA;
    const B = c.bodyB;
    const { mA, iA, mB, iB } = c;
    const nx = c.nx;
    const ny = c.ny;
    const tx = ny;
    const ty = -nx;
    for (const cp of c.points) {
      const px = cp.normalImpulse * nx + cp.tangentImpulse * tx;
      const py = cp.normalImpulse * ny + cp.tangentImpulse * ty;
      A.vx -= mA * px;
      A.vy -= mA * py;
      A.w -= iA * (cp.rAx * py - cp.rAy * px);
      B.vx += mB * px;
      B.vy += mB * py;
      B.w += iB * (cp.rBx * py - cp.rBy * px);
    }
  }
}

export function solveContacts(contacts, invH, useBias, cfg) {
  const maxBiasVel = cfg.pushoutVelocity;
  for (const c of contacts) {
    const A = c.bodyA;
    const B = c.bodyB;
    const { mA, iA, mB, iB } = c;
    const nx = c.nx;
    const ny = c.ny;
    const soft = c.soft;
    const dpx = B.dpx - A.dpx;
    const dpy = B.dpy - A.dpy;
    const cqA = Math.cos(A.dq);
    const sqA = Math.sin(A.dq);
    const cqB = Math.cos(B.dq);
    const sqB = Math.sin(B.dq);
    let totalNormal = 0;
    for (const cp of c.points) {
      // current separation from the anchors' displacement
      const prAx = cqA * cp.rAx - sqA * cp.rAy;
      const prAy = sqA * cp.rAx + cqA * cp.rAy;
      const prBx = cqB * cp.rBx - sqB * cp.rBy;
      const prBy = sqB * cp.rBx + cqB * cp.rBy;
      const s = (dpx + prBx - prAx) * nx + (dpy + prBy - prAy) * ny + cp.adjSep;
      let bias = 0;
      let massScale = 1;
      let impulseScale = 0;
      if (s > 0) {
        bias = s * invH; // speculative
      } else if (useBias) {
        bias = Math.max(soft.biasRate * s, -maxBiasVel);
        massScale = soft.massScale;
        impulseScale = soft.impulseScale;
      }
      const dvx = (B.vx - B.w * cp.rBy) - (A.vx - A.w * cp.rAy);
      const dvy = (B.vy + B.w * cp.rBx) - (A.vy + A.w * cp.rAx);
      const vn = dvx * nx + dvy * ny;
      let impulse = -cp.normalMass * massScale * (vn + bias) - impulseScale * cp.normalImpulse;
      const newImpulse = Math.max(cp.normalImpulse + impulse, 0);
      impulse = newImpulse - cp.normalImpulse;
      cp.normalImpulse = newImpulse;
      if (impulse > cp.maxNormalImpulse) cp.maxNormalImpulse = impulse;
      totalNormal += newImpulse;
      const px = impulse * nx;
      const py = impulse * ny;
      A.vx -= mA * px;
      A.vy -= mA * py;
      A.w -= iA * (cp.rAx * py - cp.rAy * px);
      B.vx += mB * px;
      B.vy += mB * py;
      B.w += iB * (cp.rBx * py - cp.rBy * px);
    }
    // friction
    const tx = ny;
    const ty = -nx;
    for (const cp of c.points) {
      const dvx = (B.vx - B.w * cp.rBy) - (A.vx - A.w * cp.rAy);
      const dvy = (B.vy + B.w * cp.rBx) - (A.vy + A.w * cp.rAx);
      const vt = dvx * tx + dvy * ty + c.tangentSpeed;
      let impulse = -cp.tangentMass * vt;
      const maxF = cp.friction * cp.normalImpulse;
      const newImpulse = Math.max(-maxF, Math.min(cp.tangentImpulse + impulse, maxF));
      impulse = newImpulse - cp.tangentImpulse;
      cp.tangentImpulse = newImpulse;
      const px = impulse * tx;
      const py = impulse * ty;
      A.vx -= mA * px;
      A.vy -= mA * py;
      A.w -= iA * (cp.rAx * py - cp.rAy * px);
      B.vx += mB * px;
      B.vy += mB * py;
      B.w += iB * (cp.rBx * py - cp.rBy * px);
    }
    c.totalNormal = totalNormal;
  }
}

export function applyRestitution(contacts, threshold) {
  for (const c of contacts) {
    if (c.restitution === 0) continue;
    const A = c.bodyA;
    const B = c.bodyB;
    const { mA, iA, mB, iB } = c;
    const nx = c.nx;
    const ny = c.ny;
    for (const cp of c.points) {
      if (cp.relVel > -threshold || cp.maxNormalImpulse === 0) continue;
      const dvx = (B.vx - B.w * cp.rBy) - (A.vx - A.w * cp.rAy);
      const dvy = (B.vy + B.w * cp.rBx) - (A.vy + A.w * cp.rAx);
      const vn = dvx * nx + dvy * ny;
      let impulse = -cp.normalMass * (vn + c.restitution * cp.relVel);
      const newImpulse = Math.max(cp.normalImpulse + impulse, 0);
      impulse = newImpulse - cp.normalImpulse;
      cp.normalImpulse = newImpulse;
      if (impulse > cp.maxNormalImpulse) cp.maxNormalImpulse = impulse;
      const px = impulse * nx;
      const py = impulse * ny;
      A.vx -= mA * px;
      A.vy -= mA * py;
      A.w -= iA * (cp.rAx * py - cp.rAy * px);
      B.vx += mB * px;
      B.vy += mB * py;
      B.w += iB * (cp.rBx * py - cp.rBy * px);
    }
  }
}

// Nonlinear Gauss-Seidel position correction (run once per step after the
// velocity solve). Removes residual penetration beyond the slop without
// adding velocity, which keeps tall stacks and large mass ratios solid.
export function correctPositions(contacts, iterations, slop, baumgarte, maxCorrection) {
  for (let it = 0; it < iterations; it++) {
    let worst = 0;
    for (const c of contacts) {
      const A = c.bodyA;
      const B = c.bodyB;
      const { mA, iA, mB, iB } = c;
      if (mA + mB === 0) continue;
      const nx = c.nx;
      const ny = c.ny;
      for (const cp of c.points) {
        const cqA = Math.cos(A.dq);
        const sqA = Math.sin(A.dq);
        const cqB = Math.cos(B.dq);
        const sqB = Math.sin(B.dq);
        const rAx = cqA * cp.rAx - sqA * cp.rAy;
        const rAy = sqA * cp.rAx + cqA * cp.rAy;
        const rBx = cqB * cp.rBx - sqB * cp.rBy;
        const rBy = sqB * cp.rBx + cqB * cp.rBy;
        const s = (B.dpx - A.dpx + rBx - rAx) * nx + (B.dpy - A.dpy + rBy - rAy) * ny + cp.adjSep;
        if (s < worst) worst = s;
        const C = Math.max(-maxCorrection, Math.min(0, baumgarte * (s + slop)));
        if (C >= 0) continue;
        const rnA = rAx * ny - rAy * nx;
        const rnB = rBx * ny - rBy * nx;
        const K = mA + mB + iA * rnA * rnA + iB * rnB * rnB;
        if (K <= 0) continue;
        const impulse = -C / K;
        const px = impulse * nx;
        const py = impulse * ny;
        const dax = -mA * px;
        const day = -mA * py;
        const daq = -iA * (rAx * py - rAy * px);
        const dbx = mB * px;
        const dby = mB * py;
        const dbq = iB * (rBx * py - rBy * px);
        A.x += dax; A.y += day; A.angle += daq; A.dpx += dax; A.dpy += day; A.dq += daq;
        B.x += dbx; B.y += dby; B.angle += dbq; B.dpx += dbx; B.dpy += dby; B.dq += dbq;
      }
    }
    if (worst >= -1.5 * slop) break;
  }
}
