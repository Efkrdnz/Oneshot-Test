// Inspector: property editors for the current selection.

import { Form } from './forms.js';
import { icon } from './icons.js';
import { MATERIALS, MATERIAL_KEYS, LIQUIDS, LIQUID_KEYS } from '../engine/materials.js';
import { autoDragCoef } from '../engine/forces.js';
import { KIND_INFO, entityName, jointKindName, jointIcon, listOf, bodyKindName } from './entities.js';
import { bodyColor, fmtTime, fmtForce, fmtMass } from './renderer.js';

const deg = (r) => (r * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const f2 = (v, d = 2) => (isFinite(v) ? v.toFixed(d) : '—');

export class Inspector {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.form = null;
    this.key = null;
  }

  rebuild() {
    this.key = null;
    this.show();
  }

  show() {
    const app = this.app;
    const sel = app.selection;
    const key = sel.map((s) => s.kind + ':' + (s.obj.id ?? '')).join(',') + '|' + app.worldVersion;
    if (key === this.key) return;
    this.key = key;
    this.root.innerHTML = '';
    this.form = new Form(this.root, { onCommit: (label) => app.commit(label) });
    if (!sel.length) this.overview();
    else if (sel.length > 1) this.multi(sel);
    else {
      const { kind, obj } = sel[0];
      this.header(kind, obj);
      const fn = this['k_' + kind];
      if (fn) fn.call(this, obj, this.form);
    }
  }

  tick() {
    if (this.form) this.form.tick();
  }

  refresh() {
    if (this.form) this.form.refresh();
  }

  header(kind, obj) {
    const app = this.app;
    const head = document.createElement('div');
    head.className = 'insp-head';
    let color = '#38bdf8';
    let ic = KIND_INFO[kind].icon;
    let kindLabel = KIND_INFO[kind].label;
    if (kind === 'body') {
      color = bodyColor(obj);
      kindLabel = `${bodyKindName(obj)} · ${obj.type}`;
    } else if (kind === 'joint') {
      ic = jointIcon(obj);
      kindLabel = jointKindName(obj);
    } else if (kind === 'pool') color = obj.color;
    else if (kind === 'wavestring') color = obj.color;
    head.innerHTML = `<div class="insp-swatch" style="background:${color}">${icon(ic)}</div>
      <div class="insp-title"><input type="text" spellcheck="false"/><div class="insp-kind">${kindLabel}</div></div>`;
    const input = head.querySelector('input');
    const nameKey = kind === 'label' ? 'text' : 'name';
    input.value = kind === 'label' ? obj.text : obj.name || entityName(kind, obj);
    input.addEventListener('input', () => {
      obj[nameKey] = input.value;
    });
    input.addEventListener('change', () => app.commit('Rename'));
    input.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.prepend(head);
    const f = this.form;
    if (kind === 'body' && obj.room) {
      f.note('This is a wall of the room. Change the room size and walls in the <b>Room</b> tab.');
      return;
    }
    f.buttons([
      { label: 'Duplicate', icon: 'copy', small: true, onClick: () => app.duplicateSelection() },
      { label: 'Delete', icon: 'trash', small: true, variant: 'danger', onClick: () => app.deleteSelection() },
      { label: 'Focus', icon: 'target', small: true, onClick: () => app.focusSelection() },
    ]);
  }

  // ------------------------------------------------------------------------------
  overview() {
    const app = this.app;
    const w = app.world;
    const f = this.form;
    const meta = w.meta || {};
    const intro = document.createElement('div');
    intro.className = 'empty-state';
    intro.innerHTML = `${icon('select')}<div><b>Nothing selected</b></div><div>Click an object with the Select tool (V) to edit its properties, or pick an object below.</div>`;
    this.root.append(intro);
    const s = f.section('Scene contents', { id: 'ov-contents' });
    const kinds = Object.keys(KIND_INFO);
    let any = false;
    for (const kind of kinds) {
      const list = listOf(w, kind);
      if (!list.length) continue;
      any = true;
      const wrap = document.createElement('div');
      wrap.style.margin = '6px 0 2px';
      wrap.innerHTML = `<div class="small-note" style="margin:6px 0 4px">${KIND_INFO[kind].plural || KIND_INFO[kind].label + 's'} (${list.length})</div>`;
      const chips = document.createElement('div');
      chips.className = 'chip-row';
      for (const o of list.slice(0, 40)) {
        const c = document.createElement('button');
        c.className = 'chip';
        c.textContent = entityName(kind, o);
        c.addEventListener('click', () => app.select(kind, o));
        chips.append(c);
      }
      if (list.length > 40) chips.insertAdjacentHTML('beforeend', `<span class="small-note">+${list.length - 40} more</span>`);
      wrap.append(chips);
      s.root.append(wrap);
    }
    if (!any) s.note('The room is empty. Use the tools on the left, or load an experiment.');
    const st = f.section('Live totals', { id: 'ov-totals' });
    st.readouts([
      { label: 'Time', get: () => fmtTime(w.time) + ' s' },
      { label: 'Bodies', get: () => String(w.bodies.filter((b) => !b.room).length) },
      { label: 'Kinetic E', get: () => f2(w.energy().kinetic) + ' J' },
      { label: 'Potential E', get: () => f2(w.energy().potential) + ' J' },
      { label: 'Elastic E', get: () => f2(w.energy().elastic) + ' J' },
      { label: 'Total E', get: () => f2(w.energy().total) + ' J' },
      { label: 'Momentum x', get: () => f2(w.momentum().x) + ' kg·m/s' },
      { label: 'Momentum y', get: () => f2(w.momentum().y) + ' kg·m/s' },
      { label: 'Particles', get: () => String(w.fluid.count) },
      { label: 'Awake', get: () => String(w.bodies.filter((b) => b.type === 'dynamic' && b.awake).length) },
    ]);
    if (meta.description) {
      const d = f.section('About this experiment', { id: 'ov-about' });
      d.note(meta.description);
    }
  }

  multi(sel) {
    const app = this.app;
    const f = this.form;
    const bodies = sel.filter((s) => s.kind === 'body').map((s) => s.obj);
    const head = document.createElement('div');
    head.className = 'insp-head';
    head.innerHTML = `<div class="insp-swatch" style="background:#38bdf8">${icon('select')}</div><div class="insp-title"><div style="font-weight:600;font-size:14px;padding-left:6px">${sel.length} objects selected</div><div class="insp-kind">${bodies.length} bodies</div></div>`;
    this.root.prepend(head);
    f.buttons([
      { label: 'Duplicate', icon: 'copy', small: true, onClick: () => app.duplicateSelection() },
      { label: 'Delete', icon: 'trash', small: true, variant: 'danger', onClick: () => app.deleteSelection() },
      { label: 'Glue together', icon: 'weld', small: true, onClick: () => app.weldSelection(), title: 'Weld all selected bodies into one rigid group' },
    ]);
    if (!bodies.length) return;
    const s = f.section('Apply to all bodies');
    s.select('Material', [{ value: '', label: '—' }, ...MATERIAL_KEYS.map((k) => ({ value: k, label: MATERIALS[k].name }))], {
      get: () => '',
      set: (v) => {
        if (!v) return;
        for (const b of bodies) applyMaterial(b, v);
      },
    });
    s.select('Type', [{ value: '', label: '—' }, { value: 'dynamic', label: 'Dynamic' }, { value: 'static', label: 'Static' }], {
      get: () => '',
      set: (v) => {
        if (v) for (const b of bodies) b.setType(v);
      },
    });
    s.check('Trails', { get: () => bodies.every((b) => b.trail), set: (v) => bodies.forEach((b) => (b.trail = v)) });
    s.check('Record data', { get: () => bodies.every((b) => b.record), set: (v) => bodies.forEach((b) => (b.record = v)) });
    s.check('Show labels', { get: () => bodies.every((b) => b.showLabel), set: (v) => bodies.forEach((b) => (b.showLabel = v)) });
    const t = f.section('Totals');
    t.readouts([
      { label: 'Total mass', get: () => fmtMass(bodies.reduce((a, b) => a + (b.type === 'dynamic' ? b.mass : 0), 0)) },
      { label: 'KE', get: () => f2(bodies.reduce((a, b) => a + (b.type === 'dynamic' ? b.kineticEnergy() : 0), 0)) + ' J' },
      { label: 'px', get: () => f2(bodies.reduce((a, b) => a + (b.type === 'dynamic' ? b.mass * b.vx : 0), 0)) },
      { label: 'py', get: () => f2(bodies.reduce((a, b) => a + (b.type === 'dynamic' ? b.mass * b.vy : 0), 0)) },
    ]);
  }

  // ------------------------------------------------------------------------------
  k_body(b, f) {
    if (b.room) return;
    const app = this.app;
    const w = app.world;
    const rebuild = () => this.rebuild();
    const phys = f.section('Physical properties', { id: 'b-phys' });
    phys.select('Type', [{ value: 'dynamic', label: 'Dynamic (moves)' }, { value: 'static', label: 'Static (fixed)' }, { value: 'kinematic', label: 'Kinematic (scripted)' }], {
      get: () => b.type,
      set: (v) => {
        b.setType(v);
        if (v === 'kinematic' && !b.motion) b.motion = { type: 'oscillate', direction: 0, amplitude: 1, period: 3, phase: 0 };
        b.motion && (b.motion.origin = null);
      },
      rebuild,
    });
    phys.select('Material', MATERIAL_KEYS.map((k) => ({ value: k, label: MATERIALS[k].name })), {
      get: () => b.material.key,
      set: (v) => applyMaterial(b, v),
    });
    if (b.type === 'dynamic') {
      phys.number('Mass', { get: () => b.mass, set: (v) => b.setMass(Math.max(1e-4, v)), min: 0.001, max: 100000, log: true, unit: 'kg', digits: 4, clamp: false });
    }
    phys.number('Density', { get: () => b.material.density, set: (v) => { b.material.density = Math.max(0.01, v); b.updateMass(); }, min: 1, max: 25000, log: true, unit: 'kg/m³', digits: 1 });
    phys.number('Static friction μs', { get: () => b.material.staticFriction, set: (v) => (b.material.staticFriction = Math.max(0, v)), min: 0, max: 1.5, step: 0.01, digits: 3 });
    phys.number('Kinetic friction μk', { get: () => b.material.friction, set: (v) => (b.material.friction = Math.max(0, v)), min: 0, max: 1.5, step: 0.01, digits: 3 });
    phys.number('Restitution e', { get: () => b.material.restitution, set: (v) => (b.material.restitution = Math.max(0, Math.min(1, v))), min: 0, max: 1, step: 0.01, digits: 3, title: 'Bounciness: 0 = perfectly inelastic, 1 = perfectly elastic' });
    if (b.type === 'dynamic') {
      phys.number('Drag coef. Cd', { get: () => b.dragCoef ?? autoDragCoef(b), set: (v) => (b.dragCoef = Math.max(0, v)), min: 0, max: 3, step: 0.01, digits: 3, title: 'Air/liquid drag coefficient (sphere ≈ 0.47, plate ≈ 1.1–2)' });
      phys.number('Gravity scale', { get: () => b.gravityScale, set: (v) => { b.gravityScale = v; b.wake(); }, min: -2, max: 5, step: 0.05, digits: 2 });
      phys.check('Fixed rotation', { get: () => b.fixedRotation, set: (v) => { b.fixedRotation = v; b.updateMass(); b.w = 0; } });
    }
    phys.note(`Area ${f2(b.area, 4)} m² × depth ${w.settings.depth} m → volume ${f2(b.area * w.settings.depth, 4)} m³ · I = ${f2(b.inertia, 4)} kg·m²`);

    const geo = f.section('Shape & placement', { id: 'b-geo' });
    this.geomFields(b, geo);
    geo.number('Position x', { get: () => b.x, set: (v) => { app.moveBodyTo(b, v, b.y); }, unit: 'm', digits: 3, step: 0.01 });
    geo.number('Position y', { get: () => b.y, set: (v) => { app.moveBodyTo(b, b.x, v); }, unit: 'm', digits: 3, step: 0.01 });
    geo.number('Angle', { get: () => deg(b.angle), set: (v) => { b.angle = rad(v); b.updateTransform(); b.syncShapes(); b.wake(); }, min: -180, max: 180, unit: '°', digits: 2, step: 0.5, clamp: false });

    if (b.type !== 'static') {
      const mot = f.section('Motion (live)', { id: 'b-motion' });
      mot.readouts([
        { label: 'x', get: () => f2(b.x, 3) + ' m' },
        { label: 'y', get: () => f2(b.y, 3) + ' m' },
        { label: 'vx', get: () => f2(b.vx, 3) + ' m/s' },
        { label: 'vy', get: () => f2(b.vy, 3) + ' m/s' },
        { label: '|v|', get: () => f2(Math.hypot(b.vx, b.vy), 3) + ' m/s' },
        { label: '|a|', get: () => f2(Math.hypot(b.ax, b.ay), 2) + ' m/s²' },
        { label: 'θ', get: () => f2(deg(b.angle), 1) + '°' },
        { label: 'ω', get: () => f2(b.w, 3) + ' rad/s' },
        b.type === 'dynamic' ? { label: 'KE', get: () => f2(b.kineticEnergy(), 3) + ' J' } : null,
        b.type === 'dynamic' ? { label: 'PE (mgh)', get: () => f2(-b.mass * (w.settings.gravity.y * (b.y - w.settings.room.bottom) + w.settings.gravity.x * b.x), 3) + ' J' } : null,
        b.type === 'dynamic' ? { label: 'p', get: () => f2(b.mass * Math.hypot(b.vx, b.vy), 3) + ' kg·m/s' } : null,
        b.type === 'dynamic' ? { label: 'Submerged', get: () => f2(b.submerged * 100, 1) + ' %' } : null,
        b.type === 'dynamic' ? { label: 'Normal N', get: () => fmtForce(Math.hypot(b.forces.normal.x, b.forces.normal.y)) } : null,
        b.type === 'dynamic' ? { label: 'Friction f', get: () => fmtForce(Math.hypot(b.forces.friction.x, b.forces.friction.y)) } : null,
        b.type === 'dynamic' ? { label: 'Drag D', get: () => fmtForce(Math.hypot(b.forces.drag.x, b.forces.drag.y)) } : null,
        b.type === 'dynamic' ? { label: 'Buoyancy B', get: () => fmtForce(Math.hypot(b.forces.buoyancy.x, b.forces.buoyancy.y)) } : null,
        { label: 'State', get: () => (b.awake ? 'awake' : 'asleep') },
      ]);
      if (b.type === 'dynamic') {
        mot.number('Set vx', { get: () => b.vx, set: (v) => { b.vx = v; b.wake(); }, unit: 'm/s', digits: 3, step: 0.1 });
        mot.number('Set vy', { get: () => b.vy, set: (v) => { b.vy = v; b.wake(); }, unit: 'm/s', digits: 3, step: 0.1 });
        mot.number('Set ω', { get: () => b.w, set: (v) => { b.w = v; b.wake(); }, unit: 'rad/s', digits: 3, step: 0.1 });
        mot.buttons([{ label: 'Stop motion', small: true, onClick: () => { b.vx = b.vy = b.w = 0; app.commit('Stop'); } }]);
      }
    }

    if (b.type === 'kinematic') {
      const km = f.section('Scripted motion', { id: 'b-kin' });
      if (!b.motion) b.motion = { type: 'oscillate', direction: 0, amplitude: 1, period: 3, phase: 0 };
      const m = b.motion;
      const reorigin = () => {
        if (m.origin) {
          b.x = m.origin.x;
          b.y = m.origin.y;
          b.angle = m.origin.angle;
          b.updateTransform();
          b.syncShapes();
        }
        m.origin = null;
      };
      km.select('Motion', [{ value: 'oscillate', label: 'Oscillate (sine)' }, { value: 'rotate', label: 'Rotate (constant ω)' }, { value: 'swing', label: 'Swing (angle sine)' }, { value: 'none', label: 'None (velocity only)' }], {
        get: () => m.type, set: (v) => { reorigin(); m.type = v; }, rebuild,
      });
      if (m.type === 'oscillate') {
        km.number('Direction', { get: () => m.direction || 0, set: (v) => { reorigin(); m.direction = v; }, min: -180, max: 180, unit: '°', digits: 1 });
        km.number('Amplitude', { get: () => m.amplitude, set: (v) => { reorigin(); m.amplitude = v; }, min: 0, max: 20, unit: 'm', digits: 2 });
      }
      if (m.type === 'swing') km.number('Amplitude', { get: () => m.amplitude ?? 30, set: (v) => { reorigin(); m.amplitude = v; }, min: 0, max: 180, unit: '°', digits: 1 });
      if (m.type === 'oscillate' || m.type === 'swing') {
        km.number('Period', { get: () => m.period, set: (v) => { reorigin(); m.period = Math.max(0.05, v); }, min: 0.1, max: 60, unit: 's', digits: 2 });
        km.number('Phase', { get: () => m.phase || 0, set: (v) => { reorigin(); m.phase = v; }, min: -180, max: 180, unit: '°', digits: 0 });
      }
      if (m.type === 'rotate') km.number('Angular speed', { get: () => m.speed ?? 1, set: (v) => { reorigin(); m.speed = v; }, min: -20, max: 20, unit: 'rad/s', digits: 2 });
      if (m.type === 'none') {
        km.number('vx', { get: () => b.vx, set: (v) => (b.vx = v), unit: 'm/s', digits: 2 });
        km.number('vy', { get: () => b.vy, set: (v) => (b.vy = v), unit: 'm/s', digits: 2 });
        km.number('ω', { get: () => b.w, set: (v) => (b.w = v), unit: 'rad/s', digits: 2 });
      }
    }
    if (b.type === 'static' || b.surfaceSpeed) {
      const cv = f.section('Conveyor surface', { id: 'b-conv', collapsed: !b.surfaceSpeed });
      cv.number('Surface speed', { get: () => b.surfaceSpeed, set: (v) => { b.surfaceSpeed = v; w.wakeAll(); }, min: -20, max: 20, unit: 'm/s', digits: 2, step: 0.1 });
      cv.note('Positive values move the top surface to the right (along the body’s local x axis).');
    }

    const liq = f.section('Liquids', { id: 'b-liq', collapsed: !b.hull && !b.innerLiquid });
    liq.check('Hull buoyancy', { get: () => b.hull, set: (v) => (b.hull = v), title: 'Displace liquid with the whole outline (boats, closed tanks) instead of only the solid material' });
    if (b.interiorLocal) {
      liq.check('Internal liquid', {
        get: () => !!b.innerLiquid,
        set: (v) => {
          b.innerLiquid = v ? { liquid: 'water', density: 1000, fraction: 0.5 } : null;
          b.updateMass();
        },
        rebuild,
      });
      if (b.innerLiquid) {
        liq.select('Liquid', LIQUID_KEYS.map((k) => ({ value: k, label: LIQUIDS[k].name })), {
          get: () => b.innerLiquid.liquid,
          set: (v) => { b.innerLiquid.liquid = v; b.innerLiquid.density = LIQUIDS[v].density; b.updateMass(); },
        });
        liq.number('Fill level', { get: () => b.innerLiquid.fraction * 100, set: (v) => { b.innerLiquid.fraction = Math.max(0, Math.min(1, v / 100)); b.updateMass(); b.wake(); }, min: 0, max: 100, unit: '%', digits: 1 });
        liq.readouts([{ label: 'Liquid mass', get: () => fmtMass(b.liquidMass) }, { label: 'Shell mass', get: () => fmtMass(b.shellMass) }]);
      }
    } else liq.note('Cups, sealed tanks and boats can carry internal liquid.');

    const disp = f.section('Display, data & collisions', { id: 'b-disp' });
    disp.color('Colour', { get: () => bodyColor(b), set: (v) => (b.color = v), reset: () => (b.color = null) });
    disp.check('Trail & strobe', { get: () => b.trail, set: (v) => { b.trail = v; if (!v) { b.trailPts = []; b.strobe = []; } } });
    disp.check('Record for graphs', { get: () => b.record, set: (v) => (b.record = v) });
    disp.check('Show label', { get: () => b.showLabel, set: (v) => (b.showLabel = v) });
    disp.check('Locked (no editing)', { get: () => b.locked, set: (v) => (b.locked = v) });
    disp.check('Collides', { get: () => b.collide, set: (v) => { b.collide = v; b.wake(); } });
    disp.select('Collision layer', [1, 2, 4, 8].map((v, i) => ({ value: String(v), label: 'Layer ' + (i + 1) })), { get: () => String(b.layer), set: (v) => { b.layer = +v; b.wake(); } });
    disp.html('<div class="small-note">Collides with layers:</div>');
    disp.chips([1, 2, 4, 8].map((v, i) => ({ value: v, label: 'L' + (i + 1) })), {
      isOn: (v) => (b.mask & v) !== 0,
      set: (v) => { b.mask ^= v; b.wake(); },
    });
    if (w.settings.coulomb) disp.number('Charge', { get: () => b.charge, set: (v) => { b.charge = v; b.wake(); }, min: -10, max: 10, unit: 'C', digits: 2 });
  }

  geomFields(b, s) {
    const g = b.geom;
    const app = this.app;
    const upd = (mut) => {
      const ng = JSON.parse(JSON.stringify(g));
      mut(ng);
      app.setBodyGeometry(b, ng);
    };
    switch (g.kind) {
      case 'box':
        s.number('Width', { get: () => g.w, set: (v) => upd((n) => (n.w = Math.max(0.01, v))), min: 0.02, max: 30, unit: 'm', digits: 3, log: true });
        s.number('Height', { get: () => g.h, set: (v) => upd((n) => (n.h = Math.max(0.01, v))), min: 0.02, max: 30, unit: 'm', digits: 3, log: true });
        break;
      case 'circle':
        s.number('Radius', { get: () => g.r, set: (v) => upd((n) => (n.r = Math.max(0.005, v))), min: 0.01, max: 10, unit: 'm', digits: 3, log: true });
        break;
      case 'ngon':
        s.number('Sides', { get: () => g.n, set: (v) => upd((n) => (n.n = Math.round(v))), min: 3, max: 12, step: 1, digits: 0 });
        s.number('Radius', { get: () => g.r, set: (v) => upd((n) => (n.r = Math.max(0.01, v))), min: 0.02, max: 10, unit: 'm', digits: 3, log: true });
        break;
      case 'wedge':
        s.number('Width', { get: () => g.w, set: (v) => upd((n) => (n.w = Math.max(0.02, v))), min: 0.05, max: 30, unit: 'm', digits: 3, log: true });
        s.number('Height', { get: () => g.h, set: (v) => upd((n) => (n.h = Math.max(0.02, v))), min: 0.05, max: 30, unit: 'm', digits: 3, log: true });
        s.number('Slope angle', { get: () => deg(Math.atan2(g.h, g.w)), set: (v) => upd((n) => (n.h = Math.max(0.02, n.w * Math.tan(rad(Math.max(1, Math.min(89, v))))))), min: 1, max: 89, unit: '°', digits: 2 });
        s.check('Mirror', { get: () => !!g.flip, set: (v) => upd((n) => (n.flip = v)) });
        break;
      case 'capsule':
        s.number('Length', { get: () => g.w, set: (v) => upd((n) => (n.w = Math.max(0.02, v))), min: 0.02, max: 20, unit: 'm', digits: 3 });
        s.number('Radius', { get: () => g.r, set: (v) => upd((n) => (n.r = Math.max(0.01, v))), min: 0.01, max: 5, unit: 'm', digits: 3 });
        break;
      case 'container':
      case 'tank':
      case 'boat':
        s.number('Width', { get: () => g.w, set: (v) => upd((n) => (n.w = Math.max(0.1, v))), min: 0.2, max: 20, unit: 'm', digits: 3 });
        s.number('Height', { get: () => g.h, set: (v) => upd((n) => (n.h = Math.max(0.1, v))), min: 0.1, max: 20, unit: 'm', digits: 3 });
        s.number('Wall', { get: () => g.t, set: (v) => upd((n) => (n.t = Math.max(0.01, v))), min: 0.01, max: 0.5, unit: 'm', digits: 3 });
        break;
      case 'track':
        s.number('Thickness', { get: () => g.thickness, set: (v) => upd((n) => (n.thickness = Math.max(0.02, v))), min: 0.02, max: 2, unit: 'm', digits: 3 });
        s.note(`${g.points.length} points · ${b.shapes.length} segments`);
        break;
      case 'poly':
        s.buttons([
          { label: 'Scale ×1.25', small: true, onClick: () => { upd((n) => (n.points = n.points.map((p) => ({ x: p.x * 1.25, y: p.y * 1.25 })))); app.commit('Scale'); } },
          { label: 'Scale ×0.8', small: true, onClick: () => { upd((n) => (n.points = n.points.map((p) => ({ x: p.x * 0.8, y: p.y * 0.8 })))); app.commit('Scale'); } },
        ]);
        s.note(`${g.points.length} vertices · ${b.shapes.length} convex pieces`);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------------------
  k_joint(j, f) {
    const app = this.app;
    const w = app.world;
    const rebuild = () => this.rebuild();
    const nm = (b) => (b === w.ground ? 'Background' : b.name || bodyKindName(b));
    const info = f.section('Connection', { id: 'j-conn' });
    info.readouts([
      { label: 'From', get: () => nm(j.bodyA) },
      { label: 'To', get: () => nm(j.bodyB) },
      { label: j.type === 'distance' || j.type === 'pulley' ? 'Tension' : 'Reaction', get: () => fmtForce(j.type === 'distance' || j.type === 'pulley' ? (j.tension ?? 0) : j.force) },
      j.type === 'distance' ? { label: 'Length now', get: () => f2(j.currentLength(), 3) + ' m' } : null,
      j.type === 'distance' && (j.mode === 'spring' || j.mode === 'bungee') ? { label: 'Extension', get: () => f2((j.currentLength() - j.length) * 100, 2) + ' cm' } : null,
      j.type === 'distance' && (j.mode === 'spring' || j.mode === 'bungee') ? { label: 'Elastic PE', get: () => f2(j.energy(), 3) + ' J' } : null,
      j.type === 'revolute' ? { label: 'Joint angle', get: () => f2(deg(j.bodyB.angle - j.bodyA.angle - j.referenceAngle), 1) + '°' } : null,
      j.type === 'revolute' && j.enableMotor ? { label: 'Motor torque', get: () => f2(j.torque ?? 0, 1) + ' N·m' } : null,
    ]);
    if (j.type === 'revolute') {
      const s = f.section('Hinge', { id: 'j-rev' });
      s.check('Weld (lock angle)', { get: () => j.lockAngle, set: (v) => { j.lockAngle = v; j.referenceAngle = j.bodyB.angle - j.bodyA.angle; }, rebuild });
      if (!j.lockAngle) {
        s.check('Motor', { get: () => j.enableMotor, set: (v) => (j.enableMotor = v), rebuild });
        if (j.enableMotor) {
          s.number('Motor speed', { get: () => j.motorSpeed, set: (v) => { j.motorSpeed = v; j.bodyB.wake(); }, min: -50, max: 50, unit: 'rad/s', digits: 2 });
          s.number('Max torque', { get: () => j.maxMotorTorque, set: (v) => (j.maxMotorTorque = Math.max(0, v)), min: 1, max: 1e6, log: true, unit: 'N·m', digits: 1 });
          s.readouts([{ label: 'RPM', get: () => f2((j.motorSpeed * 60) / (2 * Math.PI), 1) }]);
        }
        s.check('Angle limits', { get: () => j.enableLimit, set: (v) => (j.enableLimit = v), rebuild });
        if (j.enableLimit) {
          s.number('Lower', { get: () => deg(j.lowerAngle), set: (v) => (j.lowerAngle = rad(v)), min: -180, max: 0, unit: '°', digits: 1 });
          s.number('Upper', { get: () => deg(j.upperAngle), set: (v) => (j.upperAngle = rad(v)), min: 0, max: 180, unit: '°', digits: 1 });
        }
      }
    } else if (j.type === 'distance') {
      const s = f.section('Connector', { id: 'j-dist' });
      s.select('Kind', [{ value: 'rope', label: 'String (max length)' }, { value: 'rod', label: 'Rigid rod' }, { value: 'spring', label: 'Spring' }, { value: 'bungee', label: 'Elastic band' }], {
        get: () => j.mode, set: (v) => { j.mode = v; j.bodyB.wake(); j.bodyA.wake(); j.name = { rope: 'String', rod: 'Rod', spring: 'Spring', bungee: 'Elastic band' }[v]; }, rebuild,
      });
      s.number(j.mode === 'rope' ? 'Length' : j.mode === 'rod' ? 'Length' : 'Rest length', { get: () => j.length, set: (v) => { j.length = Math.max(0.01, v); j.bodyB.wake(); j.bodyA.wake(); }, min: 0.01, max: 30, unit: 'm', digits: 3, log: true });
      s.buttons([{ label: 'Use current length', small: true, onClick: () => { j.length = j.currentLength(); app.commit('Length'); this.refresh(); } }]);
      if (j.mode === 'spring' || j.mode === 'bungee') {
        s.number('Stiffness k', { get: () => j.k, set: (v) => { j.k = Math.max(0.01, v); j.bodyB.wake(); }, min: 0.1, max: 100000, log: true, unit: 'N/m', digits: 2 });
        s.number('Damping c', { get: () => j.c, set: (v) => (j.c = Math.max(0, v)), min: 0, max: 500, unit: 'N·s/m', digits: 2 });
        s.number('Coils (look)', { get: () => j.coils, set: (v) => (j.coils = Math.round(v)), min: 3, max: 40, step: 1, digits: 0 });
        const mB = j.bodyB.type === 'dynamic' ? j.bodyB.mass : j.bodyA.mass;
        if (mB) s.note(`Natural period with ${fmtMass(mB)}: T = 2π√(m/k) ≈ ${f2(2 * Math.PI * Math.sqrt(mB / j.k), 3)} s`);
      }
    } else if (j.type === 'pulley') {
      const s = f.section('Pulley', { id: 'j-pul' });
      s.number('Ratio', { get: () => j.ratio, set: (v) => { j.ratio = Math.max(0.1, v); const pa = j.anchorA(); const pb = j.anchorB(); j.constant = Math.hypot(pa.x - j.groundA.x, pa.y - j.groundA.y) + j.ratio * Math.hypot(pb.x - j.groundB.x, pb.y - j.groundB.y); }, min: 0.25, max: 4, step: 0.05, digits: 2, title: 'Block & tackle ratio' });
      s.number('Rope length', { get: () => j.constant, set: (v) => { j.constant = Math.max(0.1, v); j.bodyA.wake(); j.bodyB.wake(); }, min: 0.1, max: 60, unit: 'm', digits: 3 });
      s.number('Wheel radius', { get: () => j.wheelRadius, set: (v) => (j.wheelRadius = Math.max(0.02, v)), min: 0.02, max: 3, unit: 'm', digits: 2 });
      s.note('Drag the square handles to move the wheels.');
    } else if (j.type === 'prismatic') {
      const s = f.section('Rail', { id: 'j-pri' });
      s.number('Axis angle', { get: () => deg(Math.atan2(j.localAxis.y, j.localAxis.x)), set: (v) => { j.localAxis = { x: Math.cos(rad(v)), y: Math.sin(rad(v)) }; j.bodyB.wake(); }, min: -180, max: 180, unit: '°', digits: 1 });
      s.check('Lock rotation', { get: () => j.lockRotation, set: (v) => { j.lockRotation = v; j.referenceAngle = j.bodyB.angle - j.bodyA.angle; } });
      s.check('Travel limits', { get: () => j.enableLimit, set: (v) => (j.enableLimit = v), rebuild });
      if (j.enableLimit) {
        s.number('Lower', { get: () => j.lower, set: (v) => (j.lower = v), min: -30, max: 0, unit: 'm', digits: 2 });
        s.number('Upper', { get: () => j.upper, set: (v) => (j.upper = v), min: 0, max: 30, unit: 'm', digits: 2 });
      }
    }
    const adv = f.section('Advanced', { id: 'j-adv', collapsed: true });
    adv.number('Break force', { get: () => j.breakForce, set: (v) => (j.breakForce = Math.max(0, v)), min: 0, max: 100000, unit: 'N', digits: 1, title: '0 = unbreakable' });
    adv.check('Connected bodies collide', { get: () => j.collideConnected, set: (v) => { j.collideConnected = v; w.rebuildExclusions(); } });
    adv.check('Show force label', { get: () => j.showForce, set: (v) => (j.showForce = v) });
  }

  k_pool(p, f) {
    const app = this.app;
    const w = app.world;
    const s = f.section('Liquid', { id: 'p-liq' });
    s.select('Preset', LIQUID_KEYS.map((k) => ({ value: k, label: LIQUIDS[k].name })), {
      get: () => p.liquid,
      set: (v) => { const L = LIQUIDS[v]; p.liquid = v; p.density = L.density; p.viscosity = L.viscosity; p.color = L.color; w.wakeAll(); },
      rebuild: () => this.rebuild(),
    });
    s.number('Density ρ', { get: () => p.density, set: (v) => { p.density = Math.max(1, v); w.wakeAll(); }, min: 10, max: 20000, log: true, unit: 'kg/m³', digits: 1 });
    s.number('Viscosity μ', { get: () => p.viscosity, set: (v) => { p.viscosity = Math.max(0, v); w.wakeAll(); }, min: 0.0001, max: 200, log: true, unit: 'Pa·s', digits: 4 });
    s.number('Current', { get: () => p.current, set: (v) => { p.current = v; w.wakeAll(); }, min: -10, max: 10, unit: 'm/s', digits: 2, title: 'Horizontal flow speed' });
    s.color('Colour', { get: () => p.color, set: (v) => (p.color = v) });
    const g = f.section('Size', { id: 'p-size' });
    g.number('Left x', { get: () => p.x0, set: (v) => { p.x0 = Math.min(v, p.x1 - 0.2); p.resize(); }, unit: 'm', digits: 2 });
    g.number('Right x', { get: () => p.x1, set: (v) => { p.x1 = Math.max(v, p.x0 + 0.2); p.resize(); }, unit: 'm', digits: 2 });
    g.number('Bottom y', { get: () => p.bottom, set: (v) => (p.bottom = Math.min(v, p.level - 0.05)), unit: 'm', digits: 2 });
    g.number('Surface y', { get: () => p.level, set: (v) => { p.level = Math.max(v, p.bottom + 0.05); w.wakeAll(); }, unit: 'm', digits: 2 });
    const wv = f.section('Surface waves', { id: 'p-waves' });
    wv.check('Dynamic surface', { get: () => p.waves, set: (v) => { p.waves = v; p.h.fill(0); p.v.fill(0); } });
    wv.number('Wave damping', { get: () => p.waveDamping, set: (v) => (p.waveDamping = Math.max(0, v)), min: 0, max: 5, digits: 2 });
    wv.select('Far end', [{ value: 'reflect', label: 'Reflecting wall' }, { value: 'absorb', label: 'Absorbing beach' }], { get: () => p.beach, set: (v) => (p.beach = v) });
    wv.check('Wave generator', { get: () => p.generator.on, set: (v) => { p.generator.on = v; w.wakeAll(); } });
    wv.number('Amplitude', { get: () => p.generator.amplitude, set: (v) => (p.generator.amplitude = Math.max(0, v)), min: 0, max: 1, unit: 'm', digits: 3 });
    wv.number('Frequency', { get: () => p.generator.frequency, set: (v) => (p.generator.frequency = Math.max(0.01, v)), min: 0.05, max: 5, unit: 'Hz', digits: 2 });
    wv.select('Paddle side', [{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }], { get: () => p.generator.side, set: (v) => (p.generator.side = v) });
    wv.readouts([
      { label: 'Wave speed', get: () => f2(Math.min(6, Math.sqrt(Math.hypot(w.settings.gravity.x, w.settings.gravity.y) * Math.max(0.05, p.depth))), 2) + ' m/s' },
      { label: 'Wavelength', get: () => f2(Math.min(6, Math.sqrt(Math.hypot(w.settings.gravity.x, w.settings.gravity.y) * Math.max(0.05, p.depth))) / p.generator.frequency, 2) + ' m' },
      { label: 'Depth', get: () => f2(p.depth, 2) + ' m' },
      { label: 'Bottom pressure', get: () => f2((p.density * Math.hypot(w.settings.gravity.x, w.settings.gravity.y) * p.depth) / 1000, 2) + ' kPa' },
    ]);
    wv.buttons([{ label: 'Calm surface', small: true, onClick: () => { p.h.fill(0); p.v.fill(0); } }]);
  }

  k_gate(g, f) {
    const app = this.app;
    const w = app.world;
    const s = f.section('Photogate', { id: 'g-main' });
    s.select('Trigger by', [{ value: 'edge', label: 'Leading edge (beam broken)' }, { value: 'center', label: 'Centre of mass crossing' }], { get: () => g.mode, set: (v) => (g.mode = v) });
    s.select('Chronometer', [{ value: '0', label: '— none —' }, ...w.timers.map((t) => ({ value: String(t.id), label: t.name })), { value: 'new', label: '+ New chronometer' }], {
      get: () => String(g.timerId || 0),
      set: (v) => {
        if (v === 'new') {
          const t = app.addTimerNear(g);
          g.timerId = t.id;
        } else g.timerId = +v;
      },
      rebuild: () => this.rebuild(),
    });
    s.select('Action', [{ value: 'start', label: 'Start timer' }, { value: 'stop', label: 'Stop timer' }, { value: 'toggle', label: 'Start / stop (toggle)' }, { value: 'lap', label: 'Lap (split time)' }, { value: 'reset', label: 'Reset timer' }, { value: 'none', label: 'Only count & measure' }], { get: () => g.action, set: (v) => (g.action = v) });
    s.select('On', [{ value: 'enter', label: 'Beam blocked (enter)' }, { value: 'exit', label: 'Beam cleared (exit)' }], { get: () => g.trigger, set: (v) => (g.trigger = v) });
    const bodies = w.bodies.filter((b) => !b.room && b.type !== 'static');
    s.select('Detect', [{ value: '0', label: 'Any object' }, ...bodies.map((b) => ({ value: String(b.id), label: b.name || bodyKindName(b) + ' #' + b.id }))], { get: () => String(g.filterBody || 0), set: (v) => (g.filterBody = +v) });
    s.color('Colour', { get: () => g.color, set: (v) => (g.color = v) });
    const r = f.section('Measurements', { id: 'g-meas' });
    r.readouts([
      { label: 'Passes', get: () => String(g.count) },
      { label: 'Last at', get: () => (g.lastTime === null ? '—' : fmtTime(g.lastTime) + ' s') },
      { label: 'Speed', get: () => (g.lastSpeed === null ? '—' : f2(g.lastSpeed, 3) + ' m/s') },
      { label: 'v ⊥ beam', get: () => (g.lastPerp === undefined || g.lastPerp === null ? '—' : f2(g.lastPerp, 3) + ' m/s') },
      { label: 'Blocked for', get: () => (g.lastDuration ? (g.lastDuration * 1000).toFixed(2) + ' ms' : '—') },
      { label: 'Beam length', get: () => f2(Math.hypot(g.x2 - g.x1, g.y2 - g.y1), 2) + ' m' },
    ]);
    r.buttons([{ label: 'Clear log', small: true, onClick: () => { g.resetState(); app.commit('Clear gate'); } }]);
    const logWrap = document.createElement('div');
    logWrap.className = 'log-wrap';
    r.root.append(logWrap);
    let lastLen = -1;
    r.addTicker(() => {
      if (g.log.length === lastLen) return;
      lastLen = g.log.length;
      logWrap.innerHTML = g.log.length ? `<table class="log"><tr><th>t (s)</th><th>event</th><th>object</th><th>v (m/s)</th></tr>${g.log.slice(-30).reverse().map((e) => `<tr><td>${e.t.toFixed(4)}</td><td>${e.kind}${e.duration ? ' ' + (e.duration * 1000).toFixed(1) + 'ms' : ''}</td><td>${esc(e.name)}</td><td>${e.speed.toFixed(3)}</td></tr>`).join('')}</table>` : '<div class="small-note">No objects have crossed this beam yet.</div>';
    });
  }

  k_timer(t, f) {
    const app = this.app;
    const w = app.world;
    const s = f.section('Chronometer', { id: 't-main' });
    const big = document.createElement('div');
    big.className = 'timer-digits';
    s.root.append(big);
    s.addTicker(() => {
      big.innerHTML = `${fmtTime(t.value(w.time))}<small>s</small>`;
    });
    s.buttons([
      { label: 'Start', small: true, onClick: () => { t.start(w.time); app.commit('Timer'); } },
      { label: 'Stop', small: true, onClick: () => { t.stop(w.time); app.commit('Timer'); } },
      { label: 'Lap', small: true, onClick: () => { t.lap(w.time); app.commit('Timer'); } },
      { label: 'Reset', small: true, variant: 'danger', onClick: () => { t.reset(); app.commit('Timer'); } },
    ]);
    s.check('Start with simulation', { get: () => t.autoStart, set: (v) => (t.autoStart = v), title: 'Starts automatically at t = 0 when you press Play (e.g. for drop experiments)' });
    s.color('Colour', { get: () => t.color, set: (v) => (t.color = v) });
    const gates = w.gates.filter((g) => g.timerId === t.id);
    s.note(gates.length ? `Linked gates: ${gates.map((g) => `<b>${esc(g.name)}</b> (${g.action})`).join(', ')}` : 'No photogates are linked. Select a gate and choose this chronometer.');
    const lapWrap = document.createElement('div');
    lapWrap.className = 'laps';
    s.root.append(lapWrap);
    let n = -1;
    s.addTicker(() => {
      if (t.laps.length === n) return;
      n = t.laps.length;
      let prev = 0;
      lapWrap.innerHTML = t.laps.map((l, i) => {
        const split = l.value - prev;
        prev = l.value;
        return `<div><span>${l.kind} ${i + 1}</span><span>${l.value.toFixed(4)} s  (+${split.toFixed(4)})</span></div>`;
      }).join('') || '<div><span>No laps yet</span><span></span></div>';
    });
  }

  k_ruler(r, f) {
    const s = f.section('Ruler', { id: 'r-main' });
    s.readouts([
      { label: 'Length', get: () => f2(Math.hypot(r.x2 - r.x1, r.y2 - r.y1), 4) + ' m' },
      { label: 'Angle', get: () => f2(deg(Math.atan2(r.y2 - r.y1, r.x2 - r.x1)), 2) + '°' },
      { label: 'Δx', get: () => f2(r.x2 - r.x1, 4) + ' m' },
      { label: 'Δy', get: () => f2(r.y2 - r.y1, 4) + ' m' },
    ]);
    s.number('Start x', { get: () => r.x1, set: (v) => (r.x1 = v), unit: 'm', digits: 3 });
    s.number('Start y', { get: () => r.y1, set: (v) => (r.y1 = v), unit: 'm', digits: 3 });
    s.number('End x', { get: () => r.x2, set: (v) => (r.x2 = v), unit: 'm', digits: 3 });
    s.number('End y', { get: () => r.y2, set: (v) => (r.y2 = v), unit: 'm', digits: 3 });
    s.color('Colour', { get: () => r.color, set: (v) => (r.color = v) });
  }

  k_label(l, f) {
    const s = f.section('Text', { id: 'l-main' });
    this.textRow = s.text('Text', { get: () => l.text, set: (v) => (l.text = v), textarea: true });
    s.number('Size', { get: () => l.size, set: (v) => (l.size = Math.max(0.05, v)), min: 0.1, max: 2, unit: 'm', digits: 2 });
    s.color('Colour', { get: () => l.color, set: (v) => (l.color = v) });
  }

  k_cannon(c, f) {
    const app = this.app;
    const w = app.world;
    const s = f.section('Aim & power', { id: 'c-aim' });
    s.number('Angle', { get: () => c.angle, set: (v) => (c.angle = v), min: -90, max: 90, unit: '°', digits: 1, step: 0.5 });
    s.number('Muzzle speed', { get: () => c.speed, set: (v) => (c.speed = Math.max(0, v)), min: 0.5, max: 100, unit: 'm/s', digits: 2 });
    s.buttons([
      { label: 'Fire!', icon: 'cannon', variant: 'primary', onClick: () => { c.fire(w); if (!app.running) app.toast('Fired — press Play to see it fly', 'good'); app.commit('Fire'); } },
      { label: 'Clear shots', small: true, onClick: () => { for (const id of c.shots) { const b = w.getBody(id); if (b) w.removeBody(b); } c.shots = []; app.commit('Clear shots'); } },
    ]);
    s.check('Fire on Play (t = 0)', { get: () => c.fireOnStart, set: (v) => (c.fireOnStart = v) });
    s.check('Auto fire', { get: () => c.autoFire, set: (v) => (c.autoFire = v) });
    s.number('Interval', { get: () => c.interval, set: (v) => (c.interval = Math.max(0.05, v)), min: 0.1, max: 10, unit: 's', digits: 2 });
    s.check('Show ideal path', { get: () => c.showPrediction, set: (v) => (c.showPrediction = v) });
    s.check('Trails on shots', { get: () => c.trail, set: (v) => (c.trail = v) });
    const p = f.section('Projectile', { id: 'c-proj' });
    p.select('Shape', [{ value: 'circle', label: 'Ball' }, { value: 'box', label: 'Box' }], { get: () => c.projectile.kind, set: (v) => (c.projectile.kind = v) });
    p.number('Radius', { get: () => c.projectile.r, set: (v) => (c.projectile.r = Math.max(0.01, v)), min: 0.02, max: 1, unit: 'm', digits: 3 });
    p.select('Material', MATERIAL_KEYS.map((k) => ({ value: k, label: MATERIALS[k].name })), { get: () => c.projectile.material, set: (v) => (c.projectile.material = v) });
    p.number('Mass (0 = auto)', { get: () => c.projectile.mass || 0, set: (v) => (c.projectile.mass = Math.max(0, v)), min: 0, max: 100, unit: 'kg', digits: 3 });
    p.number('Drag coef. (−1 auto)', { get: () => (c.projectile.dragCoef ?? -1), set: (v) => (c.projectile.dragCoef = v < 0 ? null : v), min: -1, max: 3, digits: 2 });
    const th = f.section('Ideal ballistics (no drag)', { id: 'c-th' });
    const g = () => Math.hypot(w.settings.gravity.x, w.settings.gravity.y) || 1e-9;
    th.readouts([
      { label: 'Range', get: () => f2((c.speed * c.speed * Math.sin(2 * rad(c.angle))) / g(), 3) + ' m' },
      { label: 'Max height', get: () => f2((c.speed * c.speed * Math.sin(rad(c.angle)) ** 2) / (2 * g()), 3) + ' m' },
      { label: 'Flight time', get: () => f2((2 * c.speed * Math.sin(rad(c.angle))) / g(), 3) + ' s' },
      { label: 'vx, vy', get: () => `${f2(c.speed * Math.cos(rad(c.angle)))}, ${f2(c.speed * Math.sin(rad(c.angle)))}` },
    ]);
    th.note('Values assume launch and landing at the same height. The dashed curve shows the ideal path from the muzzle.');
  }

  k_slingshot(s, f) {
    const sec = f.section('Slingshot', { id: 's-main' });
    sec.number('Band stiffness k', { get: () => s.k, set: (v) => (s.k = Math.max(1, v)), min: 10, max: 5000, log: true, unit: 'N/m', digits: 1 });
    sec.number('Max stretch', { get: () => s.maxStretch, set: (v) => (s.maxStretch = Math.max(0.2, v)), min: 0.3, max: 5, unit: 'm', digits: 2 });
    sec.number('Fork width', { get: () => s.fork, set: (v) => (s.fork = Math.max(0.1, v)), min: 0.1, max: 2, unit: 'm', digits: 2 });
    sec.select('Stone material', MATERIAL_KEYS.map((k) => ({ value: k, label: MATERIALS[k].name })), { get: () => s.projectile.material, set: (v) => (s.projectile.material = v) });
    sec.number('Stone radius', { get: () => s.projectile.r, set: (v) => (s.projectile.r = Math.max(0.03, v)), min: 0.05, max: 0.6, unit: 'm', digits: 3 });
    sec.check('Trails', { get: () => s.trail, set: (v) => (s.trail = v) });
    sec.note('Drag the orange pouch back with Select or Grab and release. Launch speed ≈ s·√(k/m) for stretch s.');
  }

  k_emitter(e, f) {
    const app = this.app;
    const s = f.section('Faucet', { id: 'e-main' });
    s.check('Running', { get: () => e.on, set: (v) => (e.on = v) });
    s.select('Liquid', LIQUID_KEYS.map((k) => ({ value: k, label: LIQUIDS[k].name })), { get: () => e.liquid, set: (v) => (e.liquid = v) });
    s.number('Flow rate', { get: () => e.rate, set: (v) => (e.rate = Math.max(0, v)), min: 1, max: 300, unit: '/s', digits: 0 });
    s.number('Exit speed', { get: () => e.speed, set: (v) => (e.speed = Math.max(0, v)), min: 0, max: 20, unit: 'm/s', digits: 2 });
    s.number('Direction', { get: () => e.angle, set: (v) => (e.angle = v), min: -180, max: 180, unit: '°', digits: 0 });
    s.number('Nozzle width', { get: () => e.width, set: (v) => (e.width = Math.max(0.02, v)), min: 0.05, max: 2, unit: 'm', digits: 2 });
    s.number('Limit (0 = ∞)', { get: () => e.limit, set: (v) => (e.limit = Math.max(0, Math.round(v))), min: 0, max: 3500, step: 10, digits: 0 });
    s.readouts([{ label: 'Emitted', get: () => String(e.emitted) }, { label: 'In scene', get: () => String(app.world.fluid.count) }]);
    s.buttons([{ label: 'Reset count', small: true, onClick: () => { e.emitted = 0; app.commit('Faucet'); } }, { label: 'Remove all liquid', small: true, variant: 'danger', onClick: () => { app.world.fluid.clear(); app.commit('Clear liquid'); } }]);
  }

  k_drain(d, f) {
    const s = f.section('Drain', { id: 'd-main' });
    s.number('Width', { get: () => d.w, set: (v) => (d.w = Math.max(0.1, v)), min: 0.1, max: 20, unit: 'm', digits: 2 });
    s.number('Height', { get: () => d.h, set: (v) => (d.h = Math.max(0.05, v)), min: 0.05, max: 10, unit: 'm', digits: 2 });
    s.readouts([{ label: 'Drained', get: () => String(d.count || 0) }]);
  }

  k_attractor(a, f) {
    const w = this.app.world;
    const s = f.section('Gravity well', { id: 'a-main' });
    s.number('Strength μ = GM', { get: () => a.strength, set: (v) => { a.strength = v; w.wakeAll(); }, min: -500, max: 2000, unit: 'm³/s²', digits: 1 });
    s.number('Softening radius', { get: () => a.radius, set: (v) => (a.radius = Math.max(0.01, v)), min: 0.01, max: 3, unit: 'm', digits: 2 });
    s.number('Range (0 = ∞)', { get: () => a.range, set: (v) => (a.range = Math.max(0, v)), min: 0, max: 50, unit: 'm', digits: 1 });
    s.readouts([{ label: 'v circ. @ 3 m', get: () => (a.strength > 0 ? f2(Math.sqrt(a.strength / 3), 3) + ' m/s' : '—') }, { label: 'g @ 3 m', get: () => f2(a.strength / 9, 3) + ' m/s²' }]);
    s.note('Circular orbit speed v = √(μ/r). Turn off room gravity to study orbits.');
  }

  k_fan(fa, f) {
    const w = this.app.world;
    const s = f.section('Fan', { id: 'f-main' });
    s.check('On', { get: () => fa.on, set: (v) => { fa.on = v; w.wakeAll(); } });
    s.number('Air speed', { get: () => fa.speed, set: (v) => { fa.speed = Math.max(0, v); w.wakeAll(); }, min: 0, max: 60, unit: 'm/s', digits: 1 });
    s.number('Direction', { get: () => deg(fa.angle), set: (v) => (fa.angle = rad(v)), min: -180, max: 180, unit: '°', digits: 1 });
    s.number('Reach', { get: () => fa.w, set: (v) => (fa.w = Math.max(0.2, v)), min: 0.2, max: 30, unit: 'm', digits: 2 });
    s.number('Width', { get: () => fa.h, set: (v) => (fa.h = Math.max(0.2, v)), min: 0.2, max: 20, unit: 'm', digits: 2 });
    s.check('Weakens with distance', { get: () => fa.falloff, set: (v) => (fa.falloff = v) });
    if (w.settings.airDensity <= 0) s.note('⚠ The room is a vacuum (air density 0): fans have no effect. Change it in Room → Air.');
  }

  k_wavestring(ws, f) {
    const app = this.app;
    const s = f.section('String', { id: 'w-str' });
    s.number('Tension T', { get: () => ws.tension, set: (v) => (ws.tension = Math.max(0.1, v)), min: 1, max: 1000, log: true, unit: 'N', digits: 1 });
    s.number('Linear density μ', { get: () => ws.density, set: (v) => (ws.density = Math.max(0.0005, v)), min: 0.001, max: 2, log: true, unit: 'kg/m', digits: 4 });
    s.number('Damping', { get: () => ws.damping, set: (v) => (ws.damping = Math.max(0, v)), min: 0, max: 5, unit: '1/s', digits: 3 });
    s.number('Segments', { get: () => ws.nodes, set: (v) => { ws.nodes = Math.round(v); ws.resize(); }, min: 16, max: 400, step: 1, digits: 0 });
    s.select('Far end', [{ value: 'fixed', label: 'Fixed (clamped)' }, { value: 'free', label: 'Free (ring on pole)' }, { value: 'absorb', label: 'Absorbing (no reflection)' }], { get: () => ws.endB, set: (v) => (ws.endB = v), rebuild: () => this.rebuild() });
    s.color('Colour', { get: () => ws.color, set: (v) => (ws.color = v) });
    s.check('Show nodes', { get: () => ws.showNodes, set: (v) => (ws.showNodes = v) });
    const d = f.section('Oscillator', { id: 'w-drv' });
    d.select('Waveform', [{ value: 'sine', label: 'Sine' }, { value: 'square', label: 'Square' }, { value: 'pulse', label: 'Single pulse' }, { value: 'none', label: 'Off (clamped)' }], { get: () => ws.driver.type, set: (v) => (ws.driver.type = v) });
    d.number('Frequency', { get: () => ws.driver.frequency, set: (v) => (ws.driver.frequency = Math.max(0.01, v)), min: 0.05, max: 20, unit: 'Hz', digits: 3 });
    d.number('Amplitude', { get: () => ws.driver.amplitude, set: (v) => (ws.driver.amplitude = Math.max(0, v)), min: 0, max: 2, unit: 'm', digits: 3 });
    d.buttons([
      { label: 'Send pulse', small: true, onClick: () => { ws.driver.type = 'pulse'; ws.sendPulse(app.world.time); this.refresh(); } },
      { label: 'Calm string', small: true, onClick: () => ws.reset() },
    ]);
    d.html('<div class="small-note">Drive at a harmonic:</div>');
    d.chips([1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: 'f' + n })), {
      isOn: (n) => Math.abs(ws.driver.frequency - ws.harmonic(n)) < 1e-3,
      set: (n) => { ws.driver.frequency = +ws.harmonic(n).toFixed(4); if (ws.driver.type === 'pulse' || ws.driver.type === 'none') ws.driver.type = 'sine'; this.refresh(); },
    });
    const th = f.section('Theory', { id: 'w-th' });
    th.readouts([
      { label: 'Wave speed', get: () => f2(ws.speed, 3) + ' m/s' },
      { label: 'Wavelength', get: () => f2(ws.wavelength, 3) + ' m' },
      { label: 'Length L', get: () => f2(ws.length, 3) + ' m' },
      { label: 'f₁', get: () => f2(ws.harmonic(1), 3) + ' Hz' },
      { label: 'f₂', get: () => f2(ws.harmonic(2), 3) + ' Hz' },
      { label: 'f₃', get: () => f2(ws.harmonic(3), 3) + ' Hz' },
      { label: 'Energy', get: () => f2(ws.energy(), 3) + ' J' },
    ]);
    th.note('v = √(T/μ) · fixed–fixed: fₙ = n·v/2L · fixed–free: fₙ = (2n−1)·v/4L. The driven end acts (nearly) as a node.');
  }
}

export function applyMaterial(b, key) {
  const m = MATERIALS[key];
  if (!m) return;
  b.material = { key, density: m.density, staticFriction: m.staticFriction, friction: m.friction, restitution: m.restitution };
  b.updateMass();
  b.wake();
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
