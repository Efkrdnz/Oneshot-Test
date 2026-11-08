// Registry of editable entity kinds: listing, hit testing, handles, moving,
// deleting and naming. Shared by tools, renderer and inspector.

import { closestOnSegment } from '../engine/math.js';
import { serializeBody, serializeJoint } from '../lab/scene.js';
import { Body } from '../engine/body.js';
import { Pool } from '../engine/pools.js';
import { Gate, Timer, Ruler, Label } from '../engine/instruments.js';
import { Cannon, Slingshot, Emitter, Drain } from '../engine/devices.js';
import { Attractor, Fan } from '../engine/forces.js';
import { WaveString } from '../engine/wavestring.js';

export const KIND_INFO = {
  body: { list: 'bodies', label: 'Body', plural: 'Bodies', icon: 'box' },
  joint: { list: 'joints', label: 'Connector', icon: 'rope' },
  pool: { list: 'pools', label: 'Liquid pool', icon: 'pool' },
  gate: { list: 'gates', label: 'Photogate', icon: 'gate' },
  timer: { list: 'timers', label: 'Chronometer', icon: 'timer' },
  ruler: { list: 'rulers', label: 'Ruler', icon: 'ruler' },
  label: { list: 'labels', label: 'Text label', icon: 'label' },
  cannon: { list: 'cannons', label: 'Cannon', icon: 'cannon' },
  slingshot: { list: 'slingshots', label: 'Slingshot', icon: 'slingshot' },
  emitter: { list: 'emitters', label: 'Faucet', icon: 'faucet' },
  drain: { list: 'drains', label: 'Drain', icon: 'drain' },
  attractor: { list: 'attractors', label: 'Attractor', icon: 'attractor' },
  fan: { list: 'fans', label: 'Fan / wind zone', icon: 'fan' },
  wavestring: { list: 'waveStrings', label: 'Wave string', icon: 'wave' },
};

export function listOf(world, kind) {
  if (kind === 'body') return world.bodies.filter((b) => !b.room);
  if (kind === 'joint') return world.joints.filter((j) => !j.internal);
  return world[KIND_INFO[kind].list];
}

export function entityName(kind, obj) {
  if (!obj) return '';
  if (kind === 'body') return obj.name || bodyKindName(obj);
  if (kind === 'joint') return obj.name || jointKindName(obj);
  if (kind === 'label') return obj.text?.slice(0, 24) || 'Label';
  return obj.name || KIND_INFO[kind].label;
}

export function bodyKindName(b) {
  const names = { box: 'Box', circle: 'Ball', ngon: 'Polygon', wedge: 'Wedge', poly: 'Shape', container: 'Cup', tank: 'Sealed tank', boat: 'Boat', track: 'Track', capsule: 'Capsule', compound: 'Compound' };
  return names[b.geom.kind] || 'Body';
}

export function jointKindName(j) {
  const k = j.kind;
  const names = { pin: 'Pin / hinge', motor: 'Motor', weld: 'Weld', rod: 'Rod', rope: 'String', spring: 'Spring', bungee: 'Elastic band', pulley: 'Pulley', rail: 'Rail', mouse: 'Drag' };
  return names[k] || 'Connector';
}

export function jointIcon(j) {
  const map = { pin: 'pin', motor: 'motor', weld: 'weld', rod: 'rod', rope: 'rope', spring: 'spring', bungee: 'bungee', pulley: 'pulley', rail: 'rail' };
  return map[j.kind] || 'rope';
}

export function entityCenter(kind, o) {
  switch (kind) {
    case 'body': return { x: o.x, y: o.y };
    case 'joint': {
      const a = o.anchorA();
      const b = o.anchorB();
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    case 'pool': return { x: (o.x0 + o.x1) / 2, y: (o.bottom + o.level) / 2 };
    case 'gate':
    case 'ruler':
    case 'wavestring': return { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 };
    default: return { x: o.x, y: o.y };
  }
}

function segDist(px, py, x1, y1, x2, y2) {
  const c = closestOnSegment(px, py, x1, y1, x2, y2);
  return Math.hypot(px - c.x, py - c.y);
}

// Returns the top-most entity under (wx, wy) or null. tol in metres.
export function hitTest(app, wx, wy, tol, filter) {
  const w = app.world;
  const cam = app.camera;
  const ok = (k) => !filter || filter.includes(k);
  // timers: screen-space boxes
  if (ok('timer')) {
    const s = cam.toScreen(wx, wy);
    for (let i = w.timers.length - 1; i >= 0; i--) {
      const t = w.timers[i];
      const p = cam.toScreen(t.x, t.y);
      if (Math.abs(s.x - p.x) < 70 && Math.abs(s.y - p.y) < 26) return { kind: 'timer', obj: t };
    }
  }
  if (ok('label')) {
    for (let i = w.labels.length - 1; i >= 0; i--) {
      const l = w.labels[i];
      const fs = Math.max(9, l.size * cam.scale);
      const halfW = (l.text.length * fs * 0.3) / cam.scale;
      const halfH = (fs * 0.6) / cam.scale;
      if (Math.abs(wx - l.x) < halfW + tol && Math.abs(wy - l.y) < halfH + tol) return { kind: 'label', obj: l };
    }
  }
  if (ok('gate')) for (let i = w.gates.length - 1; i >= 0; i--) {
    const g = w.gates[i];
    if (segDist(wx, wy, g.x1, g.y1, g.x2, g.y2) < tol * 1.3) return { kind: 'gate', obj: g };
  }
  if (ok('ruler')) for (let i = w.rulers.length - 1; i >= 0; i--) {
    const r = w.rulers[i];
    if (segDist(wx, wy, r.x1, r.y1, r.x2, r.y2) < tol * 1.5) return { kind: 'ruler', obj: r };
  }
  if (ok('cannon')) for (const c of w.cannons) {
    const m = c.muzzle();
    if (Math.hypot(wx - c.x, wy - c.y) < 0.45 + tol || segDist(wx, wy, c.x, c.y, m.x, m.y) < 0.18 + tol) return { kind: 'cannon', obj: c };
  }
  if (ok('slingshot')) for (const s of w.slingshots) {
    if (Math.abs(wx - s.x) < s.fork / 2 + 0.25 && wy < s.y + 0.3 && wy > s.y - 1.6) return { kind: 'slingshot', obj: s };
  }
  if (ok('emitter')) for (const e of w.emitters) if (Math.hypot(wx - e.x, wy - e.y) < 0.35 + tol) return { kind: 'emitter', obj: e };
  if (ok('attractor')) for (const a of w.attractors) if (Math.hypot(wx - a.x, wy - a.y) < Math.max(0.4, a.radius) + tol) return { kind: 'attractor', obj: a };
  if (ok('wavestring')) for (const s of w.waveStrings) {
    if (segDist(wx, wy, s.x1, s.y1, s.x2, s.y2) < Math.max(tol * 1.5, s.driver.amplitude + tol)) return { kind: 'wavestring', obj: s };
  }
  if (ok('joint')) {
    for (let i = w.joints.length - 1; i >= 0; i--) {
      const j = w.joints[i];
      if (j.internal) continue;
      const a = j.anchorA();
      const b = j.anchorB();
      if (j.type === 'revolute') {
        if (Math.hypot(wx - b.x, wy - b.y) < tol * 1.2) return { kind: 'joint', obj: j };
      } else if (j.type === 'pulley') {
        if (segDist(wx, wy, a.x, a.y, j.groundA.x, j.groundA.y) < tol || segDist(wx, wy, b.x, b.y, j.groundB.x, j.groundB.y) < tol || segDist(wx, wy, j.groundA.x, j.groundA.y, j.groundB.x, j.groundB.y) < tol + j.wheelRadius) return { kind: 'joint', obj: j };
      } else if (j.type === 'prismatic') {
        if (Math.hypot(wx - b.x, wy - b.y) < tol * 1.2) return { kind: 'joint', obj: j };
      } else if (segDist(wx, wy, a.x, a.y, b.x, b.y) < tol) return { kind: 'joint', obj: j };
    }
  }
  if (ok('body')) {
    for (let i = w.bodies.length - 1; i >= 0; i--) {
      const b = w.bodies[i];
      if (b.room) continue;
      if (wx < b.aabb.minX - tol || wx > b.aabb.maxX + tol || wy < b.aabb.minY - tol || wy > b.aabb.maxY + tol) continue;
      if (b.containsPoint(wx, wy)) return { kind: 'body', obj: b };
    }
    // thin bodies: allow tolerance
    for (let i = w.bodies.length - 1; i >= 0; i--) {
      const b = w.bodies[i];
      if (b.room) continue;
      if (wx < b.aabb.minX - tol || wx > b.aabb.maxX + tol || wy < b.aabb.minY - tol || wy > b.aabb.maxY + tol) continue;
      for (const [dx, dy] of [[tol, 0], [-tol, 0], [0, tol], [0, -tol]]) if (b.containsPoint(wx + dx, wy + dy)) return { kind: 'body', obj: b };
    }
  }
  if (ok('fan')) for (const f of w.fans) if (f.windAt(wx, wy) || pointInFan(f, wx, wy)) return { kind: 'fan', obj: f };
  if (ok('drain')) for (const d of w.drains) if (Math.abs(wx - d.x) < d.w / 2 && Math.abs(wy - d.y) < d.h / 2) return { kind: 'drain', obj: d };
  if (ok('pool')) for (let i = w.pools.length - 1; i >= 0; i--) {
    const p = w.pools[i];
    if (wx >= p.x0 && wx <= p.x1 && wy >= p.bottom && wy <= p.surfaceAt(wx) + tol) return { kind: 'pool', obj: p };
  }
  return null;
}

function pointInFan(f, px, py) {
  const c = Math.cos(f.angle);
  const s = Math.sin(f.angle);
  const dx = px - f.x;
  const dy = py - f.y;
  const lx = c * dx + s * dy;
  const ly = -s * dx + c * dy;
  return lx >= 0 && lx <= f.w && Math.abs(ly) <= f.h / 2;
}

// Draggable handles for a selected entity.
export function handlesOf(kind, o, app) {
  const H = [];
  const after = () => app.onEntityGeometryChanged(kind, o);
  switch (kind) {
    case 'gate':
    case 'ruler':
    case 'wavestring':
      H.push({ x: o.x1, y: o.y1, set: (x, y) => { o.x1 = x; o.y1 = y; after(); } });
      H.push({ x: o.x2, y: o.y2, set: (x, y) => { o.x2 = x; o.y2 = y; after(); } });
      break;
    case 'pool':
      H.push({ x: o.x0, y: o.level, set: (x, y) => { o.x0 = Math.min(x, o.x1 - 0.2); o.level = Math.max(y, o.bottom + 0.1); o.resize(); after(); } });
      H.push({ x: o.x1, y: o.level, set: (x, y) => { o.x1 = Math.max(x, o.x0 + 0.2); o.level = Math.max(y, o.bottom + 0.1); o.resize(); after(); } });
      H.push({ x: o.x0, y: o.bottom, set: (x, y) => { o.x0 = Math.min(x, o.x1 - 0.2); o.bottom = Math.min(y, o.level - 0.1); o.resize(); after(); } });
      H.push({ x: o.x1, y: o.bottom, set: (x, y) => { o.x1 = Math.max(x, o.x0 + 0.2); o.bottom = Math.min(y, o.level - 0.1); o.resize(); after(); } });
      break;
    case 'drain':
      H.push({ x: o.x + o.w / 2, y: o.y + o.h / 2, set: (x, y) => { o.w = Math.max(0.2, 2 * Math.abs(x - o.x)); o.h = Math.max(0.1, 2 * Math.abs(y - o.y)); after(); } });
      break;
    case 'fan': {
      const c = Math.cos(f(o.angle));
      const s = Math.sin(f(o.angle));
      H.push({ x: o.x + c * o.w, y: o.y + s * o.w, set: (x, y) => { o.angle = Math.atan2(y - o.y, x - o.x); o.w = Math.max(0.3, Math.hypot(x - o.x, y - o.y)); after(); } });
      H.push({ x: o.x - s * o.h / 2, y: o.y + c * o.h / 2, set: (x, y) => { o.h = Math.max(0.2, 2 * Math.abs(-s * (x - o.x) + c * (y - o.y))); after(); } });
      break;
    }
    case 'cannon': {
      const m = o.muzzle();
      H.push({ x: m.x + m.dx * 0.25, y: m.y + m.dy * 0.25, set: (x, y) => { o.angle = Math.round((Math.atan2(y - o.y, x - o.x) * 180) / Math.PI * 10) / 10; after(); } });
      break;
    }
    case 'joint':
      if (o.type === 'pulley') {
        H.push({ x: o.groundA.x, y: o.groundA.y, set: (x, y) => { o.groundA.x = x; o.groundA.y = y; recomputePulley(o); after(); } });
        H.push({ x: o.groundB.x, y: o.groundB.y, set: (x, y) => { o.groundB.x = x; o.groundB.y = y; recomputePulley(o); after(); } });
      }
      if (o.type === 'distance' || o.type === 'revolute') {
        if (o.bodyA === app.world.ground) {
          const a = o.anchorA();
          H.push({ x: a.x, y: a.y, set: (x, y) => { o.localA.x = x; o.localA.y = y; if (o.type === 'distance' && o.mode !== 'spring' && o.mode !== 'bungee') o.length = o.currentLength(); after(); } });
        }
      }
      break;
    case 'attractor':
      H.push({ x: o.x + Math.max(0.4, o.radius), y: o.y, set: (x) => { o.radius = Math.max(0.05, x - o.x); after(); } });
      break;
    default:
      break;
  }
  return H;
}

function f(v) {
  return v;
}

function recomputePulley(j) {
  const pa = j.anchorA();
  const pb = j.anchorB();
  j.constant = Math.hypot(pa.x - j.groundA.x, pa.y - j.groundA.y) + j.ratio * Math.hypot(pb.x - j.groundB.x, pb.y - j.groundB.y);
}

export function moveEntity(app, kind, o, dx, dy) {
  const w = app.world;
  switch (kind) {
    case 'body':
      o.x += dx;
      o.y += dy;
      if (o.motion?.origin) {
        o.motion.origin.x += dx;
        o.motion.origin.y += dy;
      }
      o.syncShapes();
      o.wake();
      // fixed anchors of pins attached to ground move along with the body
      for (const j of w.joints) {
        if (j.type === 'revolute' && j.bodyB === o && j.bodyA === w.ground) {
          j.localA.x += dx;
          j.localA.y += dy;
        } else if (j.type === 'revolute' && j.bodyA === o && j.bodyB === w.ground) {
          j.localB.x += dx;
          j.localB.y += dy;
        } else if (j.type === 'prismatic' && j.bodyB === o && j.bodyA === w.ground) {
          j.localA.x += dx;
          j.localA.y += dy;
        }
      }
      break;
    case 'joint':
      break;
    case 'pool':
      o.x0 += dx;
      o.x1 += dx;
      o.bottom += dy;
      o.level += dy;
      break;
    case 'gate':
    case 'ruler':
    case 'wavestring':
      o.x1 += dx;
      o.x2 += dx;
      o.y1 += dy;
      o.y2 += dy;
      break;
    default:
      o.x += dx;
      o.y += dy;
  }
  if (kind === 'pool' || kind === 'fan' || kind === 'attractor') w.wakeAll();
}

export function deleteEntity(app, kind, o) {
  const w = app.world;
  if (kind === 'body') {
    if (o.room) return false;
    w.removeBody(o);
    return true;
  }
  if (kind === 'joint') {
    w.removeJoint(o);
    return true;
  }
  const arr = w[KIND_INFO[kind].list];
  const i = arr.indexOf(o);
  if (i >= 0) arr.splice(i, 1);
  if (kind === 'timer') for (const g of w.gates) if (g.timerId === o.id) g.timerId = 0;
  w.wakeAll();
  return true;
}

// Deep copy of an entity, offset by (dx, dy). Returns the new entity.
export function duplicateEntity(app, kind, o, dx = 0.5, dy = 0.5) {
  const w = app.world;
  const clone = (x) => JSON.parse(JSON.stringify(x));
  switch (kind) {
    case 'body': {
      const d = serializeBody(o);
      delete d.id;
      d.x += dx;
      d.y += dy;
      if (d.motion) d.motion.origin = undefined;
      const b = new Body({ ...d, depth: w.settings.depth });
      b.material = Object.assign(b.material, clone(o.material));
      b.updateMass();
      w.addBody(b);
      return b;
    }
    case 'joint': {
      const d = serializeJoint(o);
      delete d.id;
      return w.createJoint(o.type, o.bodyA, o.bodyB, d);
    }
    default: {
      const ctor = { pool: Pool, gate: Gate, timer: Timer, ruler: Ruler, label: Label, cannon: Cannon, slingshot: Slingshot, emitter: Emitter, drain: Drain, attractor: Attractor, fan: Fan, wavestring: WaveString }[kind];
      const data = {};
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (k.startsWith('_') || v instanceof Map || ArrayBuffer.isView(v) || typeof v === 'function' || k === 'body' || k === 'band') continue;
        data[k] = clone(v);
      }
      delete data.id;
      const n = new ctor(data);
      moveEntity(app, kind, n, dx, dy);
      w[KIND_INFO[kind].list].push(n);
      return n;
    }
  }
}
