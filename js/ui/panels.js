// Side panels (Room rules, Data graphs, Timers) and modals (Experiments,
// Files, Help) plus the experiment info card.

import { Form } from './forms.js';
import { icon, hydrateIcons } from './icons.js';
import { PLANETS, AIR_PRESETS, MATERIAL_KEYS, MATERIALS } from '../engine/materials.js';
import { QUANTITIES } from './recorder.js';
import { fmtTime } from './renderer.js';
import { PRESETS, PRESET_CATEGORIES, buildPreset } from '../lab/presets.js';
import { Renderer } from './renderer.js';
import { Camera } from './camera.js';
import { storage } from './storage.js';
import { TOOLS } from './tools.js';

const f2 = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : '—');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ===================================================================================
export class RoomPanel {
  constructor(app, root) {
    this.app = app;
    this.root = root;
  }

  rebuild() {
    const app = this.app;
    const w = app.world;
    const st = w.settings;
    this.root.innerHTML = '';
    const f = new Form(this.root, { onCommit: (l) => app.commit(l) });
    this.form = f;
    const rebuild = () => this.rebuild();

    const g = f.section('Gravity', { id: 'room-g' });
    g.chips(Object.entries(PLANETS).map(([k, p]) => ({ value: k, label: p.name, title: `g = ${p.g} m/s²` })), {
      isOn: (k) => Math.abs(Math.hypot(st.gravity.x, st.gravity.y) - PLANETS[k].g) < 0.005,
      set: (k) => {
        const ang = gravAngle(st);
        st.gravity.x = Math.cos(ang) * PLANETS[k].g;
        st.gravity.y = Math.sin(ang) * PLANETS[k].g;
        w.wakeAll();
      },
    });
    g.number('Strength |g|', {
      get: () => Math.hypot(st.gravity.x, st.gravity.y),
      set: (v) => { const a = gravAngle(st); st.gravity.x = Math.cos(a) * v; st.gravity.y = Math.sin(a) * v; w.wakeAll(); },
      min: 0, max: 30, step: 0.01, unit: 'm/s²', digits: 3, softMax: true,
    });
    g.number('Direction', {
      get: () => (gravAngle(st) * 180) / Math.PI,
      set: (v) => { const m = Math.hypot(st.gravity.x, st.gravity.y); const a = (v * Math.PI) / 180; st.gravity.x = Math.cos(a) * m; st.gravity.y = Math.sin(a) * m; w.wakeAll(); },
      min: -180, max: 180, step: 1, unit: '°', digits: 1,
    });
    g.note('−90° points down. Tilt gravity to turn the whole room into a slope.');

    const a = f.section('Air & wind', { id: 'room-air' });
    a.chips(Object.entries(AIR_PRESETS).map(([k, p]) => ({ value: k, label: p.name })), {
      isOn: (k) => Math.abs(st.airDensity - AIR_PRESETS[k].density) < 1e-6,
      set: (k) => { st.airDensity = AIR_PRESETS[k].density; st.airViscosity = AIR_PRESETS[k].viscosity; w.wakeAll(); },
    });
    a.check('Air resistance', { get: () => st.drag, set: (v) => { st.drag = v; w.wakeAll(); } });
    a.number('Air density ρ', { get: () => st.airDensity, set: (v) => { st.airDensity = Math.max(0, v); w.wakeAll(); }, min: 0, max: 100, step: 0.001, unit: 'kg/m³', digits: 4, softMax: true });
    a.number('Viscosity μ', { get: () => st.airViscosity, set: (v) => { st.airViscosity = Math.max(0, v); w.wakeAll(); }, min: 0, max: 5, step: 0.00001, unit: 'Pa·s', digits: 6, softMax: true, slider: false });
    a.number('Wind x', { get: () => st.wind.x, set: (v) => { st.wind.x = v; w.wakeAll(); }, min: -40, max: 40, step: 0.1, unit: 'm/s', digits: 2 });
    a.number('Wind y', { get: () => st.wind.y, set: (v) => { st.wind.y = v; w.wakeAll(); }, min: -40, max: 40, step: 0.1, unit: 'm/s', digits: 2 });
    a.note('Drag force F = ½ρC<sub>d</sub>Av² + 3πμ·w·v, using each body’s projected width w.');

    const r = f.section('Room', { id: 'room-room' });
    const rr = st.room;
    const rebuildRoom = () => { w.rebuildRoom(); w.wakeAll(); };
    r.check('Floor', { get: () => rr.floor, set: (v) => { rr.floor = v; rebuildRoom(); } });
    r.check('Left wall', { get: () => rr.left_wall, set: (v) => { rr.left_wall = v; rebuildRoom(); } });
    r.check('Right wall', { get: () => rr.right_wall, set: (v) => { rr.right_wall = v; rebuildRoom(); } });
    r.check('Ceiling', { get: () => rr.ceiling, set: (v) => { rr.ceiling = v; rebuildRoom(); } });
    r.number('Left x', { get: () => rr.left, set: (v) => { rr.left = Math.min(v, rr.right - 1); rebuildRoom(); }, unit: 'm', digits: 2, step: 0.5 });
    r.number('Right x', { get: () => rr.right, set: (v) => { rr.right = Math.max(v, rr.left + 1); rebuildRoom(); }, unit: 'm', digits: 2, step: 0.5 });
    r.number('Floor y', { get: () => rr.bottom, set: (v) => { rr.bottom = Math.min(v, rr.top - 1); rebuildRoom(); }, unit: 'm', digits: 2, step: 0.5 });
    r.number('Ceiling y', { get: () => rr.top, set: (v) => { rr.top = Math.max(v, rr.bottom + 1); rebuildRoom(); }, unit: 'm', digits: 2, step: 0.5 });
    r.select('Wall material', MATERIAL_KEYS.map((k) => ({ value: k, label: MATERIALS[k].name })), { get: () => rr.material, set: (v) => { rr.material = v; rebuildRoom(); } });
    r.number('Slab depth', { get: () => st.depth, set: (v) => { w.setDepth(Math.max(0.001, v)); }, min: 0.01, max: 2, step: 0.01, unit: 'm', digits: 3, title: 'Thickness used to turn 2D areas into volumes and masses' });
    r.buttons([{ label: 'Fit view to room', icon: 'fit', small: true, onClick: () => app.fitView(true) }]);

    const s = f.section('Simulation', { id: 'room-sim', collapsed: true });
    s.select('Step rate', ['60', '120', '240', '480'].map((v) => ({ value: v, label: v + ' Hz' })), { get: () => String(st.stepRate), set: (v) => (st.stepRate = +v) });
    s.number('Sub-steps', { get: () => st.substeps, set: (v) => (st.substeps = Math.max(1, Math.round(v))), min: 1, max: 16, step: 1, digits: 0 });
    s.check('Collisions', { get: () => st.collisions, set: (v) => { st.collisions = v; w.wakeAll(); } });
    s.check('Sleeping bodies', { get: () => st.sleeping, set: (v) => { st.sleeping = v; w.wakeAll(); }, title: 'Resting bodies stop being simulated until something touches them' });
    s.number('Bounce threshold', { get: () => st.restitutionThreshold, set: (v) => (st.restitutionThreshold = Math.max(0, v)), min: 0, max: 3, step: 0.05, unit: 'm/s', digits: 2, title: 'Impacts slower than this do not bounce' });
    s.select('Friction mixing', [{ value: 'geo', label: '√(μ₁μ₂)' }, { value: 'min', label: 'min' }, { value: 'max', label: 'max' }, { value: 'avg', label: 'average' }], { get: () => st.frictionMix, set: (v) => (st.frictionMix = v) });
    s.select('Restitution mixing', [{ value: 'max', label: 'max' }, { value: 'min', label: 'min' }, { value: 'avg', label: 'average' }, { value: 'mul', label: 'product' }], { get: () => st.restitutionMix, set: (v) => (st.restitutionMix = v) });
    s.check('Mutual gravity', { get: () => st.mutualGravity, set: (v) => { st.mutualGravity = v; w.wakeAll(); }, rebuild });
    if (st.mutualGravity) s.number('G (scaled)', { get: () => st.G, set: (v) => (st.G = Math.max(0, v)), min: 0, max: 100, step: 0.1, unit: 'N·m²/kg²', digits: 2 });
    s.check('Electric charges', { get: () => st.coulomb, set: (v) => { st.coulomb = v; w.wakeAll(); }, rebuild });
    if (st.coulomb) s.number('k (scaled)', { get: () => st.K, set: (v) => (st.K = Math.max(0, v)), min: 0, max: 1000, step: 1, digits: 1 });
    s.number('Contact stiffness', { get: () => st.contactHertz, set: (v) => (st.contactHertz = Math.max(5, v)), min: 10, max: 120, step: 1, unit: 'Hz', digits: 0 });

    const l = f.section('Liquid particles', { id: 'room-fluid', collapsed: true });
    l.number('Particle size', { get: () => st.fluid.radius, set: (v) => (st.fluid.radius = Math.max(0.03, v)), min: 0.04, max: 0.2, step: 0.005, unit: 'm', digits: 3 });
    l.number('Stiffness', { get: () => st.fluid.stiffness ?? 1, set: (v) => (st.fluid.stiffness = Math.max(0.1, v)), min: 0.2, max: 3, step: 0.05, digits: 2 });
    l.number('Viscosity ×', { get: () => st.fluid.viscosity ?? 1, set: (v) => (st.fluid.viscosity = Math.max(0, v)), min: 0, max: 5, step: 0.05, digits: 2 });
    l.number('Max particles', { get: () => w.fluid.maxParticles, set: (v) => (w.fluid.maxParticles = Math.max(100, Math.round(v))), min: 200, max: 6000, step: 100, digits: 0 });
    l.readouts([{ label: 'Particles', get: () => String(w.fluid.count) }]);
    l.buttons([{ label: 'Remove all liquid', small: true, variant: 'danger', onClick: () => { w.fluid.clear(); app.commit('Clear liquid'); } }]);
    l.note('Particle liquid is qualitative (it flows, fills cups and pushes bodies). Pools give exact buoyancy.');

    const d = f.section('Display', { id: 'room-disp' });
    const disp = app.display;
    const setD = (k) => (v) => { disp[k] = v; app.savePrefs(); app.syncViewButtons(); };
    d.check('Grid', { get: () => disp.grid, set: setD('grid') });
    d.check('Velocity vectors', { get: () => disp.vectors, set: setD('vectors') });
    d.select('Force vectors', [{ value: 'off', label: 'Off' }, { value: 'selected', label: 'Selected body' }, { value: 'all', label: 'All bodies' }], { get: () => disp.forces, set: setD('forces') });
    d.check('Trails', { get: () => disp.trails, set: setD('trails') });
    d.check('Strobe snapshots', { get: () => disp.strobe, set: setD('strobe'), title: 'Ghost outlines at regular intervals instead of time dots' });
    d.number('Strobe interval', { get: () => w.strobeInterval, set: (v) => (w.strobeInterval = Math.max(0.02, v)), min: 0.02, max: 1, step: 0.01, unit: 's', digits: 2 });
    d.check('Labels on all bodies', { get: () => disp.labels, set: setD('labels') });
    d.check('Connector forces', { get: () => disp.jointForces, set: setD('jointForces') });
    d.check('Centres of mass', { get: () => disp.com, set: setD('com') });
    d.check('Contact points', { get: () => disp.contacts, set: setD('contacts') });
    d.check('Dim sleeping bodies', { get: () => disp.sleep, set: setD('sleep') });
    d.check('Follow selection', { get: () => disp.follow, set: setD('follow') });
    d.buttons([{ label: 'Clear trails', small: true, onClick: () => w.clearTrails() }]);
  }

  refresh() {
    if (this.form) this.form.refresh();
  }

  tick() {
    if (this.form) this.form.tick();
  }
}

function gravAngle(st) {
  const m = Math.hypot(st.gravity.x, st.gravity.y);
  return m < 1e-9 ? -Math.PI / 2 : Math.atan2(st.gravity.y, st.gravity.x);
}

// ===================================================================================
const SERIES_COLORS = ['#38bdf8', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#a78bfa', '#2dd4bf', '#f87171'];

export class DataPanel {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.mode = 'body';
    this.quantity = 'speed';
    this.window = 10;
    this.hoverX = null;
  }

  rebuild() {
    const app = this.app;
    const w = app.world;
    this.root.innerHTML = '';
    const f = new Form(this.root, { onCommit: () => {} });
    this.form = f;
    const top = f.section('Graph', { id: 'data-graph' });
    top.chips([{ value: 'body', label: 'Body quantity' }, { value: 'energy', label: 'Energy' }, { value: 'momentum', label: 'Momentum' }], { get: () => this.mode, set: (v) => (this.mode = v), rebuild: () => this.rebuild() });
    if (this.mode === 'body') {
      top.select('Quantity', Object.entries(QUANTITIES).map(([k, q]) => ({ value: k, label: `${q.label} (${q.unit})` })), { get: () => this.quantity, set: (v) => (this.quantity = v) });
    }
    top.select('Time window', [{ value: '5', label: 'Last 5 s' }, { value: '10', label: 'Last 10 s' }, { value: '30', label: 'Last 30 s' }, { value: '0', label: 'Everything' }], { get: () => String(this.window), set: (v) => (this.window = +v) });
    const wrap = document.createElement('div');
    wrap.className = 'graph-wrap';
    const canvas = document.createElement('canvas');
    wrap.append(canvas);
    top.root.append(wrap);
    this.canvas = canvas;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.hoverX = (e.clientX - r.left) / r.width;
    });
    canvas.addEventListener('pointerleave', () => (this.hoverX = null));
    this.legend = document.createElement('div');
    this.legend.className = 'legend';
    top.root.append(this.legend);
    top.buttons([
      { label: app.recorder.paused ? 'Resume recording' : 'Pause recording', small: true, onClick: () => { app.recorder.paused = !app.recorder.paused; this.rebuild(); } },
      { label: 'Clear', small: true, onClick: () => app.recorder.clear() },
      { label: 'Export CSV', icon: 'download', small: true, onClick: () => app.exportCSV() },
    ]);

    const rec = f.section('Recorded bodies', { id: 'data-rec' });
    const bodies = w.bodies.filter((b) => !b.room && b.type !== 'static');
    if (!bodies.length) rec.note('Add some moving objects first.');
    else {
      rec.note('Toggle which bodies are recorded (also in the Inspector: “Record for graphs”).');
      rec.chips(bodies.slice(0, 60).map((b) => ({ value: b.id, label: b.name || `${b.geom.kind} #${b.id}` })), {
        isOn: (id) => !!w.getBody(id)?.record,
        set: (id) => { const b = w.getBody(id); if (b) b.record = !b.record; },
      });
    }
    const tbl = f.section('Gate log (all photogates)', { id: 'data-gates', collapsed: !w.gates.length });
    const logDiv = document.createElement('div');
    logDiv.className = 'log-wrap';
    tbl.root.append(logDiv);
    let n = -1;
    tbl.addTicker(() => {
      const all = [];
      for (const g of w.gates) for (const e of g.log) all.push({ g, e });
      if (all.length === n) return;
      n = all.length;
      all.sort((a, b) => b.e.t - a.e.t);
      logDiv.innerHTML = all.length ? `<table class="log"><tr><th>t (s)</th><th>gate</th><th>event</th><th>object</th><th>v (m/s)</th></tr>${all.slice(0, 60).map(({ g, e }) => `<tr><td>${e.t.toFixed(4)}</td><td>${esc(g.name)}</td><td>${e.kind}${e.duration ? ' ' + (e.duration * 1000).toFixed(1) + 'ms' : ''}</td><td>${esc(e.name)}</td><td>${e.speed.toFixed(3)}</td></tr>`).join('')}</table>` : '<div class="small-note">No gate events yet.</div>';
    });
  }

  tick() {
    if (this.form) this.form.tick();
    if (!this.canvas || !this.canvas.isConnected || !this.root.classList.contains('active')) return;
    this.draw();
  }

  refresh() {
    if (this.form) this.form.refresh();
  }

  collect() {
    const rec = this.app.recorder;
    const out = [];
    if (this.mode === 'body') {
      let i = 0;
      for (const s of rec.series.values()) {
        out.push({ name: s.name, color: SERIES_COLORS[i++ % SERIES_COLORS.length], t: s.t, v: s.q[this.quantity] });
      }
      const q = QUANTITIES[this.quantity];
      return { series: out, unit: q.unit, label: q.label };
    }
    const sy = rec.system;
    if (this.mode === 'energy') {
      return {
        series: [
          { name: 'Kinetic', color: '#4ade80', t: sy.t, v: sy.ke },
          { name: 'Potential', color: '#38bdf8', t: sy.t, v: sy.pe },
          { name: 'Elastic', color: '#f472b6', t: sy.t, v: sy.el },
          { name: 'Total', color: '#facc15', t: sy.t, v: sy.total },
        ],
        unit: 'J',
        label: 'Energy',
      };
    }
    return {
      series: [
        { name: 'px', color: '#38bdf8', t: sy.t, v: sy.px },
        { name: 'py', color: '#f472b6', t: sy.t, v: sy.py },
      ],
      unit: 'kg·m/s',
      label: 'Total momentum',
    };
  }

  draw() {
    const c = this.canvas;
    const r = c.getBoundingClientRect();
    if (r.width < 10) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = r.width;
    const H = r.height;
    ctx.fillStyle = '#060a14';
    ctx.fillRect(0, 0, W, H);
    const data = this.collect();
    const now = this.app.world.time;
    let t0 = this.window ? Math.max(0, now - this.window) : 0;
    let t1 = Math.max(now, t0 + 0.5);
    if (!this.window) {
      for (const s of data.series) if (s.t.length) t0 = Math.min(t0, s.t[0]);
    }
    let vmin = Infinity;
    let vmax = -Infinity;
    for (const s of data.series) {
      for (let i = 0; i < s.t.length; i++) {
        if (s.t[i] < t0) continue;
        const v = s.v[i];
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
      }
    }
    const padL = 44;
    const padR = 8;
    const padT = 10;
    const padB = 20;
    if (!isFinite(vmin)) {
      ctx.fillStyle = '#5b6a8b';
      ctx.font = '12px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(this.mode === 'body' ? 'Mark bodies as “recorded” and press Play' : 'Press Play to record', W / 2, H / 2);
      this.legend.innerHTML = '';
      return;
    }
    if (vmax - vmin < 1e-6) {
      vmax += 0.5;
      vmin -= 0.5;
    }
    const span = vmax - vmin;
    vmin -= span * 0.08;
    vmax += span * 0.08;
    const X = (t) => padL + ((t - t0) / (t1 - t0)) * (W - padL - padR);
    const Y = (v) => padT + (1 - (v - vmin) / (vmax - vmin)) * (H - padT - padB);
    // grid
    ctx.strokeStyle = 'rgba(148,180,255,0.08)';
    ctx.fillStyle = '#5b6a8b';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.lineWidth = 1;
    const yStep = niceStep((vmax - vmin) / 5);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = Math.ceil(vmin / yStep) * yStep; v <= vmax; v += yStep) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillText(fmtAxis(v, yStep), padL - 4, y);
    }
    const tStep = niceStep((t1 - t0) / 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = Math.ceil(t0 / tStep) * tStep; t <= t1; t += tStep) {
      const x = Math.round(X(t)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, H - padB);
      ctx.stroke();
      ctx.fillText(fmtAxis(t, tStep) + 's', x, H - padB + 4);
    }
    if (vmin < 0 && vmax > 0) {
      ctx.strokeStyle = 'rgba(148,180,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(padL, Y(0));
      ctx.lineTo(W - padR, Y(0));
      ctx.stroke();
    }
    // series
    for (const s of data.series) {
      ctx.beginPath();
      let started = false;
      const stride = Math.max(1, Math.floor(s.t.length / 1500));
      for (let i = 0; i < s.t.length; i += stride) {
        if (s.t[i] < t0) continue;
        const x = X(s.t[i]);
        const y = Y(s.v[i]);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.8;
      ctx.stroke();
    }
    // hover readout
    let legend = '';
    if (this.hoverX !== null) {
      const tx = t0 + ((this.hoverX * W - padL) / (W - padL - padR)) * (t1 - t0);
      const x = X(tx);
      ctx.strokeStyle = 'rgba(226,232,240,0.4)';
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, H - padB);
      ctx.stroke();
      legend = `<span style="color:#94a3b8">t = ${tx.toFixed(3)} s</span>`;
      for (const s of data.series) {
        const i = nearestIndex(s.t, tx);
        if (i >= 0) {
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.arc(X(s.t[i]), Y(s.v[i]), 3, 0, Math.PI * 2);
          ctx.fill();
          legend += `<span><i style="background:${s.color}"></i>${esc(s.name)}: ${s.v[i].toFixed(3)} ${data.unit}</span>`;
        }
      }
    } else {
      for (const s of data.series) {
        const last = s.v.length ? s.v[s.v.length - 1] : NaN;
        legend += `<span><i style="background:${s.color}"></i>${esc(s.name)}${isFinite(last) ? ': ' + last.toFixed(3) + ' ' + data.unit : ''}</span>`;
      }
    }
    if (this.legend.innerHTML !== legend) this.legend.innerHTML = legend;
  }
}

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-9))));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
}

function fmtAxis(v, step) {
  const d = Math.max(0, -Math.floor(Math.log10(step)));
  return Math.abs(v) < step * 1e-6 ? '0' : v.toFixed(Math.min(4, d));
}

function nearestIndex(arr, t) {
  if (!arr.length) return -1;
  let lo = 0;
  let hi = arr.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (arr[m] < t) lo = m;
    else hi = m;
  }
  return Math.abs(arr[lo] - t) < Math.abs(arr[hi] - t) ? lo : hi;
}

// ===================================================================================
export class TimersPanel {
  constructor(app, root) {
    this.app = app;
    this.root = root;
  }

  rebuild() {
    const app = this.app;
    const w = app.world;
    this.root.innerHTML = '';
    const f = new Form(this.root, { onCommit: (l) => app.commit(l) });
    this.form = f;
    if (!w.timers.length && !w.gates.length) {
      const d = document.createElement('div');
      d.className = 'empty-state';
      d.innerHTML = `${icon('timer')}<div><b>No chronometers yet</b></div><div>Use the <b>Photogate</b> tool (D) to drag light beams — the first gate starts a new chronometer and the second one stops it. Or place a manual <b>Chronometer</b> (Y).</div>`;
      this.root.append(d);
    }
    for (const t of w.timers) {
      const card = document.createElement('div');
      card.className = 'timer-card';
      card.innerHTML = `<div class="timer-top"><div class="timer-name"><span class="timer-dot"></span><span class="tn"></span></div><button class="btn small sel" title="Select on canvas">${icon('target')}</button></div><div class="timer-digits"></div><div class="btn-row timer-btns" style="margin:0 0 6px"></div><div class="small-note gates"></div><div class="laps"></div>`;
      card.querySelector('.tn').textContent = t.name;
      const btns = card.querySelector('.timer-btns');
      for (const [lbl, fn] of [['Start', () => t.start(w.time)], ['Stop', () => t.stop(w.time)], ['Lap', () => t.lap(w.time)], ['Reset', () => t.reset()]]) {
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = lbl;
        b.addEventListener('click', () => { fn(); app.commit('Timer'); });
        btns.append(b);
      }
      card.querySelector('.sel').addEventListener('click', () => app.select('timer', t));
      const linked = w.gates.filter((g) => g.timerId === t.id);
      card.querySelector('.gates').innerHTML = (t.autoStart ? 'Starts with the simulation · ' : '') + (linked.length ? 'Gates: ' + linked.map((g) => `${esc(g.name)} → ${g.action}`).join(', ') : 'No gates linked');
      const digits = card.querySelector('.timer-digits');
      const dot = card.querySelector('.timer-dot');
      const laps = card.querySelector('.laps');
      let n = -1;
      f.addTicker(() => {
        digits.innerHTML = `${fmtTime(t.value(w.time))}<small>s</small>`;
        dot.classList.toggle('on', t.running);
        if (t.laps.length !== n) {
          n = t.laps.length;
          let prev = 0;
          laps.innerHTML = t.laps.map((l, i) => {
            const split = l.value - prev;
            prev = l.value;
            return `<div><span>${l.kind} ${i + 1}</span><span>${l.value.toFixed(4)} s (+${split.toFixed(4)})</span></div>`;
          }).join('');
          laps.style.display = t.laps.length ? '' : 'none';
        }
      });
      this.root.append(card);
    }
    f.buttons([
      { label: 'Add chronometer', icon: 'timer', small: true, onClick: () => { const t = app.addTimerNear(null); app.select('timer', t); app.commit('Add timer'); this.rebuild(); } },
      { label: 'Reset all', small: true, onClick: () => { for (const t of w.timers) t.reset(); for (const g of w.gates) g.resetState(); app.commit('Reset timers'); } },
    ]);
    if (w.gates.length) {
      const gs = f.section('Photogates', { id: 'tm-gates' });
      const div = document.createElement('div');
      div.className = 'log-wrap';
      gs.root.append(div);
      gs.addTicker(() => {
        div.innerHTML = `<table class="log"><tr><th>gate</th><th>timer</th><th>action</th><th>n</th><th>v (m/s)</th></tr>${w.gates.map((g) => {
          const t = w.getTimer(g.timerId);
          return `<tr><td>${esc(g.name)}</td><td>${t ? esc(t.name) : '—'}</td><td>${g.action}</td><td>${g.count}</td><td>${g.lastSpeed !== null ? g.lastSpeed.toFixed(3) : '—'}</td></tr>`;
        }).join('')}</table>`;
      });
    }
    const ev = f.section('Event log', { id: 'tm-events' });
    const evDiv = document.createElement('div');
    evDiv.className = 'log-wrap';
    ev.root.append(evDiv);
    let last = -1;
    ev.addTicker(() => {
      const list = app.eventLog;
      if (list.length === last) return;
      last = list.length;
      evDiv.innerHTML = list.length ? `<table class="log"><tr><th>t (s)</th><th>event</th></tr>${list.slice(-80).reverse().map((e) => `<tr><td>${e.time.toFixed(4)}</td><td style="font-family:var(--font)">${esc(e.text)}</td></tr>`).join('')}</table>` : '<div class="small-note">Timer starts/stops, gate triggers, launches and broken connectors appear here.</div>';
    });
  }

  tick() {
    if (this.form) this.form.tick();
  }

  refresh() {
    if (this.form) this.form.refresh();
  }
}

// ===================================================================================
export function openModal(title, buildBody, opts = {}) {
  const modal = document.getElementById('modal');
  const body = document.getElementById('modalBody');
  document.getElementById('modalTitle').textContent = title;
  body.innerHTML = '';
  modal.querySelector('.modal-card').style.width = opts.width || '';
  buildBody(body);
  hydrateIcons(modal);
  modal.classList.remove('hidden');
}

export function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

export function openPresets(app) {
  openModal('Experiments', (body) => {
    const filters = document.createElement('div');
    filters.className = 'preset-filters';
    const grid = document.createElement('div');
    grid.className = 'preset-grid';
    let cat = 'All';
    const cats = ['All', ...PRESET_CATEGORIES];
    const render = () => {
      filters.innerHTML = '';
      for (const c of cats) {
        const b = document.createElement('button');
        b.className = 'chip' + (c === cat ? ' on' : '');
        b.textContent = c;
        b.addEventListener('click', () => {
          cat = c;
          render();
        });
        filters.append(b);
      }
      grid.innerHTML = '';
      const list = PRESETS.filter((p) => cat === 'All' || p.category === cat);
      for (const p of list) {
        const card = document.createElement('button');
        card.className = 'preset-card';
        const cv = document.createElement('canvas');
        card.append(cv);
        const pc = document.createElement('div');
        pc.className = 'pc-body';
        pc.innerHTML = `<span class="tag">${p.category}</span><h4>${esc(p.name)}</h4><p>${esc(p.description)}</p>`;
        card.append(pc);
        card.addEventListener('click', () => {
          closeModal();
          app.loadPreset(p.id);
        });
        grid.append(card);
        requestAnimationFrame(() => drawThumb(cv, p.id));
      }
    };
    render();
    body.append(filters, grid);
  });
}

const thumbCache = new Map();

function drawThumb(canvas, id) {
  const r = canvas.getBoundingClientRect();
  const W = Math.max(200, r.width);
  const H = Math.max(110, r.height);
  const key = id + ':' + Math.round(W);
  if (thumbCache.has(key)) {
    const img = thumbCache.get(key);
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    return;
  }
  try {
    const world = buildPreset(id);
    // advance a little so ropes/particles settle visually
    for (let i = 0; i < 30; i++) world.step();
    const cam = new Camera();
    const dpr = 1.5;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const fake = { getBoundingClientRect: () => ({ width: W, height: H }), getContext: () => canvas.getContext('2d'), width: canvas.width, height: canvas.height };
    const R = new Renderer(fake, cam);
    R.dpr = dpr;
    R.thumb = true;
    cam.resize(W, H);
    const room = world.settings.room;
    const c = world.meta.camera;
    if (c) {
      cam.cx = c.cx;
      cam.cy = c.cy;
      cam.scale = W / c.width;
    } else cam.fit(Math.max(room.left, -14), room.bottom - 0.5, Math.min(room.right, 14), Math.min(room.top, 15), 6);
    const fakeApp = {
      world, display: { grid: false, trails: true, vectors: false, forces: 'off', strobe: false, labels: false, com: false, contacts: false, sleep: false, jointForces: false },
      running: false, selection: [], isSelected: () => false, hover: null, tool: null, marquee: null, camera: cam,
    };
    R.render(fakeApp, 1, 0);
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    copy.getContext('2d').drawImage(canvas, 0, 0);
    thumbCache.set(key, copy);
  } catch (e) {
    console.warn('thumbnail failed', id, e);
  }
}

export function openFiles(app) {
  openModal('Files', (body) => {
    const grid = document.createElement('div');
    grid.className = 'files-grid';
    const left = document.createElement('div');
    left.innerHTML = `<h3>Save in this browser</h3>
      <div class="row" style="grid-template-columns:1fr auto"><input type="text" id="slotName" placeholder="Experiment name"/><button class="btn primary" id="slotSave">${icon('save')}<span>Save</span></button></div>
      <div class="small-note">Saved experiments live in this browser’s local storage.</div><div id="slotList"></div>`;
    const right = document.createElement('div');
    right.innerHTML = `<h3>Share & export</h3>
      <div class="btn-row">
        <button class="btn" id="fExport">${icon('download')}<span>Download .json</span></button>
        <button class="btn" id="fImport">${icon('upload')}<span>Open .json…</span></button>
        <button class="btn" id="fShare">${icon('link')}<span>Copy share link</span></button>
        <button class="btn" id="fCSV">${icon('download')}<span>Export data CSV</span></button>
      </div>
      <div class="small-note" id="shareNote">Share links encode the whole experiment in the URL — anyone opening it gets the same lab.</div>
      <h3 style="margin-top:18px">New</h3>
      <div class="btn-row"><button class="btn danger" id="fNew">${icon('trash')}<span>Start an empty lab</span></button></div>
      <input type="file" id="fFile" accept=".json,application/json" hidden />`;
    grid.append(left, right);
    body.append(grid);
    const nameInput = left.querySelector('#slotName');
    nameInput.value = app.sceneName();
    nameInput.addEventListener('keydown', (e) => e.stopPropagation());
    const renderSlots = () => {
      const list = left.querySelector('#slotList');
      const slots = storage.slots();
      list.innerHTML = slots.length ? '' : '<div class="small-note">Nothing saved yet.</div>';
      for (const s of slots) {
        const row = document.createElement('div');
        row.className = 'slot';
        row.innerHTML = `<div class="slot-name"></div><div class="slot-date">${new Date(s.date).toLocaleString()}</div>`;
        row.querySelector('.slot-name').textContent = s.name;
        const open = document.createElement('button');
        open.className = 'btn small';
        open.textContent = 'Open';
        open.addEventListener('click', () => {
          closeModal();
          app.loadScene(s.data, true);
          app.toast(`Opened “${s.name}”`, 'good');
        });
        const del = document.createElement('button');
        del.className = 'btn small danger';
        del.innerHTML = icon('trash');
        del.title = 'Delete';
        del.addEventListener('click', () => {
          storage.deleteSlot(s.name);
          renderSlots();
        });
        row.append(open, del);
        list.append(row);
      }
    };
    renderSlots();
    left.querySelector('#slotSave').addEventListener('click', () => {
      const n = nameInput.value.trim() || app.sceneName();
      if (storage.saveSlot(n, app.serialize())) {
        app.toast(`Saved “${n}”`, 'good');
        renderSlots();
      } else app.toast('Could not save (storage full or blocked)', 'bad');
    });
    right.querySelector('#fExport').addEventListener('click', () => app.exportJSON());
    right.querySelector('#fCSV').addEventListener('click', () => app.exportCSV());
    const file = right.querySelector('#fFile');
    right.querySelector('#fImport').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const fl = file.files[0];
      if (!fl) return;
      try {
        const data = JSON.parse(await fl.text());
        closeModal();
        app.loadScene(data, true);
        app.toast(`Opened ${fl.name}`, 'good');
      } catch (e) {
        app.toast('That file is not a PhysLab experiment', 'bad');
      }
    });
    right.querySelector('#fShare').addEventListener('click', async () => {
      const url = await app.shareLink();
      const note = right.querySelector('#shareNote');
      try {
        await navigator.clipboard.writeText(url);
        note.textContent = `Link copied (${Math.round(url.length / 1024)} kB).`;
      } catch (e) {
        note.innerHTML = `Copy this link:<br><textarea style="width:100%;height:60px">${esc(url)}</textarea>`;
      }
    });
    right.querySelector('#fNew').addEventListener('click', () => {
      closeModal();
      app.loadPreset('sandbox');
    });
  }, { width: 'min(820px, 100%)' });
}

export function openHelp() {
  openModal('Help & shortcuts', (body) => {
    const toolRows = TOOLS.filter((t) => t.key).map((t) => `<tr><td><span class="kbd">${t.key}</span></td><td>${t.name}</td></tr>`).join('');
    body.innerHTML = `<div class="help-grid">
      <div><h3>Getting started</h3><ul>
        <li>Open <b>Experiments</b> for ready-made labs, or start from the empty room.</li>
        <li>Pick a tool on the left; the bar on top of the canvas shows its options (material, size, stiffness…).</li>
        <li>Press <span class="kbd">Space</span> to run, <span class="kbd">R</span> to rewind to the start state.</li>
        <li>Select anything to edit it in the <b>Inspector</b>. Change gravity, air, walls in <b>Room</b>.</li>
        <li>Photogates + chronometers measure times to the millisecond; graphs live in <b>Data</b>.</li>
      </ul></div>
      <div><h3>Mouse</h3><ul>
        <li>Scroll to zoom, middle-drag or <span class="kbd">Space</span>+drag to pan.</li>
        <li>Right-click an object for quick actions.</li>
        <li>While running, dragging a body with Select or Grab pulls it with a spring.</li>
        <li>Hold <span class="kbd">Shift</span> to snap angles / draw squares; toggle grid snap with <span class="kbd">Ctrl G</span>.</li>
      </ul></div>
      <div><h3>Keyboard</h3><table>
        <tr><td><span class="kbd">Space</span></td><td>Play / pause</td></tr>
        <tr><td><span class="kbd">.</span></td><td>Step one frame</td></tr>
        <tr><td><span class="kbd">R</span></td><td>Reset to start state (Shift-click Reset: make the current state the start)</td></tr>
        <tr><td><span class="kbd">Del</span></td><td>Delete selection</td></tr>
        <tr><td><span class="kbd">Ctrl Z</span> / <span class="kbd">Ctrl ⇧ Z</span></td><td>Undo / redo</td></tr>
        <tr><td><span class="kbd">Ctrl D</span></td><td>Duplicate</td></tr>
        <tr><td><span class="kbd">Ctrl C</span> <span class="kbd">Ctrl V</span></td><td>Copy / paste</td></tr>
        <tr><td><span class="kbd">0</span></td><td>Fit view to the room</td></tr>
        <tr><td><span class="kbd">Ctrl G</span></td><td>Toggle grid snap</td></tr>
        <tr><td><span class="kbd">Arrows</span></td><td>Nudge selection (Shift = 10×)</td></tr>
        <tr><td><span class="kbd">Esc</span></td><td>Cancel / deselect</td></tr>
      </table></div>
      <div><h3>Tool keys</h3><table>${toolRows}</table></div>
      <div><h3>Physics notes</h3><ul>
        <li>Units are SI. Masses come from density × area × slab depth (Room → Room).</li>
        <li>Friction has separate static (μs) and kinetic (μk) coefficients.</li>
        <li>Air drag: ½ρC<sub>d</sub>Av² + viscous term. Pools give exact Archimedes buoyancy and surface waves.</li>
        <li>Timing resolution of photogates is sub-millisecond (bisection inside each solver step).</li>
        <li>The solver runs at 120 Hz with 4 sub-steps; raise both in Room → Simulation for stiff setups.</li>
      </ul></div>
    </div>`;
  }, { width: 'min(980px, 100%)' });
}
