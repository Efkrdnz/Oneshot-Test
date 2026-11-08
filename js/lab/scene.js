// Scene (de)serialisation: World <-> plain JSON. Used for presets, undo,
// reset-to-start, saving slots, file export and share links.

import { World, DEFAULT_SETTINGS } from '../engine/world.js';
import { Body } from '../engine/body.js';
import { Pool } from '../engine/pools.js';
import { Gate, Timer, Ruler, Label } from '../engine/instruments.js';
import { Cannon, Slingshot, Emitter, Drain } from '../engine/devices.js';
import { Attractor, Fan } from '../engine/forces.js';
import { WaveString } from '../engine/wavestring.js';

const r3 = (v) => Math.round(v * 1e6) / 1e6;
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

export function serializeBody(b) {
  return {
    id: b.id, name: b.name, type: b.type, geom: clone(b.geom), material: clone(b.material), color: b.color,
    x: r3(b.x), y: r3(b.y), angle: r3(b.angle), vx: r3(b.vx), vy: r3(b.vy), w: r3(b.w),
    gravityScale: b.gravityScale, dragCoef: b.dragCoef, linearDamping: b.linearDamping, angularDamping: b.angularDamping,
    fixedRotation: b.fixedRotation, collide: b.collide, layer: b.layer, mask: b.mask, hull: b.hull,
    innerLiquid: clone(b.innerLiquid), surfaceSpeed: b.surfaceSpeed,
    motion: b.motion ? { ...clone({ ...b.motion, origin: undefined }), origin: b.motion.origin ? { ...b.motion.origin } : undefined } : null,
    trail: b.trail, record: b.record, showLabel: b.showLabel, charge: b.charge, locked: b.locked, awake: b.awake,
  };
}

export function serializeJoint(j) {
  const base = {
    id: j.id, type: j.type, a: j.bodyA.id, b: j.bodyB.id, localA: { ...j.localA }, localB: { ...j.localB },
    collideConnected: j.collideConnected, breakForce: j.breakForce, color: j.color, name: j.name, showForce: j.showForce,
  };
  switch (j.type) {
    case 'revolute':
      Object.assign(base, {
        referenceAngle: j.referenceAngle, enableMotor: j.enableMotor, motorSpeed: j.motorSpeed, maxMotorTorque: j.maxMotorTorque,
        lockAngle: j.lockAngle, enableLimit: j.enableLimit, lowerAngle: j.lowerAngle, upperAngle: j.upperAngle,
      });
      break;
    case 'distance':
      Object.assign(base, { mode: j.mode, length: j.length, k: j.k, c: j.c, coils: j.coils });
      break;
    case 'pulley':
      Object.assign(base, { groundA: { ...j.groundA }, groundB: { ...j.groundB }, ratio: j.ratio, constant: j.constant, wheelRadius: j.wheelRadius });
      break;
    case 'prismatic':
      Object.assign(base, { localAxis: { ...j.localAxis }, referenceAngle: j.referenceAngle, lockRotation: j.lockRotation, enableLimit: j.enableLimit, lower: j.lower, upper: j.upper });
      break;
    default:
      break;
  }
  return base;
}

const plain = (o, skip = []) => {
  const out = {};
  for (const k of Object.keys(o)) {
    if (k.startsWith('_') || skip.includes(k)) continue;
    const v = o[k];
    if (v instanceof Map || v instanceof Set || ArrayBuffer.isView(v) || typeof v === 'function') continue;
    out[k] = clone(v);
  }
  return out;
};

export function serializeWorld(world, meta = {}) {
  return {
    version: 1,
    name: meta.name ?? world.meta?.name ?? 'Untitled experiment',
    description: meta.description ?? world.meta?.description ?? '',
    camera: meta.camera ?? world.meta?.camera ?? null,
    time: world.time,
    settings: clone(world.settings),
    bodies: world.bodies.filter((b) => !b.room).map(serializeBody),
    joints: world.joints.filter((j) => !j.internal).map(serializeJoint),
    pools: world.pools.map((p) => ({ ...plain(p, ['h', 'v', 'n', 'dx']), heights: Array.from(p.h, (v) => Math.round(v * 1e4) / 1e4) })),
    gates: world.gates.map((g) => plain(g, ['blocked', 'lastExit', 'sides', 'log', 'lastTime', 'lastSpeed', 'lastDuration', 'lastPerp', 'count'])),
    timers: world.timers.map((t) => plain(t)),
    rulers: world.rulers.map((r) => plain(r)),
    labels: world.labels.map((l) => plain(l)),
    cannons: world.cannons.map((c) => plain(c, ['shots', 'lastFire'])),
    slingshots: world.slingshots.map((s) => plain(s, ['state', 'body', 'hold', 'band', 'launchDir'])),
    emitters: world.emitters.map((e) => plain(e)),
    drains: world.drains.map((d) => plain(d)),
    attractors: world.attractors.map((a) => plain(a)),
    fans: world.fans.map((f) => plain(f)),
    waveStrings: world.waveStrings.map((w) => ({ ...plain(w, ['u', 'v']), u: Array.from(w.u, (x) => Math.round(x * 1e5) / 1e5), v: Array.from(w.v, (x) => Math.round(x * 1e4) / 1e4) })),
    particles: world.fluid.toJSON(),
    view: clone(world.view || null),
  };
}

export function deserializeWorld(data) {
  const settings = Object.assign(DEFAULT_SETTINGS(), clone(data.settings || {}));
  settings.room = Object.assign(DEFAULT_SETTINGS().room, settings.room || {});
  settings.fluid = Object.assign(DEFAULT_SETTINGS().fluid, settings.fluid || {});
  const world = new World(settings);
  world.meta = { name: data.name, description: data.description, camera: data.camera };
  world.time = data.time || 0;
  world.view = clone(data.view || null);
  for (const bd of data.bodies || []) {
    const b = new Body({ ...clone(bd), depth: settings.depth });
    if (bd.material) b.material = Object.assign(b.material, clone(bd.material));
    b.updateMass();
    if (bd.motion) {
      b.motion = clone(bd.motion);
      if (!bd.motion.origin) b.motion.origin = null;
    }
    world.addBody(b);
    if (bd.awake === false && b.type === 'dynamic') {
      b.awake = false;
      b.sleepTime = 10;
    }
  }
  for (const jd of data.joints || []) {
    const A = world.getBody(jd.a);
    const B = world.getBody(jd.b);
    if (!A || !B) continue;
    const opts = clone(jd);
    try {
      world.createJoint(jd.type, A, B, opts);
    } catch (e) {
      console.warn('joint skipped', e);
    }
  }
  for (const pd of data.pools || []) {
    const p = new Pool(pd);
    if (pd.heights && pd.heights.length === p.n) p.h.set(pd.heights);
    world.pools.push(p);
  }
  for (const td of data.timers || []) {
    const t = new Timer(td);
    Object.assign(t, { running: !!td.running, startTime: td.startTime || 0, accumulated: td.accumulated || 0, laps: clone(td.laps || []) });
    world.timers.push(t);
  }
  for (const gd of data.gates || []) world.gates.push(new Gate(gd));
  for (const rd of data.rulers || []) world.rulers.push(new Ruler(rd));
  for (const ld of data.labels || []) world.labels.push(new Label(ld));
  for (const cd of data.cannons || []) world.cannons.push(new Cannon(cd));
  for (const sd of data.slingshots || []) world.slingshots.push(new Slingshot(sd));
  for (const ed of data.emitters || []) {
    const e = new Emitter(ed);
    e.emitted = ed.emitted || 0;
    world.emitters.push(e);
  }
  for (const dd of data.drains || []) world.drains.push(new Drain(dd));
  for (const ad of data.attractors || []) world.attractors.push(new Attractor(ad));
  for (const fd of data.fans || []) world.fans.push(new Fan(fd));
  for (const wd of data.waveStrings || []) {
    const w = new WaveString(wd);
    if (wd.u && wd.u.length === w.nodes) w.u.set(wd.u);
    if (wd.v && wd.v.length === w.nodes) w.v.set(wd.v);
    if (wd.pulseStart !== undefined) w.pulseStart = wd.pulseStart;
    world.waveStrings.push(w);
  }
  if (data.particles) world.fluid.fromJSON(data.particles);
  return world;
}

// Compact share links: deflate + base64url when CompressionStream exists.
export async function encodeShare(data) {
  const json = JSON.stringify(data);
  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([json]).stream().pipeThrough(cs);
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return 'z' + b64url(buf);
  }
  return 'j' + b64url(new TextEncoder().encode(json));
}

export async function decodeShare(str) {
  const kind = str[0];
  const bytes = unb64url(str.slice(1));
  if (kind === 'z') {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
