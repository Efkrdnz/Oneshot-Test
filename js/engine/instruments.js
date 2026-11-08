// Measurement instruments: photogates (light-beam detectors), chronometers,
// rulers and text labels. Gates are checked every solver sub-step and the
// exact crossing instant is found by bisection on the interpolated motion,
// so timing resolution is far finer than the step size.

import { fieldUid } from './forces.js';

export class Timer {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Timer ' + this.id;
    this.x = o.x ?? 0;
    this.y = o.y ?? 3;
    this.autoStart = !!o.autoStart; // start when the simulation starts at t=0
    this.color = o.color || '#38bdf8';
    this.running = false;
    this.startTime = 0;
    this.accumulated = 0;
    this.laps = [];
  }

  start(t) {
    if (this.running) return false;
    this.running = true;
    this.startTime = t;
    return true;
  }

  stop(t) {
    if (!this.running) return false;
    this.accumulated += t - this.startTime;
    this.running = false;
    this.laps.push({ t, value: this.accumulated, kind: 'stop' });
    return true;
  }

  lap(t) {
    if (!this.running) return this.start(t);
    this.laps.push({ t, value: this.value(t), kind: 'lap' });
    return true;
  }

  reset() {
    this.running = false;
    this.accumulated = 0;
    this.startTime = 0;
    this.laps = [];
  }

  value(now) {
    return this.accumulated + (this.running ? now - this.startTime : 0);
  }
}

export class Gate {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Gate ' + this.id;
    this.x1 = o.x1 ?? 0;
    this.y1 = o.y1 ?? 0;
    this.x2 = o.x2 ?? 0;
    this.y2 = o.y2 ?? 1;
    this.mode = o.mode || 'edge'; // edge: beam broken by any part; center: centre of mass crosses
    this.timerId = o.timerId ?? 0;
    this.action = o.action || 'toggle'; // start | stop | toggle | lap | reset | none
    this.trigger = o.trigger || 'enter'; // enter | exit
    this.filterBody = o.filterBody ?? 0; // 0 = any body
    this.color = o.color || '#f43f5e';
    this.resetState();
  }

  resetState() {
    this.blocked = new Map(); // bodyId -> enter time
    this.lastExit = new Map();
    this.sides = new Map();
    this.count = 0;
    this.lastTime = null;
    this.lastSpeed = null;
    this.lastDuration = null;
    this.log = [];
  }

  get isBlocked() {
    return this.blocked.size > 0;
  }
}

export class Ruler {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.x1 = o.x1 ?? 0;
    this.y1 = o.y1 ?? 0;
    this.x2 = o.x2 ?? 1;
    this.y2 = o.y2 ?? 0;
    this.color = o.color || '#facc15';
    this.name = o.name || 'Ruler';
  }
}

export class Label {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.text = o.text ?? 'Note';
    this.size = o.size ?? 0.35; // metres
    this.color = o.color || '#e2e8f0';
    this.name = 'Label';
  }
}

// Test whether a segment hits a body placed at an arbitrary pose (x, y, a).
function bodyHitsSegmentAt(b, x, y, a, ax, ay, bx, by) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  // segment into local frame
  const lax = c * (ax - x) + s * (ay - y);
  const lay = -s * (ax - x) + c * (ay - y);
  const lbx = c * (bx - x) + s * (by - y);
  const lby = -s * (bx - x) + c * (by - y);
  for (const sh of b.shapes) {
    if (sh.type === 'circle') {
      const ex = lbx - lax;
      const ey = lby - lay;
      const l2 = ex * ex + ey * ey;
      let t = l2 > 1e-12 ? ((sh.x - lax) * ex + (sh.y - lay) * ey) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = lax + ex * t - sh.x;
      const dy = lay + ey * t - sh.y;
      if (dx * dx + dy * dy <= sh.r * sh.r) return true;
    } else {
      let t0 = 0;
      let t1 = 1;
      const dx = lbx - lax;
      const dy = lby - lay;
      let hit = true;
      for (let i = 0; i < sh.count; i++) {
        const n = sh.normals[i];
        const v = sh.verts[i];
        const num = n.x * (v.x - lax) + n.y * (v.y - lay);
        const den = n.x * dx + n.y * dy;
        if (Math.abs(den) < 1e-12) {
          if (num < 0) {
            hit = false;
            break;
          }
        } else {
          const t = num / den;
          if (den < 0) {
            if (t > t0) t0 = t;
          } else if (t < t1) t1 = t;
          if (t0 > t1) {
            hit = false;
            break;
          }
        }
      }
      if (hit) return true;
    }
  }
  return false;
}

function fire(world, gate, body, t, kind) {
  const speed = Math.hypot(body.vx, body.vy);
  const gx = gate.x2 - gate.x1;
  const gy = gate.y2 - gate.y1;
  const gl = Math.hypot(gx, gy) || 1;
  const vPerp = Math.abs((body.vx * -gy + body.vy * gx) / gl);
  if (kind === 'enter') {
    gate.count++;
    gate.lastTime = t;
    gate.lastSpeed = speed;
    gate.lastPerp = vPerp;
  }
  const entry = { t, kind, body: body.id, name: body.name || body.geom.kind, speed, vPerp };
  if (kind === 'exit') {
    const t0 = gate.blocked.get(body.id);
    if (t0 !== undefined) {
      entry.duration = t - t0;
      gate.lastDuration = entry.duration;
    }
  }
  gate.log.push(entry);
  if (gate.log.length > 200) gate.log.shift();
  world.emit('gate', { gate: gate.id, gateName: gate.name, ...entry });
  if (kind !== gate.trigger) return;
  const timer = world.getTimer(gate.timerId);
  if (!timer) return;
  let did = false;
  switch (gate.action) {
    case 'start': did = timer.start(t); break;
    case 'stop': did = timer.stop(t); break;
    case 'toggle': did = timer.running ? timer.stop(t) : timer.start(t); break;
    case 'lap': did = timer.lap(t); break;
    case 'reset': timer.reset(); did = true; break;
    default: break;
  }
  if (did) world.emit('timer', { timer: timer.id, timerName: timer.name, action: gate.action, value: timer.value(t), gateName: gate.name });
}

export function stepInstrumentsSubstep(world, tNow, h) {
  // auto start timers at t = 0
  if (Math.abs(tNow - h) < 1e-12) {
    for (const tm of world.timers) {
      if (tm.autoStart && !tm.running && tm.accumulated === 0) {
        tm.start(0);
        world.emit('timer', { timer: tm.id, timerName: tm.name, action: 'start', value: 0 });
      }
    }
  }
  const gates = world.gates;
  if (gates.length) {
    for (const gate of gates) {
      const minX = Math.min(gate.x1, gate.x2);
      const maxX = Math.max(gate.x1, gate.x2);
      const minY = Math.min(gate.y1, gate.y2);
      const maxY = Math.max(gate.y1, gate.y2);
      for (const b of world.bodies) {
        if (b.type === 'static' || b.room || !b.shapes.length) continue;
        if (gate.filterBody && b.id !== gate.filterBody) continue;
        const r = b.radius + Math.hypot(b.vx, b.vy) * h + 0.01;
        if (b.x + r < minX || b.x - r > maxX || b.y + r < minY || b.y - r > maxY) {
          if (gate.blocked.has(b.id)) {
            fire(world, gate, b, tNow, 'exit');
            gate.blocked.delete(b.id);
            gate.lastExit.set(b.id, tNow);
          }
          if (gate.mode === 'center') gate.sides.delete(b.id);
          continue;
        }
        const sx = b._sx ?? b.x;
        const sy = b._sy ?? b.y;
        const sa = b._sa ?? b.angle;
        if (gate.mode === 'center') {
          const gx = gate.x2 - gate.x1;
          const gy = gate.y2 - gate.y1;
          const s1 = gx * (b.y - gate.y1) - gy * (b.x - gate.x1);
          const s0 = gx * (sy - gate.y1) - gy * (sx - gate.x1);
          if (s0 !== 0 && s1 !== 0 && (s0 > 0) !== (s1 > 0)) {
            const f = s0 / (s0 - s1);
            const cx = sx + (b.x - sx) * f;
            const cy = sy + (b.y - sy) * f;
            const l2 = gx * gx + gy * gy;
            const t = l2 > 0 ? ((cx - gate.x1) * gx + (cy - gate.y1) * gy) / l2 : -1;
            if (t >= 0 && t <= 1) {
              const tc = tNow - h + f * h;
              fire(world, gate, b, tc, 'enter');
              fire(world, gate, b, tc, 'exit');
            }
          }
          continue;
        }
        const hitNow = bodyHitsSegmentAt(b, b.x, b.y, b.angle, gate.x1, gate.y1, gate.x2, gate.y2);
        const was = gate.blocked.has(b.id);
        if (hitNow === was) continue;
        // bisection for the transition instant within this sub-step
        let lo = 0;
        let hi = 1;
        for (let k = 0; k < 10; k++) {
          const m = (lo + hi) / 2;
          const hm = bodyHitsSegmentAt(b, sx + (b.x - sx) * m, sy + (b.y - sy) * m, sa + (b.angle - sa) * m, gate.x1, gate.y1, gate.x2, gate.y2);
          if (hm === hitNow) hi = m;
          else lo = m;
        }
        const tc = tNow - h + hi * h;
        if (hitNow) {
          const le = gate.lastExit.get(b.id);
          if (le !== undefined && tc - le < 0.01) {
            gate.blocked.set(b.id, gate._suppressed?.get(b.id) ?? tc); // flicker: continue previous block
            continue;
          }
          gate.blocked.set(b.id, tc);
          fire(world, gate, b, tc, 'enter');
        } else {
          fire(world, gate, b, tc, 'exit');
          if (!gate._suppressed) gate._suppressed = new Map();
          gate._suppressed.set(b.id, gate.blocked.get(b.id));
          gate.blocked.delete(b.id);
          gate.lastExit.set(b.id, tc);
        }
      }
    }
  }
  for (const b of world.bodies) {
    if (b.type === 'static') continue;
    b._sx = b.x;
    b._sy = b.y;
    b._sa = b.angle;
  }
}

export function stepInstrumentsPost(world) {
  // drop gate entries for bodies that no longer exist
  for (const gate of world.gates) {
    if (!gate.blocked.size) continue;
    for (const id of gate.blocked.keys()) {
      if (!world.bodies.some((b) => b.id === id)) gate.blocked.delete(id);
    }
  }
}
