// Canvas tools. Each tool receives pointer events in world coordinates and
// may draw a preview. Options shown in the options bar are declared per tool
// and stored in app.opts.

import { Body } from '../engine/body.js';
import { Pool } from '../engine/pools.js';
import { Gate, Timer, Ruler, Label } from '../engine/instruments.js';
import { Cannon, Slingshot, Emitter, Drain, predictTrajectory } from '../engine/devices.js';
import { Attractor, Fan } from '../engine/forces.js';
import { WaveString } from '../engine/wavestring.js';
import { MATERIAL_KEYS, MATERIALS, LIQUID_KEYS, LIQUIDS } from '../engine/materials.js';
import { hitTest, handlesOf, moveEntity, deleteEntity } from './entities.js';
import { buildGeometry } from '../engine/shapes.js';
import { rgba, bodyColor } from './renderer.js';

const TAU = Math.PI * 2;
const DRAG_PX = 4;

export const OPTION_DEFS = {
  material: { label: 'Material', type: 'select', options: () => MATERIAL_KEYS.map((k) => ({ value: k, label: MATERIALS[k].name })) },
  static: { label: 'Static', type: 'check', title: 'Create fixed (immovable) objects' },
  sides: { label: 'Sides', type: 'number', min: 3, max: 12, step: 1 },
  containerKind: { label: 'Type', type: 'select', options: () => [{ value: 'container', label: 'Open cup' }, { value: 'tank', label: 'Sealed tank' }, { value: 'boat', label: 'Boat hull' }] },
  wall: { label: 'Wall', type: 'number', min: 0.02, max: 0.5, step: 0.01, unit: 'm' },
  trackThickness: { label: 'Thickness', type: 'number', min: 0.03, max: 1, step: 0.01, unit: 'm' },
  trackSide: { label: 'Solid side', type: 'select', options: () => [{ value: 'below', label: 'Below / outside' }, { value: 'above', label: 'Above / inside' }] },
  beltSpeed: { label: 'Belt speed', type: 'number', min: -20, max: 20, step: 0.1, unit: 'm/s' },
  motionDir: { label: 'Direction', type: 'select', options: () => [{ value: '0', label: 'Horizontal' }, { value: '90', label: 'Vertical' }, { value: '45', label: 'Diagonal' }] },
  amplitude: { label: 'Amplitude', type: 'number', min: 0.1, max: 20, step: 0.1, unit: 'm' },
  period: { label: 'Period', type: 'number', min: 0.2, max: 60, step: 0.1, unit: 's' },
  springK: { label: 'k', type: 'number', min: 0.1, max: 100000, step: 1, unit: 'N/m' },
  springC: { label: 'Damping', type: 'number', min: 0, max: 1000, step: 0.1, unit: 'N·s/m' },
  motorSpeed: { label: 'Speed', type: 'number', min: -50, max: 50, step: 0.1, unit: 'rad/s' },
  motorTorque: { label: 'Max torque', type: 'number', min: 1, max: 1e6, step: 10, unit: 'N·m' },
  chainLink: { label: 'Link length', type: 'number', min: 0.08, max: 1, step: 0.01, unit: 'm' },
  railAngle: { label: 'Axis angle', type: 'number', min: -180, max: 180, step: 1, unit: '°' },
  liquid: { label: 'Liquid', type: 'select', options: () => LIQUID_KEYS.map((k) => ({ value: k, label: LIQUIDS[k].name })) },
  pourRate: { label: 'Rate', type: 'number', min: 5, max: 400, step: 5, unit: '/s' },
  brush: { label: 'Brush', type: 'number', min: 0.1, max: 2, step: 0.05, unit: 'm' },
  faucetRate: { label: 'Flow', type: 'number', min: 1, max: 300, step: 1, unit: '/s' },
  cannonAngle: { label: 'Angle', type: 'number', min: -90, max: 90, step: 1, unit: '°' },
  cannonSpeed: { label: 'Speed', type: 'number', min: 0.1, max: 200, step: 0.5, unit: 'm/s' },
  slingK: { label: 'Band k', type: 'number', min: 1, max: 5000, step: 5, unit: 'N/m' },
  attractorStrength: { label: 'μ = GM', type: 'number', min: -1000, max: 5000, step: 5, unit: 'm³/s²' },
  fanSpeed: { label: 'Air speed', type: 'number', min: 0, max: 100, step: 0.5, unit: 'm/s' },
  fanWidth: { label: 'Width', type: 'number', min: 0.2, max: 20, step: 0.1, unit: 'm' },
  blastPower: { label: 'Power', type: 'number', min: 1, max: 100, step: 1, unit: 'm/s' },
  blastRadius: { label: 'Radius', type: 'number', min: 0.5, max: 15, step: 0.5, unit: 'm' },
  gateMode: { label: 'Trigger by', type: 'select', options: () => [{ value: 'edge', label: 'Leading edge' }, { value: 'center', label: 'Centre of mass' }] },
  launchScale: { label: 'Speed per m', type: 'number', min: 0.5, max: 20, step: 0.5, unit: '1/s' },
};

export const DEFAULT_OPTS = {
  material: 'wood', static: false, sides: 6, containerKind: 'container', wall: 0.08, trackThickness: 0.15, trackSide: 'below',
  beltSpeed: 2, motionDir: '90', amplitude: 1.5, period: 4, springK: 50, springC: 0.5, motorSpeed: 2, motorTorque: 1000,
  chainLink: 0.3, railAngle: 0, liquid: 'water', pourRate: 120, brush: 0.4, faucetRate: 60, cannonAngle: 45, cannonSpeed: 12,
  slingK: 250, attractorStrength: 60, fanSpeed: 8, fanWidth: 2, blastPower: 12, blastRadius: 3, gateMode: 'edge', launchScale: 4,
};

// ---------------------------------------------------------------------------------
function newBody(app, geom, x, y, extra = {}) {
  const o = app.opts;
  const b = new Body({
    geom, x, y, materialKey: extra.materialKey || o.material, depth: app.world.settings.depth,
    type: extra.type || (o.static ? 'static' : 'dynamic'), ...extra,
  });
  app.world.addBody(b);
  if (extra.design) b.setDesignPosition(x, y);
  return b;
}

function rectFrom(a, b) {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
}

function dragged(app, e) {
  return app.downScreen && Math.hypot(e.sx - app.downScreen.x, e.sy - app.downScreen.y) > DRAG_PX;
}

function finishCreate(app, kind, obj, label) {
  app.select(kind, obj);
  app.commit(label);
}

function previewPoly(ctx, R, pts, color = '#7dd3fc', fill = true) {
  const cam = R.camera;
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(cam.sx(p.x), cam.sy(p.y)) : ctx.moveTo(cam.sx(p.x), cam.sy(p.y))));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = rgba(color, 0.18);
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

function previewLine(ctx, R, a, b, color = '#7dd3fc', dash = [5, 4]) {
  const cam = R.camera;
  ctx.beginPath();
  ctx.moveTo(cam.sx(a.x), cam.sy(a.y));
  ctx.lineTo(cam.sx(b.x), cam.sy(b.y));
  ctx.strokeStyle = color;
  ctx.setLineDash(dash);
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.setLineDash([]);
}

function previewGeom(ctx, R, app, geom, x, y, angle = 0, design = false) {
  const { pieces } = buildGeometry(geom);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const color = MATERIALS[app.opts.material]?.color || '#7dd3fc';
  const cam = R.camera;
  ctx.beginPath();
  for (const p of pieces) {
    if (p.type === 'circle') {
      const wx = x + c * p.x - s * p.y;
      const wy = y + s * p.x + c * p.y;
      ctx.moveTo(cam.sx(wx) + p.r * cam.scale, cam.sy(wy));
      ctx.arc(cam.sx(wx), cam.sy(wy), p.r * cam.scale, 0, TAU);
    } else {
      p.points.forEach((q, i) => {
        const wx = x + c * q.x - s * q.y;
        const wy = y + s * q.x + c * q.y;
        if (i) ctx.lineTo(cam.sx(wx), cam.sy(wy));
        else ctx.moveTo(cam.sx(wx), cam.sy(wy));
      });
      ctx.closePath();
    }
  }
  void design;
  ctx.fillStyle = rgba(color, 0.3);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

function sizeTag(R, text, p, dy = -16) {
  const s = R.camera.toScreen(p.x, p.y);
  R.tag(text, s.x + 12, s.y + dy, '#7dd3fc');
}

// Douglas–Peucker simplification
function simplify(points, tol) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const A = points[a];
    const B = points[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((points[i].x - A.x) * dy - (points[i].y - A.y) * dx) / L;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function chaikin(points, iterations = 2) {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

// Anchor helper: body under point (snaps to its centre when close) or ground.
export function pickAnchor(app, p, exclude) {
  const w = app.world;
  let body = null;
  for (let i = w.bodies.length - 1; i >= 0; i--) {
    const b = w.bodies[i];
    if (b === exclude || b.room) continue;
    if (b.containsPoint(p.x, p.y)) {
      body = b;
      break;
    }
  }
  if (!body) return { body: w.ground, local: { x: p.x, y: p.y }, world: { ...p } };
  const snapR = 10 / app.camera.scale;
  let q = p;
  if (Math.hypot(p.x - body.x, p.y - body.y) < Math.max(snapR, Math.min(0.15, body.radius * 0.3))) q = { x: body.x, y: body.y };
  return { body, local: body.worldToLocal(q.x, q.y), world: q };
}

function anchorMarker(ctx, R, a) {
  const s = R.camera.toScreen(a.world.x, a.world.y);
  ctx.beginPath();
  ctx.arc(s.x, s.y, 5, 0, TAU);
  ctx.fillStyle = a.body === R.groundRef ? '#94a3b8' : '#facc15';
  ctx.fill();
}

// ---------------------------------------------------------------------------------
const rectCreate = (opts) => ({
  options: opts.options,
  down(app, e) {
    this.p0 = app.snap(e);
    this.p1 = this.p0;
  },
  move(app, e) {
    if (!this.p0) return;
    let p = app.snap(e);
    if (e.shift && opts.squareWithShift) {
      const d = Math.max(Math.abs(p.x - this.p0.x), Math.abs(p.y - this.p0.y));
      p = { x: this.p0.x + Math.sign(p.x - this.p0.x || 1) * d, y: this.p0.y + Math.sign(p.y - this.p0.y || 1) * d };
    }
    this.p1 = p;
  },
  up(app, e) {
    if (!this.p0) return;
    const isDrag = dragged(app, e) && Math.hypot(this.p1.x - this.p0.x, this.p1.y - this.p0.y) > 0.03;
    const r = isDrag ? rectFrom(this.p0, this.p1) : null;
    const res = opts.create(app, r, this.p0, this.p1, e);
    this.p0 = null;
    if (res) finishCreate(app, res.kind, res.obj, res.label);
  },
  cancel() {
    this.p0 = null;
  },
  preview(ctx, R, app) {
    if (!this.p0) return;
    const r = rectFrom(this.p0, this.p1);
    opts.preview(ctx, R, app, r, this.p0, this.p1);
  },
});

const lineCreate = (opts) => ({
  options: opts.options,
  down(app, e) {
    this.a = opts.anchor ? pickAnchor(app, app.snap(e)) : { world: app.snap(e) };
    this.p1 = this.a.world;
  },
  move(app, e) {
    if (!this.a) return;
    this.p1 = app.snap(e);
    if (e.shift && opts.angleSnap !== false) {
      const dx = this.p1.x - this.a.world.x;
      const dy = this.p1.y - this.a.world.y;
      const L = Math.hypot(dx, dy);
      const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12);
      this.p1 = { x: this.a.world.x + Math.cos(ang) * L, y: this.a.world.y + Math.sin(ang) * L };
    }
  },
  up(app, e) {
    if (!this.a) return;
    const isDrag = dragged(app, e);
    const res = opts.create(app, this.a, this.p1, isDrag, e);
    this.a = null;
    if (res) finishCreate(app, res.kind, res.obj, res.label);
  },
  cancel() {
    this.a = null;
  },
  preview(ctx, R, app) {
    if (!this.a) {
      if (opts.anchor && app.pointer) {
        const a = pickAnchor(app, app.snap(app.pointer));
        if (a.body !== app.world.ground) anchorMarker(ctx, R, a);
      }
      return;
    }
    opts.preview(ctx, R, app, this.a, this.p1);
  },
});

const clickCreate = (opts) => ({
  options: opts.options,
  down() {},
  up(app, e) {
    if (dragged(app, e)) return;
    const res = opts.create(app, app.snap(e), e);
    if (res) finishCreate(app, res.kind, res.obj, res.label);
  },
  preview(ctx, R, app) {
    if (opts.preview && app.pointer) opts.preview(ctx, R, app, app.snap(app.pointer));
  },
});

function jointClick(kind) {
  return clickCreate({
    options: kind === 'motor' ? ['motorSpeed', 'motorTorque'] : [],
    create(app, p) {
      const w = app.world;
      const A = w.bodyAt(p.x, p.y);
      if (!A) {
        app.toast('Click on an object to attach it', 'warn');
        return null;
      }
      let B = null;
      for (let i = w.bodies.length - 1; i >= 0; i--) {
        const b = w.bodies[i];
        if (b === A || b.room) continue;
        if (b.containsPoint(p.x, p.y)) {
          B = b;
          break;
        }
      }
      let q = p;
      if (Math.hypot(p.x - A.x, p.y - A.y) < 10 / app.camera.scale) q = { x: A.x, y: A.y };
      const base = B || w.ground;
      const opts = { localA: base.worldToLocal(q.x, q.y), localB: A.worldToLocal(q.x, q.y) };
      if (kind === 'weld') opts.lockAngle = true;
      if (kind === 'motor') {
        opts.enableMotor = true;
        opts.motorSpeed = app.opts.motorSpeed;
        opts.maxMotorTorque = app.opts.motorTorque;
      }
      const j = w.createJoint('revolute', base, A, opts);
      const names = { pin: B ? 'Hinge' : 'Pin', weld: 'Weld', motor: 'Motor' };
      j.name = names[kind];
      return { kind: 'joint', obj: j, label: 'Add ' + kind };
    },
    preview(ctx, R, app, p) {
      const A = app.world.bodyAt(p.x, p.y);
      const s = R.camera.toScreen(p.x, p.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 6, 0, TAU);
      ctx.strokeStyle = A ? '#facc15' : 'rgba(148,163,184,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    },
  });
}

function distanceTool(mode) {
  const optsFor = { spring: ['springK', 'springC'], bungee: ['springK', 'springC'], rope: [], rod: [] };
  return lineCreate({
    anchor: true,
    angleSnap: true,
    options: optsFor[mode],
    create(app, a, p1, isDrag) {
      const w = app.world;
      const b = pickAnchor(app, p1, a.body === w.ground ? null : a.body);
      if (!isDrag || Math.hypot(b.world.x - a.world.x, b.world.y - a.world.y) < 0.05) {
        app.toast('Drag from one point to another to connect', 'warn');
        return null;
      }
      if (a.body === w.ground && b.body === w.ground) {
        app.toast('At least one end must be on an object', 'warn');
        return null;
      }
      if (a.body === b.body) {
        app.toast('Both ends are on the same object', 'warn');
        return null;
      }
      const L = Math.hypot(b.world.x - a.world.x, b.world.y - a.world.y);
      // ground anchors always go first so they render as mounts
      let A = a;
      let B = b;
      if (b.body === w.ground) {
        A = b;
        B = a;
      }
      const opts = { mode, localA: A.local, localB: B.local, length: L };
      if (mode === 'spring' || mode === 'bungee') {
        opts.k = app.opts.springK;
        opts.c = app.opts.springC;
      }
      const j = w.createJoint('distance', A.body, B.body, opts);
      j.name = { rope: 'String', rod: 'Rod', spring: 'Spring', bungee: 'Elastic band' }[mode];
      return { kind: 'joint', obj: j, label: 'Add ' + mode };
    },
    preview(ctx, R, app, a, p1) {
      const b = pickAnchor(app, p1, a.body === app.world.ground ? null : a.body);
      const A = R.camera.toScreen(a.world.x, a.world.y);
      const B = R.camera.toScreen(b.world.x, b.world.y);
      if (mode === 'spring' || mode === 'bungee') R.drawCoil(A, B, 10, 7, '#7dd3fc', mode === 'bungee');
      else previewLine(ctx, R, a.world, b.world, '#7dd3fc', mode === 'rod' ? [] : [5, 4]);
      R.groundRef = app.world.ground;
      anchorMarker(ctx, R, a);
      anchorMarker(ctx, R, b);
      sizeTag(R, `${Math.hypot(b.world.x - a.world.x, b.world.y - a.world.y).toFixed(2)} m`, p1);
    },
  });
}

// ---------------------------------------------------------------------------------
export const TOOLS = [
  // ---------------- interact
  {
    id: 'select', name: 'Select & move', icon: 'select', key: 'V', group: 'Interact',
    hint: 'Click to select · drag to move (physical drag while running) · drag empty space to box-select · Shift adds to selection',
    down(app, e) {
      const w = app.world;
      this.mode = null;
      this.moved = false;
      const tol = 7 / app.camera.scale;
      // rotate handle
      if (app.selection.length === 1 && app.selection[0].kind === 'body' && !app.selection[0].obj.room) {
        const b = app.selection[0].obj;
        const h = app.renderer.rotateHandlePos(b);
        if (Math.hypot(e.sx - h.x, e.sy - h.y) < 9 && !b.locked) {
          this.mode = 'rotate';
          this.body = b;
          this.startAngle = b.angle;
          this.startMouse = Math.atan2(e.wy - b.y, e.wx - b.x);
          return;
        }
      }
      // handles
      if (app.selection.length === 1) {
        const s = app.selection[0];
        for (const h of handlesOf(s.kind, s.obj, app)) {
          const hs = app.camera.toScreen(h.x, h.y);
          if (Math.abs(hs.x - e.sx) < 8 && Math.abs(hs.y - e.sy) < 8) {
            this.mode = 'handle';
            this.handle = h;
            return;
          }
        }
      }
      // slingshot pouch
      for (const s of w.slingshots) {
        if (Math.hypot(e.wx - s.x, e.wy - s.y) < Math.max(0.35, 14 / app.camera.scale) && s.state !== 'launching') {
          this.mode = 'sling';
          this.sling = s;
          s.grab(w, e.wx, e.wy);
          app.select('slingshot', s);
          return;
        }
      }
      const hit = hitTest(app, e.wx, e.wy, tol);
      if (!hit) {
        if (!e.shift) app.clearSelection();
        this.mode = 'marquee';
        app.marquee = { x0: e.wx, y0: e.wy, x1: e.wx, y1: e.wy };
        return;
      }
      if (e.shift && hit.kind === 'body') {
        app.toggleSelect(hit.kind, hit.obj);
      } else if (!app.isSelected(hit.kind, hit.obj)) app.select(hit.kind, hit.obj);
      if (hit.kind === 'body' && hit.obj.locked) return;
      if (hit.kind === 'body' && app.running && hit.obj.type === 'dynamic' && app.selection.length <= 1) {
        this.mode = 'physdrag';
        w.startDrag(hit.obj, e.wx, e.wy);
        return;
      }
      if (hit.kind === 'joint') return;
      this.mode = 'move';
      this.last = app.snap(e);
      this.grabOffset = null;
      if (app.snapOn && hit.kind === 'body') this.grabOffset = { x: hit.obj.x - e.wx, y: hit.obj.y - e.wy, body: hit.obj };
    },
    move(app, e) {
      const w = app.world;
      if (this.mode === 'rotate') {
        let a = this.startAngle + Math.atan2(e.wy - this.body.y, e.wx - this.body.x) - this.startMouse;
        if (e.shift || app.snapOn) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        this.body.angle = a;
        this.body.updateTransform();
        this.body.syncShapes();
        this.body.wake();
        this.moved = true;
        app.setHint(`Angle ${((a * 180) / Math.PI).toFixed(1)}°`);
      } else if (this.mode === 'handle') {
        const p = app.snap(e);
        this.handle.set(p.x, p.y);
        this.moved = true;
      } else if (this.mode === 'sling') {
        this.sling.pull(e.wx, e.wy);
        const b = this.sling.body;
        if (b && !app.running) {
          b.x = this.sling.hold.x;
          b.y = this.sling.hold.y;
          b.syncShapes();
        }
      } else if (this.mode === 'physdrag') {
        w.updateDrag(e.wx, e.wy);
      } else if (this.mode === 'marquee') {
        app.marquee.x1 = e.wx;
        app.marquee.y1 = e.wy;
      } else if (this.mode === 'move') {
        let p = app.snap(e);
        if (this.grabOffset) {
          const t = app.snap({ wx: e.wx + this.grabOffset.x, wy: e.wy + this.grabOffset.y });
          p = { x: t.x - this.grabOffset.x, y: t.y - this.grabOffset.y };
        }
        const dx = p.x - this.last.x;
        const dy = p.y - this.last.y;
        if (dx || dy) {
          for (const s of app.selection) {
            if (s.kind === 'body' && s.obj.locked) continue;
            moveEntity(app, s.kind, s.obj, dx, dy);
            if (s.kind === 'body' && !app.running) {
              s.obj.vx = s.obj.vy = s.obj.w = 0;
            }
          }
          this.moved = true;
          this.last = p;
        }
      }
    },
    up(app) {
      const w = app.world;
      if (this.mode === 'physdrag') w.endDrag();
      if (this.mode === 'sling') {
        this.sling.release(w);
        app.commit('Pull slingshot');
        if (!app.running) app.toast('Slingshot loaded — press Play to launch', 'good');
      }
      if (this.mode === 'marquee') {
        const m = app.marquee;
        const bodies = w.bodiesInRect(m.x0, m.y0, m.x1, m.y1);
        if (bodies.length) app.setSelection(bodies.map((b) => ({ kind: 'body', obj: b })), true);
        app.marquee = null;
      }
      if ((this.mode === 'move' || this.mode === 'rotate' || this.mode === 'handle') && this.moved) app.commit('Move');
      this.mode = null;
    },
    cancel(app) {
      app.marquee = null;
      app.world.endDrag();
      this.mode = null;
    },
  },
  {
    id: 'grab', name: 'Grab & throw', icon: 'grab', key: 'G', group: 'Interact',
    hint: 'Drag objects with a spring — fling them while the simulation runs. Pluck wave strings.',
    down(app, e) {
      const w = app.world;
      this.mode = null;
      for (const s of w.slingshots) {
        if (Math.hypot(e.wx - s.x, e.wy - s.y) < Math.max(0.35, 14 / app.camera.scale) && s.state !== 'launching') {
          this.mode = 'sling';
          this.sling = s;
          s.grab(w, e.wx, e.wy);
          return;
        }
      }
      const tol = 8 / app.camera.scale;
      const hit = hitTest(app, e.wx, e.wy, tol, ['body', 'wavestring']);
      if (!hit) return;
      if (hit.kind === 'wavestring') {
        this.mode = 'pluck';
        this.str = hit.obj;
        const s = hit.obj;
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const L2 = dx * dx + dy * dy;
        this.t = Math.max(0.02, Math.min(0.98, ((e.wx - s.x1) * dx + (e.wy - s.y1) * dy) / L2));
        return;
      }
      const b = hit.obj;
      if (b.type !== 'dynamic' || b.locked) return;
      if (app.running) {
        this.mode = 'drag';
        w.startDrag(b, e.wx, e.wy);
      } else {
        this.mode = 'move';
        this.body = b;
        this.last = { x: e.wx, y: e.wy };
      }
    },
    move(app, e) {
      if (this.mode === 'drag') app.world.updateDrag(e.wx, e.wy);
      else if (this.mode === 'move') {
        moveEntity(app, 'body', this.body, e.wx - this.last.x, e.wy - this.last.y);
        this.last = { x: e.wx, y: e.wy };
      } else if (this.mode === 'pluck') {
        const s = this.str;
        const dx = s.x2 - s.x1;
        const dy = s.y2 - s.y1;
        const L = Math.hypot(dx, dy);
        const d = ((e.wx - s.x1) * -dy + (e.wy - s.y1) * dx) / L;
        s.pluck(this.t, Math.max(-L / 4, Math.min(L / 4, d)));
      } else if (this.mode === 'sling') {
        this.sling.pull(e.wx, e.wy);
      }
    },
    up(app) {
      if (this.mode === 'drag') app.world.endDrag();
      if (this.mode === 'move') app.commit('Move');
      if (this.mode === 'sling') this.sling.release(app.world);
      this.mode = null;
    },
    cancel(app) {
      app.world.endDrag();
      this.mode = null;
    },
  },
  {
    id: 'pan', name: 'Pan view', icon: 'pan', key: 'H', group: 'Interact',
    hint: 'Drag to pan · scroll to zoom · middle-drag or Space+drag pans with any tool',
    down(app, e) {
      this.last = { x: e.sx, y: e.sy };
    },
    move(app, e) {
      if (!this.last) return;
      app.camera.pan(e.sx - this.last.x, e.sy - this.last.y);
      this.last = { x: e.sx, y: e.sy };
    },
    up() {
      this.last = null;
    },
  },
  {
    id: 'launch', name: 'Launch (set velocity)', icon: 'launch', key: 'L', group: 'Interact',
    hint: 'Press on an object and drag: the arrow sets its velocity (works while paused too)',
    options: ['launchScale'],
    down(app, e) {
      const hit = hitTest(app, e.wx, e.wy, 6 / app.camera.scale, ['body']);
      this.body = hit && hit.obj.type === 'dynamic' ? hit.obj : null;
      this.p = { x: e.wx, y: e.wy };
    },
    move(app, e) {
      this.p = { x: e.wx, y: e.wy };
    },
    up(app) {
      if (!this.body) return;
      const k = app.opts.launchScale;
      const b = this.body;
      b.vx = (this.p.x - b.x) * k;
      b.vy = (this.p.y - b.y) * k;
      b.w = 0;
      b.wake();
      b.trail = true;
      app.toast(`Launched at ${Math.hypot(b.vx, b.vy).toFixed(2)} m/s`, 'good');
      this.body = null;
      app.commit('Launch');
    },
    preview(ctx, R, app) {
      if (!this.body) return;
      const b = this.body;
      const k = app.opts.launchScale;
      const vx = (this.p.x - b.x) * k;
      const vy = (this.p.y - b.y) * k;
      const cam = R.camera;
      R.arrow(cam.sx(b.x), cam.sy(b.y), cam.sx(this.p.x), cam.sy(this.p.y), '#facc15', 2.5);
      const pts = predictTrajectory(app.world, b.x, b.y, vx, vy, b, 5);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(cam.sx(p.x), cam.sy(p.y)) : ctx.moveTo(cam.sx(p.x), cam.sy(p.y))));
      ctx.strokeStyle = 'rgba(250,204,21,0.5)';
      ctx.setLineDash([3, 5]);
      ctx.stroke();
      ctx.setLineDash([]);
      sizeTag(R, `${Math.hypot(vx, vy).toFixed(2)} m/s @ ${((Math.atan2(vy, vx) * 180) / Math.PI).toFixed(1)}°`, this.p);
    },
  },
  {
    id: 'blast', name: 'Blast (impulse)', icon: 'blast', key: 'X', group: 'Interact',
    hint: 'Click to push everything nearby outward',
    options: ['blastPower', 'blastRadius'],
    down() {},
    up(app, e) {
      const w = app.world;
      const R = app.opts.blastRadius;
      const P = app.opts.blastPower;
      let n = 0;
      for (const b of w.bodies) {
        if (b.type !== 'dynamic') continue;
        const dx = b.x - e.wx;
        const dy = b.y - e.wy;
        const d = Math.hypot(dx, dy);
        if (d > R) continue;
        const k = P * (1 - d / R);
        const ux = d > 1e-6 ? dx / d : 0;
        const uy = d > 1e-6 ? dy / d : 1;
        b.vx += ux * k;
        b.vy += uy * k;
        b.w += (Math.random() - 0.5) * k * 0.5;
        b.wake();
        n++;
      }
      const f = w.fluid;
      for (let i = 0; i < f.count; i++) {
        const dx = f.x[i] - e.wx;
        const dy = f.y[i] - e.wy;
        const d = Math.hypot(dx, dy);
        if (d > R || d < 1e-6) continue;
        const k = P * (1 - d / R);
        f.vx[i] += (dx / d) * k;
        f.vy[i] += (dy / d) * k;
      }
      app.blastFx = { x: e.wx, y: e.wy, r: R, t: 0 };
      if (n) app.commit('Blast');
    },
    preview(ctx, R, app) {
      const p = app.pointer;
      if (p) {
        const s = R.camera.toScreen(p.wx, p.wy);
        ctx.beginPath();
        ctx.arc(s.x, s.y, app.opts.blastRadius * R.camera.scale, 0, TAU);
        ctx.strokeStyle = 'rgba(251,146,60,0.4)';
        ctx.setLineDash([4, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const fx = app.blastFx;
      if (fx && fx.t < 0.4) {
        const s = R.camera.toScreen(fx.x, fx.y);
        ctx.beginPath();
        ctx.arc(s.x, s.y, fx.r * R.camera.scale * (fx.t / 0.4), 0, TAU);
        ctx.strokeStyle = `rgba(251,146,60,${1 - fx.t / 0.4})`;
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    },
  },
  {
    id: 'scissors', name: 'Cut connectors', icon: 'scissors', key: 'K', group: 'Interact',
    hint: 'Drag across strings, springs, chains or pins to cut them (great while running)',
    down(app, e) {
      this.path = [{ x: e.wx, y: e.wy }];
      this.cut = 0;
      this.tryCut(app, e.wx, e.wy, e.wx, e.wy);
    },
    move(app, e) {
      if (!this.path) return;
      const last = this.path[this.path.length - 1];
      this.tryCut(app, last.x, last.y, e.wx, e.wy);
      this.path.push({ x: e.wx, y: e.wy });
      if (this.path.length > 60) this.path.shift();
    },
    tryCut(app, x0, y0, x1, y1) {
      const w = app.world;
      const tol = 6 / app.camera.scale;
      for (const j of w.joints.slice()) {
        if (j.internal) continue;
        const a = j.anchorA();
        const b = j.anchorB();
        let hit = false;
        if (j.type === 'revolute' || j.type === 'prismatic') hit = segPointDist(x0, y0, x1, y1, b.x, b.y) < tol * 1.5;
        else if (j.type === 'pulley') hit = segSeg(x0, y0, x1, y1, a.x, a.y, j.groundA.x, j.groundA.y) || segSeg(x0, y0, x1, y1, b.x, b.y, j.groundB.x, j.groundB.y);
        else hit = segSeg(x0, y0, x1, y1, a.x, a.y, b.x, b.y);
        if (hit) {
          w.removeJoint(j);
          app.deselect('joint', j);
          this.cut++;
        }
      }
    },
    up(app) {
      if (this.cut) {
        app.toast(`Cut ${this.cut} connector${this.cut > 1 ? 's' : ''}`, 'warn');
        app.commit('Cut');
      }
      this.path = null;
    },
    preview(ctx, R) {
      if (!this.path || this.path.length < 2) return;
      const cam = R.camera;
      ctx.beginPath();
      this.path.forEach((p, i) => (i ? ctx.lineTo(cam.sx(p.x), cam.sy(p.y)) : ctx.moveTo(cam.sx(p.x), cam.sy(p.y))));
      ctx.strokeStyle = 'rgba(244,63,94,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    },
  },
  {
    id: 'eraser', name: 'Eraser', icon: 'eraser', key: 'E', group: 'Interact',
    hint: 'Click or drag over anything to delete it (also removes liquid particles)',
    down(app, e) {
      this.active = true;
      this.n = 0;
      this.erase(app, e);
    },
    move(app, e) {
      if (this.active) this.erase(app, e);
    },
    erase(app, e) {
      const hit = hitTest(app, e.wx, e.wy, 4 / app.camera.scale);
      if (hit && deleteEntity(app, hit.kind, hit.obj)) {
        app.deselect(hit.kind, hit.obj);
        this.n++;
      }
      this.n += app.world.fluid.removeInCircle(e.wx, e.wy, 12 / app.camera.scale) ? 1 : 0;
    },
    up(app) {
      this.active = false;
      if (this.n) app.commit('Erase');
    },
    preview(ctx, R, app) {
      if (!app.pointer) return;
      const s = R.camera.toScreen(app.pointer.wx, app.pointer.wy);
      ctx.beginPath();
      ctx.arc(s.x, s.y, 12, 0, TAU);
      ctx.strokeStyle = 'rgba(244,63,94,0.6)';
      ctx.stroke();
    },
  },

  // ---------------- shapes
  {
    id: 'box', name: 'Box', icon: 'box', key: 'B', group: 'Objects',
    hint: 'Drag to draw a box (Shift = square) · click for a 0.6 m box',
    ...rectCreate({
      options: ['material', 'static'],
      squareWithShift: true,
      create(app, r, p0) {
        const b = r ? newBody(app, { kind: 'box', w: Math.max(0.04, r.x1 - r.x0), h: Math.max(0.04, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
          : newBody(app, { kind: 'box', w: 0.6, h: 0.6 }, p0.x, p0.y);
        return { kind: 'body', obj: b, label: 'Add box' };
      },
      preview(ctx, R, app, r) {
        previewGeom(ctx, R, app, { kind: 'box', w: Math.max(0.01, r.x1 - r.x0), h: Math.max(0.01, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
        sizeTag(R, `${(r.x1 - r.x0).toFixed(2)} × ${(r.y1 - r.y0).toFixed(2)} m`, { x: r.x1, y: r.y1 });
      },
    }),
  },
  {
    id: 'circle', name: 'Ball', icon: 'circle', key: 'C', group: 'Objects',
    hint: 'Drag from the centre to set the radius · click for a 0.3 m ball',
    options: ['material', 'static'],
    down(app, e) {
      this.c = app.snap(e);
      this.r = 0;
    },
    move(app, e) {
      if (!this.c) return;
      const p = app.snap(e);
      this.r = Math.hypot(p.x - this.c.x, p.y - this.c.y);
    },
    up(app, e) {
      if (!this.c) return;
      const r = dragged(app, e) && this.r > 0.02 ? this.r : 0.3;
      const b = newBody(app, { kind: 'circle', r }, this.c.x, this.c.y);
      this.c = null;
      finishCreate(app, 'body', b, 'Add ball');
    },
    cancel() {
      this.c = null;
    },
    preview(ctx, R, app) {
      if (!this.c) return;
      previewGeom(ctx, R, app, { kind: 'circle', r: Math.max(0.01, this.r) }, this.c.x, this.c.y);
      sizeTag(R, `r = ${this.r.toFixed(2)} m`, this.c, -this.r * R.camera.scale - 14);
    },
  },
  {
    id: 'polygon', name: 'Regular polygon', icon: 'polygon', key: 'P', group: 'Objects',
    hint: 'Drag from the centre: distance sets size, direction sets rotation',
    options: ['material', 'static', 'sides'],
    down(app, e) {
      this.c = app.snap(e);
      this.p = this.c;
    },
    move(app, e) {
      if (this.c) this.p = app.snap(e);
    },
    up(app, e) {
      if (!this.c) return;
      const r = dragged(app, e) ? Math.max(0.03, Math.hypot(this.p.x - this.c.x, this.p.y - this.c.y)) : 0.4;
      const ang = dragged(app, e) ? Math.atan2(this.p.y - this.c.y, this.p.x - this.c.x) - Math.PI / 2 : 0;
      const b = newBody(app, { kind: 'ngon', n: app.opts.sides, r }, this.c.x, this.c.y, { angle: ang });
      this.c = null;
      finishCreate(app, 'body', b, 'Add polygon');
    },
    cancel() {
      this.c = null;
    },
    preview(ctx, R, app) {
      if (!this.c) return;
      const r = Math.max(0.01, Math.hypot(this.p.x - this.c.x, this.p.y - this.c.y));
      previewGeom(ctx, R, app, { kind: 'ngon', n: app.opts.sides, r }, this.c.x, this.c.y, Math.atan2(this.p.y - this.c.y, this.p.x - this.c.x) - Math.PI / 2);
    },
  },
  {
    id: 'wedge', name: 'Wedge / triangle', icon: 'wedge', key: 'W', group: 'Objects',
    hint: 'Drag a rectangle: the right angle sits at the bottom on the side you start from',
    ...rectCreate({
      options: ['material', 'static'],
      create(app, r, p0, p1) {
        if (!r) r = { x0: p0.x - 0.5, y0: p0.y - 0.3, x1: p0.x + 0.5, y1: p0.y + 0.3 };
        const flip = p1.x < p0.x;
        const b = newBody(app, { kind: 'wedge', w: Math.max(0.05, r.x1 - r.x0), h: Math.max(0.05, r.y1 - r.y0), flip }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, { design: true });
        return { kind: 'body', obj: b, label: 'Add wedge' };
      },
      preview(ctx, R, app, r, p0, p1) {
        previewGeom(ctx, R, app, { kind: 'wedge', w: Math.max(0.02, r.x1 - r.x0), h: Math.max(0.02, r.y1 - r.y0), flip: p1.x < p0.x }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
        const ang = (Math.atan2(r.y1 - r.y0, r.x1 - r.x0) * 180) / Math.PI;
        sizeTag(R, `${(r.x1 - r.x0).toFixed(2)} × ${(r.y1 - r.y0).toFixed(2)} m · ${ang.toFixed(1)}°`, { x: r.x1, y: r.y1 });
      },
    }),
  },
  {
    id: 'freeform', name: 'Draw shape', icon: 'freeform', key: 'F', group: 'Objects',
    hint: 'Drag to sketch any outline (concave is fine) · or click points and click the first one / press Enter to close',
    options: ['material', 'static'],
    down(app, e) {
      const p = app.snap(e);
      if (this.clickPts && this.clickPts.length >= 3) {
        const f = this.clickPts[0];
        if (Math.hypot(e.sx - app.camera.sx(f.x), e.sy - app.camera.sy(f.y)) < 10) {
          this.finish(app, this.clickPts);
          return;
        }
      }
      this.stroke = [p];
      this.pressed = true;
    },
    move(app, e) {
      if (!this.pressed) return;
      const p = app.snap(e);
      const last = this.stroke[this.stroke.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > Math.max(0.03, 4 / app.camera.scale)) this.stroke.push(p);
    },
    up(app, e) {
      if (!this.pressed) return;
      this.pressed = false;
      if (dragged(app, e) && this.stroke.length > 4) {
        this.clickPts = null;
        this.finish(app, simplify(this.stroke, Math.max(0.01, 2 / app.camera.scale)));
      } else {
        if (!this.clickPts) this.clickPts = [];
        this.clickPts.push(this.stroke[0]);
        app.setHint(`${this.clickPts.length} point(s) — click the first point or press Enter to close, Esc to cancel`);
      }
      this.stroke = null;
    },
    onKey(app, e) {
      if (e.key === 'Enter' && this.clickPts && this.clickPts.length >= 3) {
        this.finish(app, this.clickPts);
        return true;
      }
      return false;
    },
    finish(app, pts) {
      this.clickPts = null;
      if (pts.length < 3) return;
      let cx = 0;
      let cy = 0;
      for (const p of pts) {
        cx += p.x;
        cy += p.y;
      }
      cx /= pts.length;
      cy /= pts.length;
      const local = pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
      const b = newBody(app, { kind: 'poly', points: local }, cx, cy);
      if (b.area < 1e-4) {
        app.world.removeBody(b);
        app.toast('Shape too small', 'warn');
        return;
      }
      // keep the sketched outline where it was drawn (COM may differ from vertex mean)
      b.setDesignPosition(cx, cy);
      finishCreate(app, 'body', b, 'Draw shape');
    },
    cancel() {
      this.clickPts = null;
      this.stroke = null;
      this.pressed = false;
    },
    preview(ctx, R, app) {
      const pts = this.stroke || this.clickPts;
      if (!pts || !pts.length) return;
      const all = this.clickPts && app.pointer ? pts.concat([app.snap(app.pointer)]) : pts;
      previewPoly(ctx, R, all, MATERIALS[app.opts.material]?.color || '#7dd3fc', true);
      if (this.clickPts) {
        const f = R.camera.toScreen(this.clickPts[0].x, this.clickPts[0].y);
        ctx.beginPath();
        ctx.arc(f.x, f.y, 6, 0, TAU);
        ctx.strokeStyle = '#facc15';
        ctx.stroke();
      }
    },
  },
  {
    id: 'container', name: 'Cup / tank / boat', icon: 'container', key: 'U', group: 'Objects',
    hint: 'Drag a rectangle: open cups hold liquid particles, sealed tanks hold internal liquid, boats float by hull',
    ...rectCreate({
      options: ['containerKind', 'material', 'static', 'wall'],
      create(app, r, p0) {
        if (!r) r = { x0: p0.x - 0.6, y0: p0.y - 0.5, x1: p0.x + 0.6, y1: p0.y + 0.5 };
        const kind = app.opts.containerKind;
        const w = Math.max(0.2, r.x1 - r.x0);
        const h = Math.max(0.15, r.y1 - r.y0);
        const extra = { design: true };
        if (kind !== 'container') extra.hull = true;
        if (kind === 'tank') extra.innerLiquid = { liquid: 'water', density: 1000, fraction: 0.4 };
        const b = newBody(app, { kind, w, h, t: app.opts.wall }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, extra);
        return { kind: 'body', obj: b, label: 'Add ' + kind };
      },
      preview(ctx, R, app, r) {
        previewGeom(ctx, R, app, { kind: app.opts.containerKind, w: Math.max(0.2, r.x1 - r.x0), h: Math.max(0.15, r.y1 - r.y0), t: app.opts.wall }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      },
    }),
  },

  // ---------------- static world
  {
    id: 'slope', name: 'Slope (incline)', icon: 'slope', key: 'I', group: 'Ground',
    hint: 'Drag along the slope surface from top to bottom — Shift snaps to 5° steps. Set friction via the material.',
    options: ['material'],
    down(app, e) {
      this.a = app.snap(e);
      this.b = this.a;
    },
    move(app, e) {
      if (!this.a) return;
      let p = app.snap(e);
      if (e.shift) {
        const dx = p.x - this.a.x;
        const dy = p.y - this.a.y;
        const L = Math.hypot(dx, dy);
        const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 36)) * (Math.PI / 36);
        p = { x: this.a.x + Math.cos(ang) * L, y: this.a.y + Math.sin(ang) * L };
      }
      this.b = p;
    },
    geomFor(a, b) {
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      const high = a.y >= b.y ? a : b;
      const low = high === a ? b : a;
      return { geom: { kind: 'wedge', w: Math.max(0.05, w), h: Math.max(0.05, h), flip: high.x > low.x }, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ang: (Math.atan2(h, w) * 180) / Math.PI };
    },
    up(app, e) {
      if (!this.a) return;
      if (!dragged(app, e)) {
        this.b = { x: this.a.x + 4, y: this.a.y - 4 * Math.tan(Math.PI / 6) };
      }
      const g = this.geomFor(this.a, this.b);
      let b;
      if (g.geom.h < 0.06) b = newBody(app, { kind: 'box', w: g.geom.w, h: 0.2 }, g.cx, g.cy - 0.1, { type: 'static', name: 'Platform' });
      else b = newBody(app, g.geom, g.cx, g.cy, { type: 'static', design: true, name: `Slope ${g.ang.toFixed(1)}°` });
      this.a = null;
      finishCreate(app, 'body', b, 'Add slope');
    },
    cancel() {
      this.a = null;
    },
    preview(ctx, R, app) {
      if (!this.a) return;
      const g = this.geomFor(this.a, this.b);
      previewGeom(ctx, R, app, g.geom, g.cx, g.cy);
      sizeTag(R, `${g.ang.toFixed(1)}° · length ${Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y).toFixed(2)} m`, this.b);
    },
  },
  {
    id: 'platform', name: 'Platform (static)', icon: 'platform', key: '', group: 'Ground',
    hint: 'Drag to draw an immovable platform or wall',
    ...rectCreate({
      options: ['material'],
      create(app, r, p0) {
        if (!r) r = { x0: p0.x - 1.5, y0: p0.y - 0.1, x1: p0.x + 1.5, y1: p0.y + 0.1 };
        const b = newBody(app, { kind: 'box', w: Math.max(0.04, r.x1 - r.x0), h: Math.max(0.04, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, { type: 'static', name: 'Platform' });
        return { kind: 'body', obj: b, label: 'Add platform' };
      },
      preview(ctx, R, app, r) {
        previewGeom(ctx, R, app, { kind: 'box', w: Math.max(0.01, r.x1 - r.x0), h: Math.max(0.01, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      },
    }),
  },
  {
    id: 'track', name: 'Draw track / curve', icon: 'track', key: 'T', group: 'Ground',
    hint: 'Drag to draw a smooth static ramp, half-pipe or curve',
    options: ['material', 'trackThickness', 'trackSide'],
    down(app, e) {
      this.pts = [app.snap(e)];
    },
    move(app, e) {
      if (!this.pts) return;
      const p = app.snap(e);
      const last = this.pts[this.pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) > Math.max(0.08, 6 / app.camera.scale)) this.pts.push(p);
    },
    up(app) {
      if (!this.pts) return;
      let pts = this.pts;
      this.pts = null;
      if (pts.length < 2) return;
      pts = simplify(chaikin(pts, 2), 0.004);
      if (pts[pts.length - 1].x < pts[0].x) pts = pts.reverse();
      const geom = { kind: 'track', points: pts, thickness: app.opts.trackThickness, side: app.opts.trackSide === 'above' ? -1 : 1 };
      const b = newBody(app, geom, 0, 0, { type: 'static', design: true, name: 'Track' });
      finishCreate(app, 'body', b, 'Draw track');
    },
    cancel() {
      this.pts = null;
    },
    preview(ctx, R) {
      if (!this.pts || this.pts.length < 2) return;
      const cam = R.camera;
      ctx.beginPath();
      this.pts.forEach((p, i) => (i ? ctx.lineTo(cam.sx(p.x), cam.sy(p.y)) : ctx.moveTo(cam.sx(p.x), cam.sy(p.y))));
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 3;
      ctx.stroke();
    },
  },
  {
    id: 'conveyor', name: 'Conveyor belt', icon: 'conveyor', key: '', group: 'Ground',
    hint: 'Drag to draw a belt; its surface moves at the belt speed (friction carries objects)',
    ...rectCreate({
      options: ['beltSpeed', 'material'],
      create(app, r, p0) {
        if (!r) r = { x0: p0.x - 2, y0: p0.y - 0.15, x1: p0.x + 2, y1: p0.y + 0.15 };
        const b = newBody(app, { kind: 'box', w: Math.max(0.2, r.x1 - r.x0), h: Math.max(0.08, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2,
          { type: 'static', surfaceSpeed: app.opts.beltSpeed, name: 'Conveyor', materialKey: 'rubber', color: '#334155' });
        return { kind: 'body', obj: b, label: 'Add conveyor' };
      },
      preview(ctx, R, app, r) {
        previewGeom(ctx, R, app, { kind: 'box', w: Math.max(0.01, r.x1 - r.x0), h: Math.max(0.01, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      },
    }),
  },
  {
    id: 'mover', name: 'Moving platform', icon: 'moving', key: '', group: 'Ground',
    hint: 'Drag to draw a kinematic platform that oscillates (elevators, shakers, wave paddles)',
    ...rectCreate({
      options: ['motionDir', 'amplitude', 'period', 'material'],
      create(app, r, p0) {
        if (!r) r = { x0: p0.x - 1, y0: p0.y - 0.12, x1: p0.x + 1, y1: p0.y + 0.12 };
        const b = newBody(app, { kind: 'box', w: Math.max(0.1, r.x1 - r.x0), h: Math.max(0.05, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, {
          type: 'kinematic', name: 'Moving platform',
          motion: { type: 'oscillate', direction: +app.opts.motionDir, amplitude: app.opts.amplitude, period: app.opts.period, phase: 0 },
        });
        return { kind: 'body', obj: b, label: 'Add moving platform' };
      },
      preview(ctx, R, app, r) {
        previewGeom(ctx, R, app, { kind: 'box', w: Math.max(0.01, r.x1 - r.x0), h: Math.max(0.01, r.y1 - r.y0) }, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      },
    }),
  },

  // ---------------- connectors
  { id: 'pin', name: 'Pin / hinge', icon: 'pin', key: 'J', group: 'Connect', hint: 'Click on an object to pin it to the background — or where two objects overlap to hinge them together', ...jointClick('pin') },
  { id: 'weld', name: 'Weld (glue)', icon: 'weld', key: '', group: 'Connect', hint: 'Click where two objects overlap to glue them rigidly (or fix one in place)', ...jointClick('weld') },
  { id: 'motor', name: 'Motor', icon: 'motor', key: 'M', group: 'Connect', hint: 'Click on an object to add a motorised axle (wheels, turntables, windmills)', ...jointClick('motor') },
  { id: 'rope', name: 'String / rope', icon: 'rope', key: 'Q', group: 'Connect', hint: 'Drag between two points: an inextensible string that can go slack (pendulums!)', ...distanceTool('rope') },
  { id: 'rod', name: 'Rigid rod', icon: 'rod', key: '', group: 'Connect', hint: 'Drag between two points: a massless rigid rod', ...distanceTool('rod') },
  { id: 'spring', name: 'Spring', icon: 'spring', key: 'S', group: 'Connect', hint: "Drag between two points: Hooke's law spring (rest length = drawn length)", ...distanceTool('spring') },
  { id: 'bungee', name: 'Elastic band', icon: 'bungee', key: '', group: 'Connect', hint: 'Drag between two points: pulls when stretched, goes slack when compressed (slings, bungees)', ...distanceTool('bungee') },
  {
    id: 'chain', name: 'Chain', icon: 'chain', key: '', group: 'Connect',
    hint: 'Drag between two points to build a chain of hinged links that collides with things (hold Alt to leave the end free)',
    options: ['chainLink', 'material'],
    ...(() => {
      const base = lineCreate({
        anchor: true,
        options: ['chainLink', 'material'],
        create(app, a, p1, isDrag, e) {
          const w = app.world;
          const b = pickAnchor(app, p1, a.body === w.ground ? null : a.body);
          const L = Math.hypot(b.world.x - a.world.x, b.world.y - a.world.y);
          if (!isDrag || L < 0.2) {
            app.toast('Drag a longer line to make a chain', 'warn');
            return null;
          }
          const n = Math.max(2, Math.min(80, Math.round(L / app.opts.chainLink)));
          const seg = L / n;
          const dx = (b.world.x - a.world.x) / L;
          const dy = (b.world.y - a.world.y) / L;
          let prev = a.body;
          let first = null;
          for (let i = 0; i < n; i++) {
            const cx = a.world.x + dx * seg * (i + 0.5);
            const cy = a.world.y + dy * seg * (i + 0.5);
            const link = newBody(app, { kind: 'capsule', w: seg * 0.75, r: Math.min(0.05, seg * 0.2) }, cx, cy, { angle: Math.atan2(dy, dx), name: 'Chain link', type: 'dynamic', color: '#94a3b8' });
            if (!first) first = link;
            const jx = a.world.x + dx * seg * i;
            const jy = a.world.y + dy * seg * i;
            w.createJoint('revolute', prev, link, { localA: prev.worldToLocal(jx, jy), localB: link.worldToLocal(jx, jy) });
            prev = link;
          }
          // the far end is pinned (to an object or the background) unless Alt is held
          if (b.body !== w.ground || !e.alt) {
            w.createJoint('revolute', prev, b.body, { localA: prev.worldToLocal(b.world.x, b.world.y), localB: b.body.worldToLocal(b.world.x, b.world.y) });
          }
          return { kind: 'body', obj: first, label: 'Add chain' };
        },
        preview(ctx, R, app, a, p1) {
          previewLine(ctx, R, a.world, p1, '#94a3b8', [2, 3]);
          const L = Math.hypot(p1.x - a.world.x, p1.y - a.world.y);
          sizeTag(R, `${Math.max(2, Math.round(L / app.opts.chainLink))} links`, p1);
        },
      });
      return base;
    })(),
  },
  {
    id: 'pulley', name: 'Pulley', icon: 'pulley', key: '', group: 'Connect',
    hint: 'Drag from one object to another: a rope over two wheels links them (Atwood machine). Move the wheels with their handles.',
    ...lineCreate({
      anchor: true,
      create(app, a, p1, isDrag) {
        const w = app.world;
        const b = pickAnchor(app, p1, a.body);
        if (!isDrag || a.body === w.ground || b.body === w.ground || a.body === b.body) {
          app.toast('Drag from one object to another object', 'warn');
          return null;
        }
        const top = Math.max(a.world.y, b.world.y) + 2;
        let gx1 = a.world.x;
        let gx2 = b.world.x;
        if (Math.abs(gx1 - gx2) < 0.3) {
          gx1 -= 0.25;
          gx2 += 0.25;
        }
        const j = w.createJoint('pulley', a.body, b.body, { localA: a.local, localB: b.local, groundA: { x: gx1, y: top }, groundB: { x: gx2, y: top }, wheelRadius: Math.min(0.6, Math.abs(gx2 - gx1) / 2) });
        j.name = 'Pulley';
        return { kind: 'joint', obj: j, label: 'Add pulley' };
      },
      preview(ctx, R, app, a, p1) {
        const top = Math.max(a.world.y, p1.y) + 2;
        previewLine(ctx, R, a.world, { x: a.world.x, y: top });
        previewLine(ctx, R, { x: a.world.x, y: top }, { x: p1.x, y: top });
        previewLine(ctx, R, { x: p1.x, y: top }, p1);
      },
    }),
  },
  {
    id: 'rail', name: 'Rail / slider', icon: 'rail', key: '', group: 'Connect',
    hint: 'Click an object to constrain it to slide along a straight rail (air track)',
    ...clickCreate({
      options: ['railAngle'],
      create(app, p) {
        const b = app.world.bodyAt(p.x, p.y);
        if (!b || b.type !== 'dynamic') {
          app.toast('Click on a movable object', 'warn');
          return null;
        }
        const a = (app.opts.railAngle * Math.PI) / 180;
        const j = app.world.createJoint('prismatic', app.world.ground, b, { localA: { x: b.x, y: b.y }, localB: { x: 0, y: 0 }, axis: { x: Math.cos(a), y: Math.sin(a) } });
        j.name = 'Rail';
        return { kind: 'joint', obj: j, label: 'Add rail' };
      },
    }),
  },

  // ---------------- liquids
  {
    id: 'pool', name: 'Liquid pool', icon: 'pool', key: '', group: 'Liquids',
    hint: 'Drag a rectangle of liquid: exact buoyancy, viscous drag and surface waves',
    ...rectCreate({
      options: ['liquid'],
      create(app, r, p0) {
        if (!r) r = { x0: p0.x - 2, y0: p0.y - 1.5, x1: p0.x + 2, y1: p0.y };
        const p = new Pool({ x0: r.x0, x1: r.x1, bottom: r.y0, level: r.y1, liquid: app.opts.liquid, name: LIQUIDS[app.opts.liquid].name + ' pool' });
        app.world.pools.push(p);
        app.world.wakeAll();
        return { kind: 'pool', obj: p, label: 'Add pool' };
      },
      preview(ctx, R, app, r) {
        const L = LIQUIDS[app.opts.liquid];
        previewPoly(ctx, R, [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }], L.color);
      },
    }),
  },
  {
    id: 'pour', name: 'Pour liquid', icon: 'pour', key: 'O', group: 'Liquids',
    hint: 'Hold and drag to pour liquid particles · Shift-drag removes them',
    options: ['liquid', 'pourRate', 'brush'],
    down(app, e) {
      this.on = true;
      this.p = { x: e.wx, y: e.wy };
      this.shift = e.shift;
      this.acc = 0;
    },
    move(app, e) {
      this.p = { x: e.wx, y: e.wy };
      this.shift = e.shift;
    },
    up(app) {
      if (this.on) app.commit('Pour');
      this.on = false;
    },
    update(app, dt) {
      if (!this.on) return;
      const f = app.world.fluid;
      const r = app.opts.brush;
      if (this.shift) {
        f.removeInCircle(this.p.x, this.p.y, r);
        return;
      }
      this.acc += app.opts.pourRate * dt;
      let guard = 0;
      while (this.acc >= 1 && guard++ < 50) {
        this.acc -= 1;
        const a = Math.random() * TAU;
        const d = Math.sqrt(Math.random()) * r;
        if (f.add(this.p.x + Math.cos(a) * d, this.p.y + Math.sin(a) * d, 0, -0.5, app.opts.liquid) < 0) {
          app.toast(`Particle limit reached (${f.maxParticles})`, 'warn');
          this.on = false;
          break;
        }
      }
    },
    preview(ctx, R, app) {
      if (!app.pointer) return;
      const s = R.camera.toScreen(app.pointer.wx, app.pointer.wy);
      ctx.beginPath();
      ctx.arc(s.x, s.y, app.opts.brush * R.camera.scale, 0, TAU);
      ctx.strokeStyle = rgba(LIQUIDS[app.opts.liquid].color, 0.8);
      ctx.setLineDash([3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    },
  },
  {
    id: 'faucet', name: 'Faucet', icon: 'faucet', key: '', group: 'Liquids',
    hint: 'Click to place a faucet that continuously emits liquid',
    ...clickCreate({
      options: ['liquid', 'faucetRate'],
      create(app, p) {
        const e = new Emitter({ x: p.x, y: p.y, liquid: app.opts.liquid, rate: app.opts.faucetRate, name: 'Faucet' });
        app.world.emitters.push(e);
        return { kind: 'emitter', obj: e, label: 'Add faucet' };
      },
    }),
  },
  {
    id: 'drain', name: 'Drain', icon: 'drain', key: '', group: 'Liquids',
    hint: 'Drag a rectangle that swallows liquid particles',
    ...rectCreate({
      create(app, r, p0) {
        if (!r) r = { x0: p0.x - 0.6, y0: p0.y - 0.2, x1: p0.x + 0.6, y1: p0.y + 0.2 };
        const d = new Drain({ x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2, w: r.x1 - r.x0, h: r.y1 - r.y0 });
        app.world.drains.push(d);
        return { kind: 'drain', obj: d, label: 'Add drain' };
      },
      preview(ctx, R, app, r) {
        previewPoly(ctx, R, [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }], '#94a3b8');
      },
    }),
  },

  // ---------------- instruments
  {
    id: 'gate', name: 'Photogate', icon: 'gate', key: 'D', group: 'Measure',
    hint: 'Drag a light beam. The 1st gate starts a new chronometer, the next gate stops it. Click for a vertical 1 m beam.',
    ...lineCreate({
      options: ['gateMode'],
      create(app, a, p1, isDrag) {
        const w = app.world;
        let p0 = a.world;
        let q = p1;
        if (!isDrag || Math.hypot(q.x - p0.x, q.y - p0.y) < 0.1) {
          p0 = { x: a.world.x, y: a.world.y - 0.5 };
          q = { x: a.world.x, y: a.world.y + 0.5 };
        }
        // smart link: pair with a timer that has exactly one "start" gate
        let timer = null;
        let action = 'start';
        for (let i = w.timers.length - 1; i >= 0; i--) {
          const t = w.timers[i];
          const linked = w.gates.filter((g) => g.timerId === t.id);
          if (linked.length === 1 && linked[0].action === 'start') {
            timer = t;
            action = 'stop';
            break;
          }
        }
        if (!timer) {
          timer = new Timer({ x: (p0.x + q.x) / 2 + 1.6, y: Math.max(p0.y, q.y) + 0.8, name: 'Timer ' + (w.timers.length + 1) });
          w.timers.push(timer);
        }
        const g = new Gate({ x1: p0.x, y1: p0.y, x2: q.x, y2: q.y, timerId: timer.id, action, mode: app.opts.gateMode, name: (action === 'start' ? 'Start gate ' : 'Stop gate ') + (w.gates.length + 1) });
        w.gates.push(g);
        app.toast(action === 'start' ? `Gate starts “${timer.name}”. Add a second gate to stop it.` : `Gate stops “${timer.name}”.`, 'good');
        return { kind: 'gate', obj: g, label: 'Add photogate' };
      },
      preview(ctx, R, app, a, p1) {
        previewLine(ctx, R, a.world, p1, '#f43f5e');
        sizeTag(R, `${Math.hypot(p1.x - a.world.x, p1.y - a.world.y).toFixed(2)} m`, p1);
      },
    }),
  },
  {
    id: 'timer', name: 'Chronometer', icon: 'timer', key: 'Y', group: 'Measure',
    hint: 'Click to place a stopwatch. Link it to photogates in the Inspector, or start/stop it by hand.',
    ...clickCreate({
      create(app, p) {
        const t = new Timer({ x: p.x, y: p.y, name: 'Timer ' + (app.world.timers.length + 1) });
        app.world.timers.push(t);
        return { kind: 'timer', obj: t, label: 'Add timer' };
      },
    }),
  },
  {
    id: 'ruler', name: 'Ruler', icon: 'ruler', key: 'N', group: 'Measure',
    hint: 'Drag to measure distance and angle (Shift snaps to 15°)',
    ...lineCreate({
      create(app, a, p1, isDrag) {
        if (!isDrag) return null;
        const r = new Ruler({ x1: a.world.x, y1: a.world.y, x2: p1.x, y2: p1.y });
        app.world.rulers.push(r);
        return { kind: 'ruler', obj: r, label: 'Add ruler' };
      },
      preview(ctx, R, app, a, p1) {
        const r = new Ruler({ x1: a.world.x, y1: a.world.y, x2: p1.x, y2: p1.y });
        R.drawRuler(r, false);
      },
    }),
  },
  {
    id: 'label', name: 'Text note', icon: 'label', key: '', group: 'Measure',
    hint: 'Click to add a text note (edit it in the Inspector)',
    ...clickCreate({
      create(app, p) {
        const l = new Label({ x: p.x, y: p.y, text: 'Note' });
        app.world.labels.push(l);
        setTimeout(() => app.focusInspectorText(), 30);
        return { kind: 'label', obj: l, label: 'Add note' };
      },
    }),
  },

  // ---------------- devices
  {
    id: 'cannon', name: 'Cannon', icon: 'cannon', key: 'Z', group: 'Devices',
    hint: 'Click to place a cannon. Select it to aim, set speed and fire (or fire automatically on Play).',
    ...clickCreate({
      options: ['cannonAngle', 'cannonSpeed'],
      create(app, p) {
        const c = new Cannon({ x: p.x, y: p.y, angle: app.opts.cannonAngle, speed: app.opts.cannonSpeed, fireOnStart: true });
        app.world.cannons.push(c);
        return { kind: 'cannon', obj: c, label: 'Add cannon' };
      },
    }),
  },
  {
    id: 'slingshot', name: 'Slingshot', icon: 'slingshot', key: '', group: 'Devices',
    hint: 'Click to place a slingshot, then drag its pouch back and release',
    ...clickCreate({
      options: ['slingK'],
      create(app, p) {
        const s = new Slingshot({ x: p.x, y: p.y, k: app.opts.slingK });
        app.world.slingshots.push(s);
        return { kind: 'slingshot', obj: s, label: 'Add slingshot' };
      },
    }),
  },
  {
    id: 'wavestring', name: 'Wave string', icon: 'wave', key: '', group: 'Devices',
    hint: 'Drag to stretch a string with an oscillator at the start — study standing & travelling waves',
    ...lineCreate({
      create(app, a, p1, isDrag) {
        let q = p1;
        if (!isDrag || Math.hypot(q.x - a.world.x, q.y - a.world.y) < 0.5) q = { x: a.world.x + 8, y: a.world.y };
        const s = new WaveString({ x1: a.world.x, y1: a.world.y, x2: q.x, y2: q.y });
        app.world.waveStrings.push(s);
        return { kind: 'wavestring', obj: s, label: 'Add wave string' };
      },
      preview(ctx, R, app, a, p1) {
        previewLine(ctx, R, a.world, p1, '#f472b6');
      },
    }),
  },
  {
    id: 'attractor', name: 'Gravity well', icon: 'attractor', key: 'A', group: 'Devices',
    hint: 'Click to place a point attractor (F = m·μ/r²) — negative μ repels',
    ...clickCreate({
      options: ['attractorStrength'],
      create(app, p) {
        const a = new Attractor({ x: p.x, y: p.y, strength: app.opts.attractorStrength });
        app.world.attractors.push(a);
        app.world.wakeAll();
        return { kind: 'attractor', obj: a, label: 'Add attractor' };
      },
    }),
  },
  {
    id: 'fan', name: 'Fan / wind zone', icon: 'fan', key: '', group: 'Devices',
    hint: 'Drag in the blowing direction: a region of moving air (needs air density > 0)',
    ...lineCreate({
      options: ['fanSpeed', 'fanWidth'],
      create(app, a, p1, isDrag) {
        let q = p1;
        if (!isDrag) q = { x: a.world.x + 4, y: a.world.y };
        const f = new Fan({ x: a.world.x, y: a.world.y, w: Math.max(0.3, Math.hypot(q.x - a.world.x, q.y - a.world.y)), h: app.opts.fanWidth, angle: Math.atan2(q.y - a.world.y, q.x - a.world.x), speed: app.opts.fanSpeed });
        app.world.fans.push(f);
        app.world.wakeAll();
        if (app.world.settings.airDensity <= 0) app.toast('Note: the room is a vacuum, fans need air to push things', 'warn');
        return { kind: 'fan', obj: f, label: 'Add fan' };
      },
      preview(ctx, R, app, a, p1) {
        const f = new Fan({ x: a.world.x, y: a.world.y, w: Math.max(0.3, Math.hypot(p1.x - a.world.x, p1.y - a.world.y)), h: app.opts.fanWidth, angle: Math.atan2(p1.y - a.world.y, p1.x - a.world.x), speed: app.opts.fanSpeed });
        R.drawFan(f, true);
      },
    }),
  },
];

for (const t of TOOLS) if (!t.options) t.options = [];

export const TOOL_GROUPS = ['Interact', 'Objects', 'Ground', 'Connect', 'Liquids', 'Measure', 'Devices'];

function segPointDist(x0, y0, x1, y1, px, py) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 1e-12 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
}

function segSeg(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

export function toolById(id) {
  return TOOLS.find((t) => t.id === id);
}

export { bodyColor };
