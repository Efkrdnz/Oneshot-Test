// Canvas renderer for the lab: grid, bodies, liquids, connectors,
// instruments, devices, overlays, selection and tool previews.

import { MATERIALS, LIQUIDS, LIQUID_KEYS } from '../engine/materials.js';
import { innerLiquidState } from '../engine/forces.js';
import { predictTrajectory } from '../engine/devices.js';
import { handlesOf } from './entities.js';

const TAU = Math.PI * 2;

export function fmtTime(t) {
  if (t === null || t === undefined || !isFinite(t)) return '—';
  if (t < 60) return t.toFixed(3);
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`;
}

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export function shade(hex, f) {
  // f > 0 lighten, f < 0 darken
  const [r, g, b] = hexToRgb(hex);
  const t = f < 0 ? 0 : 255;
  const p = Math.abs(f);
  const c = (x) => Math.round((t - x) * p + x);
  return `rgb(${c(r)},${c(g)},${c(b)})`;
}

export function bodyColor(b) {
  if (b.color) return b.color;
  const m = MATERIALS[b.material.key];
  return m ? m.color : '#94a3b8';
}

export class Renderer {
  constructor(canvas, camera) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.camera = camera;
    this.dpr = 1;
    this.hatch = null;
    this.time = 0;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(r.width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * this.dpr));
    this.camera.resize(r.width, r.height);
    this.hatch = null;
  }

  hatchPattern() {
    if (this.hatch) return this.hatch;
    const c = document.createElement('canvas');
    c.width = c.height = 10;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-2, 12);
    g.lineTo(12, -2);
    g.moveTo(-2, 2);
    g.lineTo(2, -2);
    g.moveTo(8, 12);
    g.lineTo(12, 8);
    g.stroke();
    this.hatch = this.ctx.createPattern(c, 'repeat');
    return this.hatch;
  }

  // ------------------------------------------------------------------------------
  render(app, alpha = 1, realDt = 0.016) {
    const ctx = this.ctx;
    const cam = this.camera;
    this.time += realDt;
    const world = app.world;
    const disp = app.display;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(world, disp);
    const interp = app.running ? alpha : 1;
    const pose = (b) => {
      if (interp >= 1 || b.type === 'static') return { x: b.x, y: b.y, a: b.angle };
      return { x: b.px + (b.x - b.px) * interp, y: b.py + (b.y - b.py) * interp, a: b.pa + (b.angle - b.pa) * interp };
    };
    this.pose = pose;

    for (const f of world.fans) this.drawFan(f, app.isSelected('fan', f));
    for (const d of world.drains) this.drawDrain(d, app.isSelected('drain', d));
    for (const p of world.pools) this.drawPoolBack(p, app.isSelected('pool', p));

    if (disp.trails) for (const b of world.bodies) if (b.trail) this.drawTrail(b, disp);

    // bodies: static first
    for (const b of world.bodies) if (b.type === 'static') this.drawBody(b, pose(b), app, disp);
    for (const b of world.bodies) if (b.type !== 'static') this.drawBody(b, pose(b), app, disp);

    this.drawParticles(world);
    for (const p of world.pools) this.drawPoolFront(p);
    this.drawSplashes(world);

    for (const j of world.joints) this.drawJoint(j, app, disp);
    if (world.mouseJoint) this.drawMouseJoint(world.mouseJoint);
    for (const s of world.waveStrings) this.drawWaveString(s, app.isSelected('wavestring', s));
    for (const a of world.attractors) this.drawAttractor(a, app.isSelected('attractor', a));
    for (const e of world.emitters) this.drawEmitter(e, app.isSelected('emitter', e));
    for (const c of world.cannons) this.drawCannon(c, world, app.isSelected('cannon', c));
    for (const s of world.slingshots) this.drawSlingshot(s, world, app.isSelected('slingshot', s));
    for (const g of world.gates) this.drawGate(g, world, app.isSelected('gate', g));
    for (const r of world.rulers) this.drawRuler(r, app.isSelected('ruler', r));
    for (const l of world.labels) this.drawLabel(l, app.isSelected('label', l));

    if (disp.vectors || disp.forces !== 'off') {
      for (const b of world.bodies) {
        if (b.type !== 'dynamic') continue;
        const sel = app.isSelected('body', b);
        if (disp.vectors) this.drawVelocity(b, pose(b));
        if (disp.forces === 'all' || (disp.forces === 'selected' && sel)) this.drawForces(b, pose(b), world);
      }
    }
    if (disp.contacts) this.drawContacts(world);
    for (const t of world.timers) this.drawTimer(t, world, app.isSelected('timer', t));

    // selection handles
    if (app.selection.length === 1) {
      const s = app.selection[0];
      if (s.kind === 'body' && !s.obj.room) this.drawRotateHandle(s.obj);
      for (const h of handlesOf(s.kind, s.obj, app)) this.drawHandle(h.x, h.y, app.hoverHandle === h);
    }
    if (app.tool && app.tool.preview) {
      ctx.save();
      app.tool.preview(ctx, this, app);
      ctx.restore();
    }
    if (app.marquee) {
      const m = app.marquee;
      const a = cam.toScreen(m.x0, m.y0);
      const b = cam.toScreen(m.x1, m.y1);
      ctx.fillStyle = 'rgba(56,189,248,0.08)';
      ctx.strokeStyle = 'rgba(56,189,248,0.7)';
      ctx.setLineDash([5, 4]);
      ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([]);
    }
    this.drawScaleBar();
  }

  // ------------------------------------------------------------------------------
  drawBackground(world, disp) {
    const ctx = this.ctx;
    const cam = this.camera;
    const W = cam.w;
    const H = cam.h;
    const g = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#0d1528');
    g.addColorStop(1, '#060a13');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const r = world.settings.room;
    // room interior
    const a = cam.toScreen(r.left, r.top);
    const b = cam.toScreen(r.right, r.bottom);
    ctx.fillStyle = 'rgba(56, 120, 220, 0.035)';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    if (disp.grid) this.drawGrid();
    ctx.strokeStyle = 'rgba(125, 160, 220, 0.22)';
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
  }

  gridStep() {
    const s = this.camera.scale;
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
    for (const st of steps) if (st * s >= 16) return st;
    return 100;
  }

  drawGrid() {
    const ctx = this.ctx;
    const cam = this.camera;
    const v = cam.viewRect();
    const step = this.gridStep();
    const major = step * (String(step).startsWith('2') ? 5 : step >= 1 && String(step).startsWith('5') ? 2 : 5);
    ctx.lineWidth = 1;
    const x0 = Math.floor(v.minX / step) * step;
    const y0 = Math.floor(v.minY / step) * step;
    ctx.beginPath();
    for (let x = x0; x <= v.maxX; x += step) {
      if (Math.abs(x / major - Math.round(x / major)) < 1e-6) continue;
      const sx = Math.round(cam.sx(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, cam.h);
    }
    for (let y = y0; y <= v.maxY; y += step) {
      if (Math.abs(y / major - Math.round(y / major)) < 1e-6) continue;
      const sy = Math.round(cam.sy(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(cam.w, sy);
    }
    ctx.strokeStyle = 'rgba(148, 180, 255, 0.045)';
    ctx.stroke();
    ctx.beginPath();
    const mx0 = Math.floor(v.minX / major) * major;
    const my0 = Math.floor(v.minY / major) * major;
    for (let x = mx0; x <= v.maxX; x += major) {
      const sx = Math.round(cam.sx(x)) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, cam.h);
    }
    for (let y = my0; y <= v.maxY; y += major) {
      const sy = Math.round(cam.sy(y)) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(cam.w, sy);
    }
    ctx.strokeStyle = 'rgba(148, 180, 255, 0.09)';
    ctx.stroke();
    // axes
    ctx.beginPath();
    const ax = Math.round(cam.sx(0)) + 0.5;
    const ay = Math.round(cam.sy(0)) + 0.5;
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, cam.h);
    ctx.moveTo(0, ay);
    ctx.lineTo(cam.w, ay);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.stroke();
    // labels along edges
    ctx.fillStyle = 'rgba(148, 170, 210, 0.55)';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const fmt = (n) => (Math.abs(n) < 1e-9 ? '0' : major < 1 ? n.toFixed(major < 0.1 ? 2 : 1) : String(Math.round(n)));
    for (let x = mx0; x <= v.maxX; x += major) ctx.fillText(fmt(x), cam.sx(x), cam.h - 4);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let y = my0; y <= v.maxY; y += major) ctx.fillText(fmt(y), 4, cam.sy(y));
  }

  drawScaleBar() {
    if (this.thumb) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const target = 90;
    const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    let len = 1;
    for (const s of steps) if (s * cam.scale <= target) len = s;
    const px = len * cam.scale;
    const x = 34;
    const y = cam.h - 26;
    ctx.strokeStyle = 'rgba(226,232,240,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.lineTo(x + px, y - 4);
    ctx.stroke();
    ctx.fillStyle = 'rgba(226,232,240,0.8)';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(len >= 1 ? `${len} m` : `${Math.round(len * 100)} cm`, x + px / 2, y - 5);
  }

  // ------------------------------------------------------------------------------
  shapePath(sh, p) {
    const ctx = this.ctx;
    const cam = this.camera;
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    if (sh.type === 'circle') {
      const wx = p.x + c * sh.x - s * sh.y;
      const wy = p.y + s * sh.x + c * sh.y;
      ctx.moveTo(cam.sx(wx) + sh.r * cam.scale, cam.sy(wy));
      ctx.arc(cam.sx(wx), cam.sy(wy), Math.max(0.5, sh.r * cam.scale), 0, TAU);
    } else {
      for (let i = 0; i < sh.count; i++) {
        const v = sh.verts[i];
        const sx = cam.sx(p.x + c * v.x - s * v.y);
        const sy = cam.sy(p.y + s * v.x + c * v.y);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    }
  }

  // outline of boundary edges only (skip ghost edges between pieces)
  outlinePath(sh, p) {
    const ctx = this.ctx;
    const cam = this.camera;
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    if (sh.type === 'circle') {
      this.shapePath(sh, p);
      return;
    }
    for (let i = 0; i < sh.count; i++) {
      if (sh.ghost[i]) continue;
      const v = sh.verts[i];
      const u = sh.verts[(i + 1) % sh.count];
      ctx.moveTo(cam.sx(p.x + c * v.x - s * v.y), cam.sy(p.y + s * v.x + c * v.y));
      ctx.lineTo(cam.sx(p.x + c * u.x - s * u.y), cam.sy(p.y + s * u.x + c * u.y));
    }
  }

  drawBody(b, p, app, disp) {
    const ctx = this.ctx;
    const cam = this.camera;
    const sel = app.isSelected('body', b);
    const hov = app.hover && app.hover.kind === 'body' && app.hover.obj === b;
    const col = bodyColor(b);
    const isStatic = b.type === 'static';
    // cull
    const r = b.radius * cam.scale + 20;
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    if (sx < -r || sy < -r || sx > cam.w + r || sy > cam.h + r) return;

    ctx.beginPath();
    for (const sh of b.shapes) this.shapePath(sh, p);
    if (isStatic) {
      ctx.fillStyle = b.room ? '#141c30' : shade(col, -0.55);
      ctx.fill();
      ctx.fillStyle = this.hatchPattern();
      ctx.fill();
    } else {
      const sleeping = disp.sleep && !b.awake;
      ctx.fillStyle = rgba(col, sleeping ? 0.45 : 0.88);
      ctx.fill();
    }
    // inner liquid
    if (b.innerLiquid && b.interiorLocal) {
      const st = innerLiquidState(b, app.world.settings.gravity);
      if (st) {
        const L = LIQUIDS[b.innerLiquid.liquid] || LIQUIDS.water;
        ctx.beginPath();
        st.poly.forEach((q, i) => (i ? ctx.lineTo(cam.sx(q.x), cam.sy(q.y)) : ctx.moveTo(cam.sx(q.x), cam.sy(q.y))));
        ctx.closePath();
        ctx.fillStyle = rgba(L.color, 0.75);
        ctx.fill();
      }
      // interior (air) tint for hollow bodies
    }
    ctx.beginPath();
    for (const sh of b.shapes) this.outlinePath(sh, p);
    ctx.lineJoin = 'round';
    if (sel) {
      ctx.save();
      ctx.shadowColor = 'rgba(56,189,248,0.9)';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.strokeStyle = b.room ? '#2a3a5e' : isStatic ? shade(col, -0.15) : hov ? '#ffffff' : shade(col, 0.35);
      ctx.lineWidth = hov ? 2 : 1.3;
      if (b.type === 'kinematic') ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // rotation marker for circles
    for (const sh of b.shapes) {
      if (sh.type !== 'circle' || sh.r * cam.scale < 6) continue;
      const c = Math.cos(p.a);
      const s = Math.sin(p.a);
      const wx = p.x + c * sh.x - s * sh.y;
      const wy = p.y + s * sh.x + c * sh.y;
      ctx.beginPath();
      ctx.moveTo(cam.sx(wx), cam.sy(wy));
      ctx.lineTo(cam.sx(wx + c * sh.r * 0.85), cam.sy(wy + s * sh.r * 0.85));
      ctx.strokeStyle = isStatic ? 'rgba(255,255,255,0.15)' : 'rgba(10,15,28,0.55)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    // conveyor arrows
    if (b.surfaceSpeed) this.drawConveyorMarks(b, p);
    // COM
    if (disp.com && !isStatic) this.drawCOM(sx, sy);
    if ((b.showLabel || disp.labels) && !b.room && !this.thumb) {
      const showMass = b.type === 'dynamic' && !/\bk?g\b/.test(b.name || '');
      const txt = `${b.name || ''}${b.name && (showMass || b.type !== 'dynamic') ? ' · ' : ''}${showMass ? fmtMass(b.mass) : b.type === 'dynamic' ? '' : b.type}`;
      ctx.font = '600 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const ty = cam.sy(b.aabb.maxY + (p.y - b.y)) - 5;
      ctx.fillStyle = 'rgba(5,9,18,0.75)';
      const tw = ctx.measureText(txt).width;
      ctx.fillRect(sx - tw / 2 - 4, ty - 15, tw + 8, 16);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(txt, sx, ty);
    }
  }

  drawConveyorMarks(b, p) {
    const ctx = this.ctx;
    const cam = this.camera;
    const hl = b.hullLocal;
    if (!hl.length) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const q of hl) {
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    const len = maxX - minX;
    const spacing = 0.5;
    const off = ((this.time * b.surfaceSpeed) % spacing + spacing) % spacing;
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const dir = Math.sign(b.surfaceSpeed);
    for (let d = off; d < len; d += spacing) {
      const lx = minX + d;
      const ly = maxY - 0.04;
      const ax = p.x + c * lx - s * ly;
      const ay = p.y + s * lx + c * ly;
      const ex = ax + c * 0.12 * dir;
      const ey = ay + s * 0.12 * dir;
      const nx = -s * 0.06;
      const ny = c * 0.06;
      ctx.moveTo(cam.sx(ax + nx), cam.sy(ay + ny));
      ctx.lineTo(cam.sx(ex), cam.sy(ey));
      ctx.lineTo(cam.sx(ax - nx), cam.sy(ay - ny));
    }
    ctx.stroke();
  }

  drawCOM(sx, sy) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, TAU);
    ctx.fillStyle = '#0b1020';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, 5, 0, Math.PI / 2);
    ctx.closePath();
    ctx.moveTo(sx, sy);
    ctx.arc(sx, sy, 5, Math.PI, Math.PI * 1.5);
    ctx.closePath();
    ctx.fillStyle = '#facc15';
    ctx.fill();
  }

  drawTrail(b, disp) {
    const ctx = this.ctx;
    const cam = this.camera;
    const pts = b.trailPts;
    const col = bodyColor(b);
    if (pts.length >= 4) {
      ctx.beginPath();
      ctx.moveTo(cam.sx(pts[0]), cam.sy(pts[1]));
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(cam.sx(pts[i]), cam.sy(pts[i + 1]));
      ctx.lineTo(cam.sx(b.x), cam.sy(b.y));
      ctx.strokeStyle = rgba(col, 0.55);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    if (disp.strobe && b.strobe.length) {
      for (const g of b.strobe) {
        ctx.beginPath();
        for (const sh of b.shapes) this.shapePath(sh, { x: g.x, y: g.y, a: g.a });
        ctx.strokeStyle = rgba(col, 0.32);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    } else if (pts.length >= 4) {
      // time ticks every 0.1 s (3 samples at 30 Hz trail rate)
      ctx.fillStyle = rgba(col, 0.8);
      for (let i = 0; i < pts.length; i += 6) {
        ctx.beginPath();
        ctx.arc(cam.sx(pts[i]), cam.sy(pts[i + 1]), 1.8, 0, TAU);
        ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------------------------
  drawPoolBack(p, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const L = p.color;
    const x0 = cam.sx(p.x0);
    const x1 = cam.sx(p.x1);
    const yb = cam.sy(p.bottom);
    const ys = cam.sy(p.level);
    const grad = ctx.createLinearGradient(0, ys, 0, yb);
    grad.addColorStop(0, rgba(L, 0.34));
    grad.addColorStop(1, rgba(L, 0.6));
    ctx.beginPath();
    this.poolSurfacePath(p, true);
    ctx.fillStyle = grad;
    ctx.fill();
    if (sel) {
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x0, ys, x1 - x0, yb - ys);
      ctx.setLineDash([]);
    }
    // label
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = rgba('#e2e8f0', 0.65);
    if (x1 - x0 > 90 && !this.thumb) ctx.fillText(`${p.name} · ρ ${Math.round(p.density)} kg/m³`, x0 + 6, cam.sy(p.level - 0.05) + 6);
  }

  poolSurfacePath(p, closed) {
    const ctx = this.ctx;
    const cam = this.camera;
    const n = p.n;
    const step = Math.max(1, Math.floor(n / Math.max(20, (p.x1 - p.x0) * cam.scale / 3)));
    ctx.moveTo(cam.sx(p.x0), cam.sy(p.level + (p.waves ? p.h[0] : 0)));
    for (let i = 0; i < n; i += step) {
      const x = p.x0 + (i + 0.5) * p.dx;
      ctx.lineTo(cam.sx(x), cam.sy(p.level + (p.waves ? p.h[i] : 0)));
    }
    ctx.lineTo(cam.sx(p.x1), cam.sy(p.level + (p.waves ? p.h[n - 1] : 0)));
    if (closed) {
      ctx.lineTo(cam.sx(p.x1), cam.sy(p.bottom));
      ctx.lineTo(cam.sx(p.x0), cam.sy(p.bottom));
      ctx.closePath();
    }
  }

  drawPoolFront(p) {
    const ctx = this.ctx;
    ctx.beginPath();
    this.poolSurfacePath(p, false);
    ctx.strokeStyle = rgba(p.color, 0.95);
    ctx.lineWidth = 2;
    ctx.stroke();
    // subtle front tint so submerged bodies look under water
    ctx.beginPath();
    this.poolSurfacePath(p, true);
    ctx.fillStyle = rgba(p.color, 0.12);
    ctx.fill();
    if (p.generator.on) {
      const cam = this.camera;
      const x = p.generator.side === 'right' ? p.x1 : p.x0;
      const y = p.level + (p.generator.side === 'right' ? p.h[p.n - 1] : p.h[0]);
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(cam.sx(x), cam.sy(y), 4, 0, TAU);
      ctx.fill();
    }
  }

  drawParticles(world) {
    const f = world.fluid;
    if (!f.count) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const r = Math.max(1.5, f.radius * 1.35 * cam.scale);
    const groups = new Map();
    for (let i = 0; i < f.count; i++) {
      const t = f.type[i];
      let arr = groups.get(t);
      if (!arr) groups.set(t, (arr = []));
      arr.push(i);
    }
    for (const [t, arr] of groups) {
      const L = LIQUIDS[LIQUID_KEYS[t]] || LIQUIDS.water;
      ctx.beginPath();
      for (const i of arr) {
        const sx = cam.sx(f.x[i]);
        const sy = cam.sy(f.y[i]);
        ctx.moveTo(sx + r, sy);
        ctx.arc(sx, sy, r, 0, TAU);
      }
      ctx.fillStyle = rgba(L.color, 0.55);
      ctx.fill();
      ctx.beginPath();
      const r2 = r * 0.45;
      for (const i of arr) {
        const sx = cam.sx(f.x[i]) - r * 0.2;
        const sy = cam.sy(f.y[i]) - r * 0.2;
        ctx.moveTo(sx + r2, sy);
        ctx.arc(sx, sy, r2, 0, TAU);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fill();
    }
  }

  drawSplashes(world) {
    if (!world.splashes.length) return;
    const ctx = this.ctx;
    const cam = this.camera;
    for (const s of world.splashes) {
      ctx.fillStyle = rgba(s.color, Math.min(0.9, s.life));
      ctx.beginPath();
      ctx.arc(cam.sx(s.x), cam.sy(s.y), 2, 0, TAU);
      ctx.fill();
    }
  }

  // ------------------------------------------------------------------------------
  anchorPos(j, which) {
    const b = which === 'A' ? j.bodyA : j.bodyB;
    const l = which === 'A' ? j.localA : j.localB;
    const p = this.pose(b);
    const c = Math.cos(p.a);
    const s = Math.sin(p.a);
    return { x: p.x + c * l.x - s * l.y, y: p.y + s * l.x + c * l.y };
  }

  drawJoint(j, app, disp) {
    if (j.internal) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const sel = app.isSelected('joint', j);
    const hov = app.hover && app.hover.kind === 'joint' && app.hover.obj === j;
    const a = this.anchorPos(j, 'A');
    const b = this.anchorPos(j, 'B');
    const A = cam.toScreen(a.x, a.y);
    const Bp = cam.toScreen(b.x, b.y);
    const glow = sel ? '#7dd3fc' : hov ? '#ffffff' : null;
    ctx.save();
    if (glow) {
      ctx.shadowColor = glow;
      ctx.shadowBlur = 10;
    }
    if (j.type === 'revolute') {
      const groundA = j.bodyA === app.world.ground;
      if (groundA) this.drawMount(Bp.x, Bp.y);
      ctx.beginPath();
      ctx.arc(Bp.x, Bp.y, 5.5, 0, TAU);
      ctx.fillStyle = '#0b1020';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = glow || (j.lockAngle ? '#f59e0b' : j.enableMotor ? '#4ade80' : '#e2e8f0');
      ctx.stroke();
      if (j.lockAngle) {
        ctx.beginPath();
        ctx.moveTo(Bp.x - 3, Bp.y - 3);
        ctx.lineTo(Bp.x + 3, Bp.y + 3);
        ctx.moveTo(Bp.x + 3, Bp.y - 3);
        ctx.lineTo(Bp.x - 3, Bp.y + 3);
        ctx.stroke();
      } else if (j.enableMotor) {
        const ang = this.time * -j.motorSpeed;
        ctx.beginPath();
        ctx.arc(Bp.x, Bp.y, 10, ang, ang + 4.2, j.motorSpeed > 0);
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.8)';
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(Bp.x, Bp.y, 1.8, 0, TAU);
        ctx.fillStyle = '#e2e8f0';
        ctx.fill();
      }
    } else if (j.type === 'distance') {
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (j.mode === 'rod') {
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        ctx.lineTo(Bp.x, Bp.y);
        ctx.strokeStyle = glow || '#94a3b8';
        ctx.lineWidth = Math.max(3, 0.06 * cam.scale);
        ctx.stroke();
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.stroke();
      } else if (j.mode === 'rope' || (j.mode === 'bungee' && L < j.length)) {
        const slack = Math.max(0, j.length - L);
        ctx.beginPath();
        ctx.moveTo(A.x, A.y);
        if (slack > 0.005) {
          const sag = Math.sqrt((3 / 8) * j.length * slack) * cam.scale;
          const mx = (A.x + Bp.x) / 2;
          const my = (A.y + Bp.y) / 2 + sag * 1.6;
          ctx.quadraticCurveTo(mx, my, Bp.x, Bp.y);
        } else ctx.lineTo(Bp.x, Bp.y);
        ctx.strokeStyle = glow || (j.mode === 'bungee' ? '#fb923c' : '#e7d3a8');
        ctx.lineWidth = j.mode === 'bungee' ? 2.5 : 1.8;
        ctx.stroke();
      } else {
        // spring / stretched bungee: zig-zag coil coloured by strain
        const strain = (L - j.length) / Math.max(0.05, j.length);
        const col = strain > 0.01 ? mixColor('#e2e8f0', '#f43f5e', Math.min(1, strain * 2)) : strain < -0.01 ? mixColor('#e2e8f0', '#38bdf8', Math.min(1, -strain * 2)) : '#e2e8f0';
        this.drawCoil(A, Bp, j.coils || 12, Math.max(4, Math.min(12, 0.12 * cam.scale)), glow || col, j.mode === 'bungee');
      }
      for (const P of [A, Bp]) {
        ctx.beginPath();
        ctx.arc(P.x, P.y, 3, 0, TAU);
        ctx.fillStyle = '#e2e8f0';
        ctx.fill();
      }
      if (j.bodyA === app.world.ground) this.drawMount(A.x, A.y);
    } else if (j.type === 'pulley') {
      this.drawPulley(j, a, b, glow);
    } else if (j.type === 'prismatic') {
      const ax = j.localAxis;
      const ca = Math.cos(j.bodyA.angle);
      const sa = Math.sin(j.bodyA.angle);
      const dx = ca * ax.x - sa * ax.y;
      const dy = sa * ax.x + ca * ax.y;
      const ext = 30;
      ctx.beginPath();
      ctx.moveTo(cam.sx(a.x - dx * ext), cam.sy(a.y - dy * ext));
      ctx.lineTo(cam.sx(a.x + dx * ext), cam.sy(a.y + dy * ext));
      ctx.strokeStyle = glow || 'rgba(167, 139, 250, 0.55)';
      ctx.setLineDash([8, 6]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.rect(Bp.x - 6, Bp.y - 6, 12, 12);
      ctx.fillStyle = '#0b1020';
      ctx.fill();
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
    if ((disp.jointForces || j.showForce || sel) && j.force !== undefined && app.world.time > 0) {
      const mx = (A.x + Bp.x) / 2;
      const my = (A.y + Bp.y) / 2;
      let txt = `${fmtForce(j.type === 'distance' && j.tension !== undefined ? j.tension : j.force)}`;
      if (j.type === 'distance' && (j.mode === 'spring' || j.mode === 'bungee')) txt += ` · Δx ${((j.currentLength() - j.length) * 100).toFixed(1)} cm`;
      this.tag(txt, mx + 8, my - 8, '#fda4af');
    }
  }

  drawMount(x, y) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 7, y - 10);
    ctx.lineTo(x + 7, y - 10);
    ctx.closePath();
    ctx.fillStyle = 'rgba(148,163,184,0.25)';
    ctx.strokeStyle = 'rgba(148,163,184,0.7)';
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
  }

  drawCoil(A, B, coils, amp, color, thin) {
    const ctx = this.ctx;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const L = Math.hypot(dx, dy);
    if (L < 1) return;
    const ux = dx / L;
    const uy = dy / L;
    const px = -uy;
    const py = ux;
    const lead = Math.min(10, L * 0.12);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(A.x + ux * lead, A.y + uy * lead);
    const n = coils * 2;
    const seg = (L - 2 * lead) / n;
    for (let i = 1; i <= n; i++) {
      const s = lead + seg * (i - 0.5);
      const side = i % 2 ? 1 : -1;
      ctx.lineTo(A.x + ux * s + px * amp * side, A.y + uy * s + py * amp * side);
    }
    ctx.lineTo(B.x - ux * lead, B.y - uy * lead);
    ctx.lineTo(B.x, B.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = thin ? 1.8 : 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  drawPulley(j, a, b, glow) {
    const ctx = this.ctx;
    const cam = this.camera;
    const gA = j.groundA;
    const gB = j.groundB;
    const d = Math.hypot(gB.x - gA.x, gB.y - gA.y);
    ctx.strokeStyle = glow || '#e7d3a8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cam.sx(a.x), cam.sy(a.y));
    ctx.lineTo(cam.sx(gA.x), cam.sy(gA.y));
    ctx.moveTo(cam.sx(b.x), cam.sy(b.y));
    ctx.lineTo(cam.sx(gB.x), cam.sy(gB.y));
    ctx.stroke();
    const wheels = [];
    if (d <= 2 * j.wheelRadius + 0.05) {
      const r = d / 2;
      wheels.push({ x: (gA.x + gB.x) / 2, y: (gA.y + gB.y) / 2, r });
      ctx.beginPath();
      ctx.arc(cam.sx(wheels[0].x), cam.sy(wheels[0].y), r * cam.scale, Math.PI, 0);
      ctx.stroke();
    } else {
      const r = Math.min(j.wheelRadius, d / 3);
      ctx.beginPath();
      ctx.moveTo(cam.sx(gA.x), cam.sy(gA.y));
      ctx.lineTo(cam.sx(gB.x), cam.sy(gB.y));
      ctx.stroke();
      wheels.push({ x: gA.x + (gA.x < gB.x ? r : -r) * 0, y: gA.y, r }, { x: gB.x, y: gB.y, r });
    }
    for (const w of wheels) {
      const sx = cam.sx(w.x);
      const sy = cam.sy(w.y);
      const rr = Math.max(5, w.r * cam.scale);
      ctx.beginPath();
      ctx.arc(sx, sy, rr, 0, TAU);
      ctx.fillStyle = 'rgba(30,41,59,0.9)';
      ctx.fill();
      ctx.strokeStyle = glow || '#94a3b8';
      ctx.lineWidth = 2;
      ctx.stroke();
      const ang = this.time;
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const t = ang * 0 + (k * TAU) / 3;
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(t) * rr * 0.8, sy + Math.sin(t) * rr * 0.8);
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, TAU);
      ctx.fillStyle = '#e2e8f0';
      ctx.fill();
    }
  }

  drawMouseJoint(mj) {
    const ctx = this.ctx;
    const cam = this.camera;
    const b = this.anchorPos(mj, 'B');
    const A = cam.toScreen(mj.target.x, mj.target.y);
    const B = cam.toScreen(b.x, b.y);
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.85)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(A.x, A.y, 4, 0, TAU);
    ctx.arc(B.x, B.y, 3, 0, TAU);
    ctx.fillStyle = '#facc15';
    ctx.fill();
  }

  // ------------------------------------------------------------------------------
  drawWaveString(s, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    ctx.beginPath();
    for (let i = 0; i < s.nodes; i++) {
      const p = s.nodePos(i);
      if (i === 0) ctx.moveTo(cam.sx(p.x), cam.sy(p.y));
      else ctx.lineTo(cam.sx(p.x), cam.sy(p.y));
    }
    ctx.save();
    ctx.shadowColor = s.color;
    ctx.shadowBlur = sel ? 14 : 6;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = sel ? 3 : 2.2;
    ctx.stroke();
    ctx.restore();
    if (s.showNodes) {
      ctx.fillStyle = '#fff';
      for (let i = 0; i < s.nodes; i += 4) {
        const p = s.nodePos(i);
        ctx.fillRect(cam.sx(p.x) - 1, cam.sy(p.y) - 1, 2, 2);
      }
    }
    // driver
    const p0 = s.nodePos(0);
    const A = cam.toScreen(s.x1, s.y1);
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(A.x - 16, A.y - 14, 12, 28);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(A.x - 4, cam.sy(p0.y));
    ctx.lineTo(cam.sx(p0.x), cam.sy(p0.y));
    ctx.strokeStyle = '#facc15';
    ctx.stroke();
    // far end
    const B = cam.toScreen(s.x2, s.y2);
    if (s.endB === 'fixed') {
      ctx.fillStyle = 'rgba(148,163,184,0.35)';
      ctx.fillRect(B.x, B.y - 14, 6, 28);
    } else if (s.endB === 'free') {
      ctx.strokeStyle = 'rgba(148,163,184,0.6)';
      ctx.beginPath();
      ctx.moveTo(B.x + 4, B.y - 30);
      ctx.lineTo(B.x + 4, B.y + 30);
      ctx.stroke();
      const pn = s.nodePos(s.nodes - 1);
      ctx.beginPath();
      ctx.arc(cam.sx(pn.x) + 4, cam.sy(pn.y), 4, 0, TAU);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(74, 222, 128, 0.18)';
      ctx.fillRect(B.x - 2, B.y - 18, 12, 36);
    }
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = this.thumb ? 'rgba(0,0,0,0)' : 'rgba(226,232,240,0.7)';
    ctx.fillText(`v = ${s.speed.toFixed(1)} m/s · f = ${s.driver.type === 'none' ? '—' : s.driver.frequency.toFixed(2) + ' Hz'}`, A.x - 16, A.y - 20);
  }

  drawAttractor(a, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const s = cam.toScreen(a.x, a.y);
    const r = Math.max(8, Math.max(0.4, a.radius) * cam.scale);
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3);
    g.addColorStop(0, 'rgba(167,139,250,0.55)');
    g.addColorStop(1, 'rgba(167,139,250,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r * 3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = sel ? '#7dd3fc' : 'rgba(196,181,253,0.6)';
    ctx.setLineDash([3, 5]);
    for (let k = 1; k <= 3; k++) {
      ctx.beginPath();
      const ph = (this.time * 0.6 + k / 3) % 1;
      ctx.arc(s.x, s.y, r * (1 + 2.2 * (1 - ph)), 0, TAU);
      ctx.globalAlpha = ph;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, 4, 0, TAU);
    ctx.fillStyle = '#ede9fe';
    ctx.fill();
  }

  drawFan(f, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const c = Math.cos(f.angle);
    const s = Math.sin(f.angle);
    const corners = [[0, -f.h / 2], [f.w, -f.h / 2], [f.w, f.h / 2], [0, f.h / 2]].map(([lx, ly]) => cam.toScreen(f.x + c * lx - s * ly, f.y + s * lx + c * ly));
    ctx.beginPath();
    corners.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = f.on ? 'rgba(125, 211, 252, 0.05)' : 'rgba(148,163,184,0.03)';
    ctx.fill();
    ctx.strokeStyle = sel ? '#7dd3fc' : 'rgba(125, 211, 252, 0.25)';
    ctx.setLineDash([4, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (f.on) {
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.45)';
      ctx.lineWidth = 1.2;
      const rows = Math.max(2, Math.round(f.h / 0.5));
      const phase = (this.time * f.speed * 0.25) % 0.8;
      ctx.beginPath();
      for (let r = 0; r < rows; r++) {
        const ly = -f.h / 2 + (r + 0.5) * (f.h / rows);
        for (let lx = phase; lx < f.w - 0.2; lx += 0.8) {
          const a = cam.toScreen(f.x + c * lx - s * ly, f.y + s * lx + c * ly);
          const b = cam.toScreen(f.x + c * (lx + 0.3) - s * ly, f.y + s * (lx + 0.3) + c * ly);
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
        }
      }
      ctx.stroke();
    }
    // fan unit
    const o = cam.toScreen(f.x, f.y);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(-f.angle);
    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-10, -Math.max(12, (f.h * cam.scale) / 2), 10, Math.max(24, f.h * cam.scale));
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawDrain(d, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const a = cam.toScreen(d.x - d.w / 2, d.y + d.h / 2);
    const w = d.w * cam.scale;
    const h = d.h * cam.scale;
    ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
    ctx.fillRect(a.x, a.y, w, h);
    ctx.strokeStyle = sel ? '#7dd3fc' : 'rgba(148,163,184,0.5)';
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(a.x, a.y, w, h);
    ctx.setLineDash([]);
    ctx.beginPath();
    for (let x = a.x + 6; x < a.x + w - 2; x += 8) {
      ctx.moveTo(x, a.y + 3);
      ctx.lineTo(x, a.y + h - 3);
    }
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.stroke();
    if (d.count) this.tag(`drained ${d.count}`, a.x + w / 2, a.y - 10, '#94a3b8', 'center');
  }

  drawEmitter(e, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const s = cam.toScreen(e.x, e.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(-(e.angle * Math.PI) / 180);
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = sel ? '#7dd3fc' : '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-26, -7, 26, 14);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-4, -Math.max(5, (e.width * cam.scale) / 2), 6, Math.max(10, e.width * cam.scale));
    ctx.fillStyle = e.on ? LIQUIDS[e.liquid]?.color || '#38bdf8' : '#475569';
    ctx.fill();
    ctx.restore();
    if (!this.thumb) {
      ctx.font = '10px Inter, sans-serif';
      ctx.fillStyle = 'rgba(226,232,240,0.6)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${e.name}${e.on ? '' : ' (off)'}`, s.x, s.y - 12);
    }
  }

  drawCannon(c, world, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const s = cam.toScreen(c.x, c.y);
    const sc = cam.scale;
    if (c.showPrediction) {
      const a = (c.angle * Math.PI) / 180;
      const m = c.muzzle();
      const g = world.settings.gravity;
      ctx.beginPath();
      const vx = Math.cos(a) * c.speed;
      const vy = Math.sin(a) * c.speed;
      const room = world.settings.room;
      for (let t = 0; t < 12; t += 0.02) {
        const x = m.x + vx * t + 0.5 * g.x * t * t;
        const y = m.y + vy * t + 0.5 * g.y * t * t;
        if (t === 0) ctx.moveTo(cam.sx(x), cam.sy(y));
        else ctx.lineTo(cam.sx(x), cam.sy(y));
        if (y < room.bottom - 0.2 || x > room.right + 2 || x < room.left - 2) break;
      }
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.45)';
      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.save();
    ctx.rotate(-(c.angle * Math.PI) / 180);
    const bl = c.barrel * sc;
    const bw = Math.max(6, 0.22 * sc);
    const grad = ctx.createLinearGradient(0, -bw / 2, 0, bw / 2);
    grad.addColorStop(0, '#64748b');
    grad.addColorStop(0.5, '#cbd5e1');
    grad.addColorStop(1, '#475569');
    ctx.fillStyle = grad;
    ctx.strokeStyle = sel ? '#7dd3fc' : '#1e293b';
    ctx.lineWidth = sel ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-bw * 0.3, -bw / 2, bl + bw * 0.3, bw, 3) : ctx.rect(-bw * 0.3, -bw / 2, bl + bw * 0.3, bw);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    const r = Math.max(8, 0.32 * sc);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = '#334155';
    ctx.fill();
    ctx.strokeStyle = sel ? '#7dd3fc' : '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.35, 0, TAU);
    ctx.fillStyle = '#94a3b8';
    ctx.fill();
    ctx.restore();
    if (!c.hideLabel || sel) this.tag(`${c.name} · ${c.speed.toFixed(1)} m/s @ ${c.angle.toFixed(1)}°`, s.x, s.y + Math.max(14, 0.45 * sc) + 6, '#cbd5e1', 'center');
  }

  drawSlingshot(s, world, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const [l, r] = s.forkTips();
    const base = { x: s.x, y: s.y - 1.25 };
    const crotch = { x: s.x, y: s.y - 0.55 };
    const bottom = world.settings.room.bottom;
    ctx.lineCap = 'round';
    ctx.strokeStyle = sel ? '#7dd3fc' : '#92400e';
    ctx.lineWidth = Math.max(4, 0.12 * cam.scale);
    ctx.beginPath();
    ctx.moveTo(cam.sx(base.x), cam.sy(Math.max(bottom, base.y - 2)));
    ctx.lineTo(cam.sx(crotch.x), cam.sy(crotch.y));
    ctx.lineTo(cam.sx(l.x), cam.sy(l.y));
    ctx.moveTo(cam.sx(crotch.x), cam.sy(crotch.y));
    ctx.lineTo(cam.sx(r.x), cam.sy(r.y));
    ctx.stroke();
    ctx.lineCap = 'butt';
    const body = s.body;
    let pouch = { x: s.x, y: s.y };
    if (body && (s.state === 'held' || s.state === 'launching')) pouch = { x: body.x, y: body.y };
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cam.sx(l.x), cam.sy(l.y));
    ctx.lineTo(cam.sx(pouch.x), cam.sy(pouch.y));
    ctx.lineTo(cam.sx(r.x), cam.sy(r.y));
    ctx.stroke();
    if (s.state === 'held' && body && s.hold) {
      const dx = s.x - s.hold.x;
      const dy = s.y - s.hold.y;
      const l2 = Math.hypot(dx, dy) || 1;
      const v = s.predictedSpeed();
      const pts = predictTrajectory(world, s.x, s.y, (dx / l2) * v, (dy / l2) * v, body, 4);
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(cam.sx(p.x), cam.sy(p.y)) : ctx.moveTo(cam.sx(p.x), cam.sy(p.y))));
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.6)';
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.setLineDash([]);
      this.tag(`v ≈ ${v.toFixed(1)} m/s · E = ${(0.5 * s.k * l2 * l2).toFixed(0)} J`, cam.sx(body.x), cam.sy(body.y) - 22, '#facc15', 'center');
    } else {
      ctx.beginPath();
      ctx.arc(cam.sx(s.x), cam.sy(s.y), 4, 0, TAU);
      ctx.fillStyle = '#fb923c';
      ctx.fill();
    }
  }

  drawGate(g, world, sel) {
    const ctx = this.ctx;
    const cam = this.camera;
    const A = cam.toScreen(g.x1, g.y1);
    const B = cam.toScreen(g.x2, g.y2);
    const blocked = g.isBlocked;
    const recent = g.lastTime !== null && world.time - g.lastTime < 0.15;
    ctx.save();
    ctx.lineCap = 'round';
    if (blocked || recent) {
      ctx.shadowColor = '#f43f5e';
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.moveTo(A.x, A.y);
    ctx.lineTo(B.x, B.y);
    ctx.strokeStyle = blocked || recent ? 'rgba(255, 90, 120, 1)' : rgba(g.color, 0.55);
    ctx.lineWidth = blocked || recent ? 2.5 : 1.5;
    if (!blocked && !recent) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.restore();
    // emitter / receiver heads
    const ang = Math.atan2(B.y - A.y, B.x - A.x);
    for (const [P, k] of [[A, 0], [B, 1]]) {
      ctx.save();
      ctx.translate(P.x, P.y);
      ctx.rotate(ang);
      ctx.fillStyle = sel ? '#0c4a6e' : '#1e293b';
      ctx.strokeStyle = sel ? '#7dd3fc' : '#64748b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(k ? -2 : -8, -6, 10, 12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // compact two-line tag: name, then the latest measurement
    const horizontal = Math.abs(B.x - A.x) > Math.abs(B.y - A.y);
    const lx = horizontal ? (A.x + B.x) / 2 : Math.max(A.x, B.x) + 10;
    const ly = horizontal ? Math.min(A.y, B.y) - 22 : (A.y + B.y) / 2 - 8;
    const align = horizontal ? 'center' : 'left';
    this.tag(g.name, lx, ly, sel ? '#7dd3fc' : '#94a3b8', align);
    if (g.count) {
      let m = `n=${g.count}`;
      if (g.lastPerp !== undefined && g.lastPerp !== null) m += ` · v=${g.lastPerp.toFixed(2)} m/s`;
      this.tag(m, lx, ly + 16, blocked ? '#fda4af' : '#e2e8f0', align);
    }
  }

  drawRuler(r, sel) {
    if (this.thumb) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const A = cam.toScreen(r.x1, r.y1);
    const B = cam.toScreen(r.x2, r.y2);
    const len = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
    const ang = Math.atan2(B.y - A.y, B.x - A.x);
    ctx.save();
    ctx.translate(A.x, A.y);
    ctx.rotate(ang);
    const L = Math.hypot(B.x - A.x, B.y - A.y);
    ctx.fillStyle = 'rgba(250, 204, 21, 0.12)';
    ctx.fillRect(0, -8, L, 16);
    ctx.strokeStyle = sel ? '#7dd3fc' : r.color;
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, -8, L, 16);
    // ticks
    const steps = [0.01, 0.05, 0.1, 0.5, 1, 5, 10];
    let tick = 1;
    for (const st of steps) if (st * cam.scale >= 6) { tick = st; break; }
    ctx.beginPath();
    for (let d = 0, i = 0; d <= len + 1e-9; d += tick, i++) {
      const x = d * cam.scale;
      const big = Math.abs(d / (tick * 10) - Math.round(d / (tick * 10))) < 1e-6;
      const mid = !big && Math.abs(d / (tick * 5) - Math.round(d / (tick * 5))) < 1e-6;
      ctx.moveTo(x, -8);
      ctx.lineTo(x, -8 + (big ? 10 : mid ? 7 : 4));
    }
    ctx.strokeStyle = r.color;
    ctx.stroke();
    ctx.restore();
    const degAng = (Math.atan2(r.y2 - r.y1, r.x2 - r.x1) * 180) / Math.PI;
    const txt = `${len.toFixed(3)} m · Δx ${(r.x2 - r.x1).toFixed(2)} · Δy ${(r.y2 - r.y1).toFixed(2)} · ${degAng.toFixed(1)}°`;
    this.tag(txt, (A.x + B.x) / 2, (A.y + B.y) / 2 - 18, '#fde68a', 'center');
  }

  drawLabel(l, sel) {
    if (this.thumb) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const fs = Math.max(9, l.size * cam.scale);
    ctx.font = `600 ${fs}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const s = cam.toScreen(l.x, l.y);
    if (sel) {
      const w = ctx.measureText(l.text).width;
      ctx.strokeStyle = '#7dd3fc';
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(s.x - w / 2 - 6, s.y - fs * 0.7, w + 12, fs * 1.4);
      ctx.setLineDash([]);
    }
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, s.x, s.y);
  }

  drawTimer(t, world, sel) {
    if (this.thumb) return;
    const ctx = this.ctx;
    const cam = this.camera;
    const s = cam.toScreen(t.x, t.y);
    const k = timerScale(cam);
    const w = 136;
    const h = 46;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.scale(k, k);
    const x = -w / 2;
    const y = -h / 2;
    ctx.fillStyle = 'rgba(4, 8, 18, 0.9)';
    ctx.strokeStyle = sel ? '#7dd3fc' : t.running ? 'rgba(74, 222, 128, 0.7)' : 'rgba(100, 116, 139, 0.6)';
    ctx.lineWidth = sel ? 2 : 1.2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 8);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.font = '600 9.5px Inter, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(t.name.toUpperCase().slice(0, 22), x + 9, y + 6);
    ctx.beginPath();
    ctx.arc(x + w - 10, y + 10, 3.5, 0, TAU);
    ctx.fillStyle = t.running ? '#4ade80' : t.accumulated > 0 ? '#f59e0b' : '#475569';
    ctx.fill();
    ctx.font = '600 19px JetBrains Mono, monospace';
    ctx.fillStyle = t.color || '#7dd3fc';
    ctx.shadowColor = t.color || '#38bdf8';
    ctx.shadowBlur = 8;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fmtTime(t.value(world.time)), x + w - 22, y + h - 9);
    ctx.shadowBlur = 0;
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillStyle = '#64748b';
    ctx.fillText('s', x + w - 10, y + h - 9);
    ctx.restore();
  }

  // ------------------------------------------------------------------------------
  arrow(x0, y0, x1, y1, color, width = 2) {
    const ctx = this.ctx;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    if (L < 2) return;
    const ux = dx / L;
    const uy = dy / L;
    const head = Math.min(9, L * 0.4);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - ux * head * 0.6, y1 - uy * head * 0.6);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * head - uy * head * 0.5, y1 - uy * head + ux * head * 0.5);
    ctx.lineTo(x1 - ux * head + uy * head * 0.5, y1 - uy * head - ux * head * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  drawVelocity(b, p) {
    const cam = this.camera;
    const k = 14; // px per m/s
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    let vx = b.vx * k;
    let vy = -b.vy * k;
    const L = Math.hypot(vx, vy);
    if (L > 220) {
      vx *= 220 / L;
      vy *= 220 / L;
    }
    this.arrow(sx, sy, sx + vx, sy + vy, '#4ade80', 2);
  }

  drawForces(b, p, world) {
    const cam = this.camera;
    const sx = cam.sx(p.x);
    const sy = cam.sy(p.y);
    const g = Math.hypot(world.settings.gravity.x, world.settings.gravity.y) || 9.81;
    const ref = b.mass * g || 1;
    const k = 55 / ref;
    const F = b.forces;
    const list = [
      ['gravity', '#facc15', 'mg'],
      ['normal', '#60a5fa', 'N'],
      ['friction', '#fb923c', 'f'],
      ['drag', '#22d3ee', 'D'],
      ['buoyancy', '#2dd4bf', 'B'],
      ['other', '#c084fc', 'F'],
    ];
    for (const [key, col, lbl] of list) {
      const f = F[key];
      const mag = Math.hypot(f.x, f.y);
      if (mag < ref * 0.01) continue;
      let ex = f.x * k;
      let ey = -f.y * k;
      const L = Math.hypot(ex, ey);
      if (L > 160) {
        ex *= 160 / L;
        ey *= 160 / L;
      }
      this.arrow(sx, sy, sx + ex, sy + ey, col, 2.4);
      this.tag(`${lbl} ${fmtForce(mag)}`, sx + ex + 4, sy + ey, col);
    }
  }

  drawContacts(world) {
    const ctx = this.ctx;
    const cam = this.camera;
    for (const c of world.contacts) {
      for (const p of c.points) {
        const s = cam.toScreen(p.x, p.y);
        ctx.fillStyle = p.sep > 0 ? 'rgba(250,204,21,0.6)' : '#f43f5e';
        ctx.fillRect(s.x - 2, s.y - 2, 4, 4);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(s.x + c.nx * 12, s.y - c.ny * 12);
        ctx.strokeStyle = 'rgba(244,63,94,0.6)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
  }

  drawHandle(x, y, hot) {
    const ctx = this.ctx;
    const s = this.camera.toScreen(x, y);
    ctx.fillStyle = hot ? '#7dd3fc' : '#0b1020';
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.rect(s.x - 5, s.y - 5, 10, 10);
    ctx.fill();
    ctx.stroke();
  }

  rotateHandlePos(b) {
    const cam = this.camera;
    const top = cam.sy(b.aabb.maxY);
    return { x: cam.sx(b.x), y: top - 26 };
  }

  drawRotateHandle(b) {
    const ctx = this.ctx;
    const cam = this.camera;
    const h = this.rotateHandlePos(b);
    ctx.beginPath();
    ctx.moveTo(cam.sx(b.x), cam.sy(b.aabb.maxY));
    ctx.lineTo(h.x, h.y);
    ctx.strokeStyle = 'rgba(125,211,252,0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.x, h.y, 6, 0, TAU);
    ctx.fillStyle = '#0b1020';
    ctx.fill();
    ctx.strokeStyle = '#7dd3fc';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(h.x, h.y, 2.5, -2.5, 1.5);
    ctx.stroke();
  }

  tag(text, x, y, color = '#e2e8f0', align = 'left') {
    if (this.thumb) return;
    const ctx = this.ctx;
    ctx.font = '500 11px Inter, sans-serif';
    const w = ctx.measureText(text).width;
    const bx = align === 'center' ? x - w / 2 - 5 : x - 2;
    ctx.fillStyle = 'rgba(4,8,18,0.78)';
    ctx.fillRect(bx, y - 8, w + 10, 16);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + 5, y);
  }
}

// timers are drawn at a fixed screen size, shrinking a little when zoomed far out
export function timerScale(cam) {
  return Math.max(0.6, Math.min(1, cam.scale / 42));
}

export function fmtForce(f) {
  const a = Math.abs(f);
  if (a >= 1e4) return (f / 1000).toFixed(1) + ' kN';
  if (a >= 100) return f.toFixed(0) + ' N';
  if (a >= 1) return f.toFixed(1) + ' N';
  return f.toFixed(3) + ' N';
}

export function fmtMass(m) {
  if (m >= 1000) return (m / 1000).toFixed(2) + ' t';
  if (m >= 1) return m.toFixed(2) + ' kg';
  return (m * 1000).toFixed(0) + ' g';
}

function mixColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}
