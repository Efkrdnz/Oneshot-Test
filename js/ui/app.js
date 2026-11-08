// Application controller: owns the world, the main loop, input, selection,
// undo history and all panels.

import { Camera } from './camera.js';
import { Renderer, fmtTime } from './renderer.js';
import { Recorder } from './recorder.js';
import { History } from './history.js';
import { storage } from './storage.js';
import { Inspector, applyMaterial } from './inspector.js';
import { RoomPanel, DataPanel, TimersPanel, openPresets, openFiles, openHelp, closeModal } from './panels.js';
import { TOOLS, TOOL_GROUPS, OPTION_DEFS, DEFAULT_OPTS, toolById } from './tools.js';
import { icon, hydrateIcons } from './icons.js';
import { hitTest, handlesOf, deleteEntity, duplicateEntity, entityCenter, entityName, moveEntity } from './entities.js';
import { serializeWorld, deserializeWorld, encodeShare, decodeShare } from '../lab/scene.js';
import { buildPreset, PRESETS } from '../lab/presets.js';
import { Timer } from '../engine/instruments.js';
import { MATERIALS } from '../engine/materials.js';

const $ = (id) => document.getElementById(id);

export class App {
  constructor() {
    this.canvas = $('canvas');
    this.camera = new Camera();
    this.renderer = new Renderer(this.canvas, this.camera);
    this.recorder = new Recorder();
    this.history = new History();
    this.selection = [];
    this.hover = null;
    this.hoverHandle = null;
    this.pointer = null;
    this.running = false;
    this.speed = 1;
    this.acc = 0;
    this.snapOn = false;
    this.marquee = null;
    this.eventLog = [];
    this.worldVersion = 0;
    this.startState = null;
    this.clipboard = null;
    const prefs = storage.prefs();
    this.opts = Object.assign({}, DEFAULT_OPTS, prefs.opts || {});
    this.display = Object.assign({
      grid: true, vectors: false, forces: 'selected', trails: true, strobe: false, labels: false, jointForces: false,
      com: false, contacts: false, sleep: false, follow: false,
    }, prefs.display || {});
    this.snapOn = !!prefs.snap;

    this.inspector = new Inspector(this, $('tab-inspect'));
    this.roomPanel = new RoomPanel(this, $('tab-room'));
    this.dataPanel = new DataPanel(this, $('tab-data'));
    this.timersPanel = new TimersPanel(this, $('tab-timers'));
    this.activeTab = 'inspect';

    this.buildToolbar();
    this.bindUI();
    this.bindCanvas();
    this.bindKeys();
    hydrateIcons(document);
    this.syncViewButtons();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.setTool('select');
    this.lastFrame = performance.now();
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTime = 0;
    this.refreshTimer = 0;
  }

  // ------------------------------------------------------------------ startup
  async start() {
    let loaded = false;
    const hash = location.hash || '';
    try {
      if (hash.startsWith('#s=')) {
        const data = await decodeShare(hash.slice(3));
        this.loadScene(data, false);
        this.toast('Opened shared experiment', 'good');
        loaded = true;
      } else if (hash.startsWith('#preset=')) {
        const id = hash.slice(8);
        if (PRESETS.some((p) => p.id === id)) {
          this.loadPreset(id);
          loaded = true;
        }
      }
    } catch (e) {
      console.warn(e);
      this.toast('Could not read the link', 'bad');
    }
    if (!loaded) {
      const auto = storage.loadAutosave();
      if (auto && auto.bodies) {
        try {
          this.loadScene(auto, false);
          this.toast('Restored your last session — open Experiments for more labs', 'good');
          loaded = true;
        } catch (e) {
          console.warn('autosave restore failed', e);
        }
      }
    }
    if (!loaded) this.loadPreset('brachistochrone');
    requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------------ world management
  setWorld(world, { keepCamera = false, resetHistory = true, fit = true } = {}) {
    this.world = world;
    world.recorder = this.recorder;
    this.selection = [];
    this.hover = null;
    this.worldVersion++;
    this.acc = 0;
    if (!keepCamera && fit) this.fitView(false);
    $('sceneName').value = world.meta?.name || 'Untitled experiment';
    if (resetHistory) {
      this.history.reset(this.serializeString());
      this.recorder.clear();
      this.eventLog = [];
    }
    this.showInfoCard();
    this.rebuildPanels();
    this.updateUndoButtons();
  }

  loadPreset(id) {
    const world = buildPreset(id);
    this.infoHidden = false;
    this.running = false;
    this.setWorld(world);
    this.startState = this.serialize();
    this.setRunning(false);
    this.autosave();
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* ignore */ }
  }

  loadScene(data, resetHistory = true, keepCamera = false) {
    const world = deserializeWorld(data);
    if (data.camera && !keepCamera) world.meta.camera = data.camera;
    this.setWorld(world, { keepCamera, resetHistory });
    if (data.view && !keepCamera) {
      this.camera.cx = data.view.cx;
      this.camera.cy = data.view.cy;
      this.camera.scale = data.view.scale;
    }
    if (resetHistory) {
      this.startState = world.time === 0 ? this.serialize() : null;
      this.setRunning(false);
    }
  }

  serialize() {
    const data = serializeWorld(this.world, { name: $('sceneName').value, description: this.world.meta?.description, camera: this.world.meta?.camera });
    data.goals = this.world.meta?.goals || [];
    data.view = { cx: this.camera.cx, cy: this.camera.cy, scale: this.camera.scale };
    return data;
  }

  serializeString() {
    const d = this.serialize();
    delete d.view;
    return JSON.stringify(d);
  }

  sceneName() {
    return $('sceneName').value || 'Untitled experiment';
  }

  // ------------------------------------------------------------------ undo / autosave
  commit(label = 'Edit') {
    if (this.history.push(this.serializeString(), label)) {
      this.updateUndoButtons();
      this.autosave();
    }
    this.worldVersionSoft = (this.worldVersionSoft || 0) + 1;
    this.panelsDirty = true;
    if (this.world.time > 0 && !this._tipShown && !this.running && label !== 'Timer') {
      this._tipShown = true;
      this.toast('Tip: Reset (R) rewinds to the state at the last Play from t = 0. Shift-click Reset to keep the current state as the new start.', 'warn', 6000);
    }
  }

  autosave() {
    clearTimeout(this._autoT);
    this._autoT = setTimeout(() => storage.saveAutosave(this.serialize()), 700);
  }

  undo() {
    const s = this.history.undo();
    if (s) this.restoreSnapshot(s.json, 'Undo ' + (this.history.stack[this.history.index + 1]?.label || ''));
  }

  redo() {
    const s = this.history.redo();
    if (s) this.restoreSnapshot(s.json, 'Redo ' + (s.label || ''));
  }

  restoreSnapshot(json, msg) {
    const sel = this.selection.map((s) => ({ kind: s.kind, id: s.obj.id }));
    const world = deserializeWorld(JSON.parse(json));
    world.meta = { ...this.world.meta, ...world.meta };
    this.setWorld(world, { keepCamera: true, resetHistory: false });
    // try to keep the selection
    for (const s of sel) {
      const list = s.kind === 'body' ? world.bodies : s.kind === 'joint' ? world.joints : world[{ pool: 'pools', gate: 'gates', timer: 'timers', ruler: 'rulers', label: 'labels', cannon: 'cannons', slingshot: 'slingshots', emitter: 'emitters', drain: 'drains', attractor: 'attractors', fan: 'fans', wavestring: 'waveStrings' }[s.kind]];
      const o = list && list.find((x) => x.id === s.id);
      if (o) this.selection.push({ kind: s.kind, obj: o });
    }
    this.inspector.rebuild();
    this.updateUndoButtons();
    this.autosave();
    this.setHint(msg.trim());
  }

  updateUndoButtons() {
    $('btnUndo').disabled = !this.history.canUndo;
    $('btnRedo').disabled = !this.history.canRedo;
  }

  // ------------------------------------------------------------------ transport
  setRunning(v) {
    if (v && !this.running && this.world.time === 0) {
      this.startState = this.serialize();
      this.recorder.clear();
    }
    if (v && this.world.time === 0) this.world.resetKinematicOrigins();
    this.running = v;
    // tuck the experiment notes away once the experiment runs
    if (v && !this.infoHidden && this.world.meta?.description) {
      this.infoHidden = true;
      this.showInfoCard();
    }
    const btn = $('btnPlay');
    btn.classList.toggle('running', v);
    btn.innerHTML = icon(v ? 'pause' : 'play');
    btn.title = v ? 'Pause (Space)' : 'Play (Space)';
    if (!v) {
      this.world.endDrag();
      this.panelsDirty = true;
    }
  }

  togglePlay() {
    this.setRunning(!this.running);
  }

  stepOnce() {
    if (this.running) this.setRunning(false);
    if (this.world.time === 0) {
      this.startState = this.serialize();
      this.world.resetKinematicOrigins();
    }
    const n = Math.max(1, Math.round(this.world.settings.stepRate / 60));
    for (let i = 0; i < n; i++) this.world.step();
    this.processEvents();
  }

  reset(keepCurrent = false) {
    if (keepCurrent) {
      // make the current state the new t = 0 start state
      this.world.time = 0;
      for (const t of this.world.timers) t.reset();
      for (const g of this.world.gates) g.resetState();
      for (const b of this.world.bodies) {
        b.trailPts = [];
        b.strobe = [];
      }
      this.world.resetKinematicOrigins();
      this.startState = this.serialize();
      this.recorder.clear();
      this.setRunning(false);
      this.commit('Set start');
      this.toast('Current state is now the start state (t = 0)', 'good');
      return;
    }
    if (!this.startState) {
      this.toast('No start state yet — press Play first', 'warn');
      return;
    }
    const sel = this.selection.map((s) => ({ kind: s.kind, id: s.obj.id }));
    this.setRunning(false);
    const world = deserializeWorld(this.startState);
    world.meta = { ...this.world.meta };
    this.setWorld(world, { keepCamera: true, resetHistory: false });
    for (const s of sel) {
      if (s.kind !== 'body') continue;
      const o = world.getBody(s.id);
      if (o) this.selection.push({ kind: 'body', obj: o });
    }
    this.inspector.rebuild();
    this.recorder.clear();
    this.eventLog = [];
    this.commit('Reset');
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    const realDt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const w = this.world;
    const dtSim = 1 / w.settings.stepRate;
    let steps = 0;
    if (this.running) {
      this.acc += realDt * this.speed;
      const maxSteps = Math.max(4, Math.ceil(this.speed * w.settings.stepRate / 30));
      const t0 = performance.now();
      while (this.acc >= dtSim && steps < maxSteps) {
        w.step();
        this.acc -= dtSim;
        steps++;
        if (performance.now() - t0 > 40) break; // stay responsive on heavy scenes
      }
      if (this.acc > dtSim * 4) this.acc = dtSim * 4;
      this.processEvents();
    }
    if (this.tool && this.tool.update) this.tool.update(this, realDt);
    if (this.blastFx) {
      this.blastFx.t += realDt;
      if (this.blastFx.t > 0.5) this.blastFx = null;
    }
    // follow selection
    if (this.display.follow && this.selection.length === 1 && this.selection[0].kind === 'body') {
      const b = this.selection[0].obj;
      const k = 1 - Math.pow(0.02, realDt);
      this.camera.cx += (b.x - this.camera.cx) * k;
      this.camera.cy += (b.y - this.camera.cy) * k;
    }
    this.camera.update(realDt);
    this.renderer.render(this, this.running ? this.acc / dtSim : 1, realDt);
    // UI refresh
    $('simTime').textContent = fmtTime(w.time);
    this.inspector.tick();
    if (this.activeTab === 'room') this.roomPanel.tick();
    if (this.activeTab === 'data') this.dataPanel.tick();
    if (this.activeTab === 'timers') this.timersPanel.tick();
    this.refreshTimer += realDt;
    if (this.refreshTimer > 0.25) {
      this.refreshTimer = 0;
      this.inspector.refresh();
      if (this.activeTab === 'room') this.roomPanel.refresh();
      if (this.panelsDirty) {
        this.panelsDirty = false;
        this.inspector.show();
        if (this.activeTab === 'timers' && this.timersPanel.structure !== this.structureKey()) this.rebuildTab('timers');
        if (this.activeTab === 'data' && this.dataPanel.structure !== this.structureKey()) this.rebuildTab('data');
      }
    }
    // stats
    this.frameCount++;
    this.fpsTime += realDt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.frameCount / this.fpsTime;
      this.frameCount = 0;
      this.fpsTime = 0;
      const nb = w.bodies.filter((b) => !b.room).length;
      $('statusFps').textContent = `${Math.round(this.fps)} fps`;
      $('statusCounts').textContent = `${nb} bodies · ${w.joints.filter((j) => !j.internal).length} links${w.fluid.count ? ' · ' + w.fluid.count + ' drops' : ''}`;
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  structureKey() {
    const w = this.world;
    return `${this.worldVersion}:${w.timers.length}:${w.gates.length}:${w.bodies.length}:${w.timers.map((t) => t.name + t.autoStart).join()}:${w.gates.map((g) => g.timerId + g.action + g.name).join()}`;
  }

  processEvents() {
    const evs = this.world.events;
    if (!evs.length) return;
    for (const e of evs) {
      let text = null;
      if (e.type === 'timer') {
        if (e.action === 'stop' || (e.action === 'toggle' && !this.world.getTimer(e.timer)?.running)) {
          text = `${e.timerName} stopped: ${e.value.toFixed(4)} s${e.gateName ? ' (' + e.gateName + ')' : ''}`;
          this.toast(`⏱ ${e.timerName}: <b>${e.value.toFixed(4)} s</b>`, 'good');
        } else if (e.action === 'lap') text = `${e.timerName} lap at ${e.value.toFixed(4)} s`;
        else if (e.action === 'reset') text = `${e.timerName} reset`;
        else text = `${e.timerName} started${e.gateName ? ' by ' + e.gateName : ''}`;
      } else if (e.type === 'gate') {
        if (e.kind === 'enter') text = `${e.gateName}: ${e.name} at ${e.speed.toFixed(3)} m/s`;
      } else if (e.type === 'break') {
        text = `A connector broke at ${e.force.toFixed(1)} N`;
        this.toast(`Connector snapped (${e.force.toFixed(0)} N)`, 'warn');
        this.panelsDirty = true;
      } else if (e.type === 'fire') {
        text = `${e.name} fired at ${e.speed.toFixed(2)} m/s`;
      } else if (e.type === 'lost') {
        text = `A body left the room and was removed`;
        this.deselectMissing();
      }
      if (text) this.eventLog.push({ time: e.time, text });
    }
    if (this.eventLog.length > 400) this.eventLog.splice(0, this.eventLog.length - 400);
    this.world.events = [];
  }

  deselectMissing() {
    const w = this.world;
    const before = this.selection.length;
    this.selection = this.selection.filter((s) => (s.kind === 'body' ? w.bodies.includes(s.obj) : s.kind === 'joint' ? w.joints.includes(s.obj) : true));
    if (this.selection.length !== before) this.inspector.show();
  }

  // ------------------------------------------------------------------ view
  resize() {
    this.renderer.resize();
  }

  fitView(animate = true) {
    const w = this.world;
    if (!w) return;
    const c = w.meta?.camera;
    if (c) {
      const t = { cx: c.cx, cy: c.cy, scale: this.camera.w / c.width };
      if (animate) this.camera.target = t;
      else Object.assign(this.camera, t);
      return;
    }
    const r = w.settings.room;
    const left = isFinite(r.left) ? r.left : -12;
    const right = isFinite(r.right) ? r.right : 12;
    this.camera.fit(left - 0.4, r.bottom - 0.8, right + 0.4, Math.min(r.top, r.bottom + (right - left) * 0.75) + 0.4, 30, animate);
  }

  focusSelection() {
    if (!this.selection.length) return;
    const c = entityCenter(this.selection[0].kind, this.selection[0].obj);
    this.camera.target = { cx: c.x, cy: c.y, scale: Math.max(this.camera.scale, 60) };
  }

  syncViewButtons() {
    $('btnSnap').classList.toggle('on', this.snapOn);
    $('btnVectors').classList.toggle('on', this.display.vectors);
  }

  savePrefs() {
    storage.savePrefs({ opts: this.opts, display: this.display, snap: this.snapOn });
  }

  snap(e) {
    const x = e.wx ?? e.x;
    const y = e.wy ?? e.y;
    if (!this.snapOn) return { x, y };
    const st = Math.max(0.05, this.renderer.gridStep());
    return { x: Math.round(x / st) * st, y: Math.round(y / st) * st };
  }

  // ------------------------------------------------------------------ selection
  isSelected(kind, obj) {
    for (const s of this.selection) if (s.obj === obj) return true;
    return false;
  }

  select(kind, obj, reveal = true) {
    this.selection = [{ kind, obj }];
    this.inspector.show();
    if (reveal && (this.activeTab === 'room')) this.showTab('inspect');
  }

  setSelection(list, reveal = true) {
    this.selection = list;
    this.inspector.show();
    if (reveal && this.activeTab === 'room') this.showTab('inspect');
  }

  toggleSelect(kind, obj) {
    if (this.isSelected(kind, obj)) this.selection = this.selection.filter((s) => s.obj !== obj);
    else this.selection.push({ kind, obj });
    this.inspector.show();
  }

  deselect(kind, obj) {
    const n = this.selection.length;
    this.selection = this.selection.filter((s) => s.obj !== obj);
    if (n !== this.selection.length) this.inspector.show();
  }

  clearSelection() {
    if (!this.selection.length) return;
    this.selection = [];
    this.inspector.show();
  }

  deleteSelection() {
    if (!this.selection.length) return;
    let n = 0;
    for (const s of this.selection) if (deleteEntity(this, s.kind, s.obj)) n++;
    this.selection = [];
    this.inspector.show();
    if (n) {
      this.commit('Delete');
      this.panelsDirty = true;
    }
  }

  duplicateSelection() {
    if (!this.selection.length) return;
    const out = [];
    for (const s of this.selection) {
      if (s.kind === 'body' && s.obj.room) continue;
      const d = duplicateEntity(this, s.kind, s.obj, 0.5, 0.5);
      if (d) out.push({ kind: s.kind, obj: d });
    }
    if (out.length) {
      this.setSelection(out);
      this.commit('Duplicate');
      this.panelsDirty = true;
    }
  }

  copySelection() {
    const bodies = this.selection.filter((s) => s.kind !== 'joint');
    if (!bodies.length) return;
    this.clipboard = bodies.map((s) => ({ kind: s.kind, obj: s.obj }));
    this.toast(`Copied ${bodies.length} object(s)`);
  }

  paste() {
    if (!this.clipboard) return;
    const p = this.pointer || { wx: this.camera.cx, wy: this.camera.cy };
    const c0 = entityCenter(this.clipboard[0].kind, this.clipboard[0].obj);
    const out = [];
    for (const s of this.clipboard) {
      if (s.kind === 'body' && !this.world.bodies.includes(s.obj)) continue;
      out.push({ kind: s.kind, obj: duplicateEntity(this, s.kind, s.obj, p.wx - c0.x, p.wy - c0.y) });
    }
    if (out.length) {
      this.setSelection(out);
      this.commit('Paste');
    }
  }

  weldSelection() {
    const bodies = this.selection.filter((s) => s.kind === 'body' && !s.obj.room).map((s) => s.obj);
    if (bodies.length < 2) return;
    for (let i = 1; i < bodies.length; i++) {
      const a = bodies[0];
      const b = bodies[i];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const j = this.world.createJoint('revolute', a, b, { localA: a.worldToLocal(mx, my), localB: b.worldToLocal(mx, my), lockAngle: true });
      j.name = 'Weld';
    }
    this.toast(`Glued ${bodies.length} bodies together`, 'good');
    this.commit('Weld');
  }

  moveBodyTo(b, x, y) {
    moveEntity(this, 'body', b, x - b.x, y - b.y);
  }

  setBodyGeometry(b, geom) {
    const dp = b.designPosition();
    b.setGeometry(geom);
    b.setDesignPosition(dp.x, dp.y);
    b.syncShapes();
    b.wake();
    this.world.wakeAll();
  }

  onEntityGeometryChanged() {
    this.world.wakeAll();
  }

  addTimerNear(gate) {
    const w = this.world;
    let x = this.camera.cx;
    let y = this.camera.cy;
    if (gate) {
      x = (gate.x1 + gate.x2) / 2 + 1.6;
      y = Math.max(gate.y1, gate.y2) + 0.8;
    }
    const t = new Timer({ x, y, name: 'Timer ' + (w.timers.length + 1) });
    w.timers.push(t);
    this.panelsDirty = true;
    return t;
  }

  focusInspectorText() {
    const ta = $('tab-inspect').querySelector('textarea');
    if (ta) {
      ta.focus();
      ta.select();
    }
  }

  // ------------------------------------------------------------------ export
  download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  fileBase() {
    return this.sceneName().replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-').toLowerCase() || 'experiment';
  }

  exportJSON() {
    this.download(this.fileBase() + '.physlab.json', JSON.stringify(this.serialize(), null, 1), 'application/json');
  }

  exportCSV() {
    this.download(this.fileBase() + '-data.csv', this.recorder.toCSV(this.world), 'text/csv');
  }

  async shareLink() {
    const data = this.serialize();
    if (data.particles && data.particles.length > 5 * 1500) data.particles = [];
    const code = await encodeShare(data);
    return location.origin + location.pathname + '#s=' + code;
  }

  // ------------------------------------------------------------------ UI building
  buildToolbar() {
    const tb = $('toolbar');
    tb.innerHTML = '';
    this.toolButtons = new Map();
    const tip = document.createElement('div');
    tip.className = 'tooltip hidden';
    document.body.append(tip);
    for (const g of TOOL_GROUPS) {
      const grp = document.createElement('div');
      grp.className = 'tool-group';
      grp.innerHTML = `<div class="tool-group-title">${g}</div>`;
      const grid = document.createElement('div');
      grid.className = 'tool-grid';
      for (const t of TOOLS.filter((x) => x.group === g)) {
        const b = document.createElement('button');
        b.className = 'tool';
        b.innerHTML = icon(t.icon) + (t.key ? `<span class="key">${t.key}</span>` : '');
        b.setAttribute('aria-label', t.name);
        b.addEventListener('click', () => this.setTool(t.id));
        b.addEventListener('mouseenter', () => {
          tip.innerHTML = `<b>${t.name}${t.key ? ` <span class="kbd">${t.key}</span>` : ''}</b><span>${t.hint}</span>`;
          tip.classList.remove('hidden');
          const r = b.getBoundingClientRect();
          tip.style.left = r.right + 10 + 'px';
          tip.style.top = Math.min(window.innerHeight - 90, r.top) + 'px';
        });
        b.addEventListener('mouseleave', () => tip.classList.add('hidden'));
        grid.append(b);
        this.toolButtons.set(t.id, b);
      }
      grp.append(grid);
      tb.append(grp);
    }
  }

  setTool(id) {
    if (this.tool && this.tool.cancel) this.tool.cancel(this);
    const t = toolById(id) || toolById('select');
    this.tool = t;
    for (const [k, b] of this.toolButtons) b.classList.toggle('active', k === t.id);
    this.buildOptionsBar();
    this.setHint(t.hint);
    this.canvas.style.cursor = t.id === 'pan' ? 'grab' : t.id === 'select' ? 'default' : 'crosshair';
  }

  buildOptionsBar() {
    const bar = $('optionsBar');
    const t = this.tool;
    bar.innerHTML = '';
    const inner = document.createElement('div');
    inner.className = 'ob-inner';
    inner.innerHTML = `<div class="ob-title">${icon(t.icon)}<span>${t.name}</span></div>`;
    if (!t.options.length) {
      const h = document.createElement('span');
      h.className = 'ob-hint';
      h.textContent = t.hint;
      inner.append(h);
    }
    for (const key of t.options) {
      const def = OPTION_DEFS[key];
      if (!def) continue;
      const fld = document.createElement('label');
      fld.className = 'ob-field';
      fld.title = def.title || '';
      fld.append(document.createTextNode(def.label));
      let input;
      if (def.type === 'select') {
        input = document.createElement('select');
        for (const o of def.options()) {
          const op = document.createElement('option');
          op.value = o.value;
          op.textContent = o.label;
          input.append(op);
        }
        input.value = String(this.opts[key]);
        input.addEventListener('change', () => {
          this.opts[key] = input.value;
          this.savePrefs();
          if (key === 'material') swatch.style.background = MATERIALS[input.value]?.color || '#888';
        });
      } else if (def.type === 'check') {
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!this.opts[key];
        input.addEventListener('change', () => {
          this.opts[key] = input.checked;
          this.savePrefs();
        });
      } else {
        input = document.createElement('input');
        input.type = 'number';
        input.min = def.min;
        input.max = def.max;
        input.step = def.step;
        input.value = this.opts[key];
        input.addEventListener('change', () => {
          let v = parseFloat(input.value);
          if (!isFinite(v)) v = DEFAULT_OPTS[key];
          v = Math.max(def.min, Math.min(def.max, v));
          input.value = v;
          this.opts[key] = v;
          this.savePrefs();
        });
        input.addEventListener('keydown', (e) => e.stopPropagation());
      }
      fld.append(input);
      let swatch = null;
      if (key === 'material') {
        swatch = document.createElement('span');
        swatch.style.cssText = `width:12px;height:12px;border-radius:3px;display:inline-block;background:${MATERIALS[this.opts.material]?.color}`;
        fld.append(swatch);
      }
      if (def.unit) {
        const u = document.createElement('span');
        u.textContent = def.unit;
        u.style.color = 'var(--dim)';
        fld.append(u);
      }
      inner.append(fld);
    }
    bar.append(inner);
  }

  bindUI() {
    $('btnPlay').addEventListener('click', () => this.togglePlay());
    $('btnStep').addEventListener('click', () => this.stepOnce());
    $('btnReset').addEventListener('click', (e) => this.reset(e.shiftKey));
    $('btnReset').title = 'Reset to start state (R) · Shift-click: make the current state the start';
    $('speedSel').addEventListener('change', (e) => {
      this.speed = parseFloat(e.target.value);
    });
    $('btnUndo').addEventListener('click', () => this.undo());
    $('btnRedo').addEventListener('click', () => this.redo());
    $('btnPresets').addEventListener('click', () => openPresets(this));
    $('btnFiles').addEventListener('click', () => openFiles(this));
    $('btnHelp').addEventListener('click', () => openHelp());
    $('modalClose').addEventListener('click', () => closeModal());
    $('modal').addEventListener('pointerdown', (e) => {
      if (e.target.id === 'modal') closeModal();
    });
    $('btnZoomIn').addEventListener('click', () => this.camera.zoomAt(this.camera.w / 2, this.camera.h / 2, 1.25));
    $('btnZoomOut').addEventListener('click', () => this.camera.zoomAt(this.camera.w / 2, this.camera.h / 2, 0.8));
    $('btnFit').addEventListener('click', () => this.fitView(true));
    $('btnSnap').addEventListener('click', () => this.toggleSnap());
    $('btnVectors').addEventListener('click', () => {
      this.display.vectors = !this.display.vectors;
      this.display.forces = this.display.vectors ? (this.display.forces === 'off' ? 'selected' : this.display.forces) : this.display.forces;
      this.savePrefs();
      this.syncViewButtons();
      if (this.activeTab === 'room') this.roomPanel.refresh();
    });
    $('btnPanel').addEventListener('click', () => $('sidepanel').classList.toggle('open'));
    $('sceneName').addEventListener('change', () => {
      if (this.world.meta) this.world.meta.name = $('sceneName').value;
      this.commit('Rename');
    });
    $('sceneName').addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') e.target.blur();
    });
    for (const tab of document.querySelectorAll('.tab')) tab.addEventListener('click', () => this.showTab(tab.dataset.tab));
    $('infoToggle').addEventListener('click', () => {
      this.infoHidden = false;
      this.showInfoCard();
    });
    document.addEventListener('pointerdown', (e) => {
      const m = $('ctxMenu');
      if (!m.classList.contains('hidden') && !m.contains(e.target)) m.classList.add('hidden');
    });
    window.addEventListener('beforeunload', () => {
      try {
        storage.saveAutosave(this.serialize());
      } catch (e) { /* ignore */ }
    });
  }

  toggleSnap() {
    this.snapOn = !this.snapOn;
    this.syncViewButtons();
    this.savePrefs();
    this.toast(this.snapOn ? 'Grid snap on' : 'Grid snap off');
  }

  showTab(name) {
    this.activeTab = name;
    for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.tab === name);
    for (const p of document.querySelectorAll('.tab-pane')) p.classList.toggle('active', p.id === 'tab-' + name);
    this.rebuildTab(name);
  }

  rebuildTab(name) {
    if (name === 'room') this.roomPanel.rebuild();
    if (name === 'data') {
      this.dataPanel.rebuild();
      this.dataPanel.structure = this.structureKey();
    }
    if (name === 'timers') {
      this.timersPanel.rebuild();
      this.timersPanel.structure = this.structureKey();
    }
    if (name === 'inspect') this.inspector.rebuild();
  }

  rebuildPanels() {
    this.inspector.rebuild();
    this.rebuildTab(this.activeTab);
  }

  showInfoCard() {
    const meta = this.world?.meta || {};
    const card = $('infoCard');
    const toggle = $('infoToggle');
    if (!meta.description) {
      card.classList.add('hidden');
      toggle.classList.add('hidden');
      return;
    }
    const preset = PRESETS.find((p) => p.id === meta.preset);
    const goals = meta.goals || [];
    card.innerHTML = `<button class="tbtn close" title="Hide notes">${icon('close')}</button>
      <h3>${preset ? `<span class="tag">${preset.category}</span>` : ''}${escapeHtml(meta.name || '')}</h3>
      <p>${escapeHtml(meta.description)}</p>${goals.length ? `<ul>${goals.map((g) => `<li>${escapeHtml(g)}</li>`).join('')}</ul>` : ''}`;
    card.querySelector('.close').addEventListener('click', () => {
      this.infoHidden = true;
      this.showInfoCard();
    });
    card.classList.toggle('hidden', !!this.infoHidden);
    toggle.classList.toggle('hidden', !this.infoHidden);
  }

  setHint(text) {
    $('statusHint').textContent = text;
  }

  toast(html, kind = '', ms = 2800) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = html;
    box.append(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 320);
    }, ms);
  }

  // ------------------------------------------------------------------ canvas input
  eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const w = this.camera.toWorld(sx, sy);
    return { sx, sy, wx: w.x, wy: w.y, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, button: e.button };
  }

  bindCanvas() {
    const c = this.canvas;
    this.pointers = new Map();
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.focus();
      $('ctxMenu').classList.add('hidden');
      c.setPointerCapture(e.pointerId);
      const p = this.eventPos(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        // start pinch: cancel any tool action
        if (this.tool.cancel) this.tool.cancel(this);
        this.toolActive = false;
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy), cx: (a.sx + b.sx) / 2, cy: (a.sy + b.sy) / 2 };
        return;
      }
      if (this.pointers.size > 2) return;
      this.downScreen = { x: p.sx, y: p.sy };
      if (e.button === 1 || (e.button === 0 && this.spaceDown)) {
        if (this.spaceDown) this.spaceUsedForPan = true;
        this.panning = { x: p.sx, y: p.sy };
        c.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 2) {
        this.rightDown = { x: p.sx, y: p.sy };
        this.panning = { x: p.sx, y: p.sy, right: true };
        return;
      }
      this.toolActive = true;
      this.tool.down && this.tool.down(this, p);
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.eventPos(e);
      this.pointer = p;
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      $('statusCursor').textContent = `x ${p.wx.toFixed(2)} · y ${p.wy.toFixed(2)} m`;
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.sx - b.sx, a.sy - b.sy);
        const cx = (a.sx + b.sx) / 2;
        const cy = (a.sy + b.sy) / 2;
        this.camera.pan(cx - this.pinch.cx, cy - this.pinch.cy);
        if (this.pinch.d > 10) this.camera.zoomAt(cx, cy, d / this.pinch.d);
        this.pinch = { d, cx, cy };
        return;
      }
      if (this.panning) {
        this.camera.pan(p.sx - this.panning.x, p.sy - this.panning.y);
        this.panning.x = p.sx;
        this.panning.y = p.sy;
        return;
      }
      if (this.toolActive) {
        this.tool.move && this.tool.move(this, p);
        return;
      }
      this.updateHover(p);
    });
    const up = (e) => {
      const p = this.eventPos(e);
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        return;
      }
      if (this.panning) {
        const wasRight = this.panning.right;
        this.panning = null;
        c.style.cursor = this.tool.id === 'pan' ? 'grab' : this.tool.id === 'select' ? 'default' : 'crosshair';
        if (wasRight && this.rightDown && Math.hypot(p.sx - this.rightDown.x, p.sy - this.rightDown.y) < 5) this.openContextMenu(p, e);
        this.rightDown = null;
        return;
      }
      if (this.toolActive) {
        this.toolActive = false;
        this.tool.up && this.tool.up(this, p);
      }
      this.downScreen = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      this.panning = null;
      if (this.toolActive && this.tool.cancel) this.tool.cancel(this);
      this.toolActive = false;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = this.eventPos(e);
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      this.camera.zoomAt(p.sx, p.sy, factor);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const p = this.eventPos(e);
      if (this.tool.id !== 'select') return;
      const hit = hitTest(this, p.wx, p.wy, 6 / this.camera.scale);
      if (hit) {
        this.select(hit.kind, hit.obj);
        this.showTab('inspect');
        if ($('sidepanel').classList.contains('open') === false && window.innerWidth <= 820) $('sidepanel').classList.add('open');
      }
    });
  }

  updateHover(p) {
    const tol = 6 / this.camera.scale;
    let cursor = this.tool.id === 'pan' ? 'grab' : this.tool.id === 'select' ? 'default' : 'crosshair';
    this.hoverHandle = null;
    if (this.tool.id === 'select' || this.tool.id === 'grab' || this.tool.id === 'eraser' || this.tool.id === 'launch') {
      if (this.selection.length === 1 && this.tool.id === 'select') {
        const s = this.selection[0];
        for (const h of handlesOf(s.kind, s.obj, this)) {
          const hs = this.camera.toScreen(h.x, h.y);
          if (Math.abs(hs.x - p.sx) < 8 && Math.abs(hs.y - p.sy) < 8) {
            this.hoverHandle = h;
            cursor = 'move';
          }
        }
        if (s.kind === 'body' && !s.obj.room) {
          const rh = this.renderer.rotateHandlePos(s.obj);
          if (Math.hypot(rh.x - p.sx, rh.y - p.sy) < 9) cursor = 'alias';
        }
      }
      const hit = hitTest(this, p.wx, p.wy, tol);
      this.hover = hit;
      if (hit && cursor === 'default') cursor = hit.kind === 'body' && hit.obj.locked ? 'not-allowed' : this.running && hit.kind === 'body' && hit.obj.type === 'dynamic' ? 'grab' : 'move';
      if (hit && this.tool.id === 'eraser') cursor = 'not-allowed';
      for (const s of this.world.slingshots) if (Math.hypot(p.wx - s.x, p.wy - s.y) < Math.max(0.35, 14 / this.camera.scale)) cursor = 'grab';
      if (hit) this.setHint(`${entityName(hit.kind, hit.obj)} — ${hit.kind === 'body' ? `${hit.obj.type}, ${hit.obj.material.key}${hit.obj.type === 'dynamic' ? ', ' + hit.obj.mass.toFixed(3) + ' kg' : ''}` : hit.kind}`);
      else this.setHint(this.tool.hint);
    } else this.hover = null;
    this.canvas.style.cursor = cursor;
  }

  openContextMenu(p, e) {
    const hit = hitTest(this, p.wx, p.wy, 6 / this.camera.scale);
    const m = $('ctxMenu');
    m.innerHTML = '';
    const add = (label, ic, fn, cls = '') => {
      const b = document.createElement('button');
      b.className = cls;
      b.innerHTML = `${icon(ic)}<span>${label}</span>`;
      b.addEventListener('click', () => {
        m.classList.add('hidden');
        fn();
      });
      m.append(b);
    };
    const hr = () => m.append(document.createElement('hr'));
    if (hit && !(hit.kind === 'body' && hit.obj.room)) {
      if (!this.isSelected(hit.kind, hit.obj)) this.select(hit.kind, hit.obj, false);
      const o = hit.obj;
      m.insertAdjacentHTML('beforeend', `<div class="ctx-title">${escapeHtml(entityName(hit.kind, o))}</div>`);
      if (hit.kind === 'body') {
        add(o.type === 'static' ? 'Make dynamic' : 'Make static', 'lock', () => { o.setType(o.type === 'static' ? 'dynamic' : 'static'); this.commit('Type'); this.inspector.rebuild(); });
        add(o.trail ? 'Hide trail' : 'Show trail', 'trail', () => { o.trail = !o.trail; if (!o.trail) { o.trailPts = []; o.strobe = []; } this.commit('Trail'); });
        add(o.record ? 'Stop recording' : 'Record for graphs', 'record', () => { o.record = !o.record; this.commit('Record'); this.panelsDirty = true; });
        add('Pin to background here', 'pin', () => {
          const j = this.world.createJoint('revolute', this.world.ground, o, { localA: { x: p.wx, y: p.wy }, localB: o.worldToLocal(p.wx, p.wy) });
          j.name = 'Pin';
          this.commit('Pin');
        });
        add('Stop motion', 'pause', () => { o.vx = o.vy = o.w = 0; this.commit('Stop'); });
        add('Bring to front', 'plus', () => { const w = this.world; w.bodies.splice(w.bodies.indexOf(o), 1); w.bodies.push(o); this.commit('Order'); });
        if (o.type === 'dynamic') {
          add('Material: rubber', 'circle', () => { applyMaterial(o, 'rubber'); this.commit('Material'); this.inspector.rebuild(); });
          add('Material: steel', 'circle', () => { applyMaterial(o, 'steel'); this.commit('Material'); this.inspector.rebuild(); });
          add('Material: ice', 'circle', () => { applyMaterial(o, 'ice'); this.commit('Material'); this.inspector.rebuild(); });
        }
      }
      if (hit.kind === 'cannon') add('Fire!', 'cannon', () => { o.fire(this.world); this.commit('Fire'); });
      if (hit.kind === 'timer') add(o.running ? 'Stop' : 'Start', 'timer', () => { o.running ? o.stop(this.world.time) : o.start(this.world.time); this.commit('Timer'); });
      if (hit.kind === 'wavestring') add('Send pulse', 'wave', () => { o.driver.type = 'pulse'; o.sendPulse(this.world.time); });
      hr();
      add('Duplicate', 'copy', () => this.duplicateSelection());
      add('Focus view', 'target', () => this.focusSelection());
      add('Delete', 'trash', () => this.deleteSelection(), 'danger');
    } else {
      m.insertAdjacentHTML('beforeend', '<div class="ctx-title">Lab</div>');
      add(this.running ? 'Pause' : 'Play', this.running ? 'pause' : 'play', () => this.togglePlay());
      add('Reset to start', 'reset', () => this.reset());
      if (this.clipboard) add('Paste here', 'copy', () => this.paste());
      add('Fit view', 'fit', () => this.fitView(true));
      add(this.snapOn ? 'Grid snap off' : 'Grid snap on', 'grid', () => this.toggleSnap());
      add('Clear trails', 'trail', () => this.world.clearTrails());
      hr();
      add('Experiments…', 'flask', () => openPresets(this));
    }
    m.classList.remove('hidden');
    const mw = 210;
    const mh = m.offsetHeight || 300;
    m.style.left = Math.min(e.clientX, window.innerWidth - mw - 8) + 'px';
    m.style.top = Math.min(e.clientY, window.innerHeight - mh - 8) + 'px';
  }

  // ------------------------------------------------------------------ keyboard
  bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!$('modal').classList.contains('hidden')) {
        if (e.key === 'Escape') closeModal();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (this.tool.onKey && this.tool.onKey(this, e)) {
        e.preventDefault();
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.spaceTimer) {
          this.spaceDown = true;
          this.spaceUsedForPan = false;
          this.spaceTimer = performance.now();
        }
        return;
      }
      if (ctrl && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (ctrl && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        this.redo();
        return;
      }
      if (ctrl && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        this.duplicateSelection();
        return;
      }
      if (ctrl && (e.key === 'c' || e.key === 'C')) {
        this.copySelection();
        return;
      }
      if (ctrl && (e.key === 'v' || e.key === 'V')) {
        this.paste();
        return;
      }
      if (ctrl && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        this.toggleSnap();
        return;
      }
      if (ctrl && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        openFiles(this);
        return;
      }
      if (ctrl) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        this.deleteSelection();
        return;
      }
      if (e.key === 'Escape') {
        if (this.tool.cancel) this.tool.cancel(this);
        this.toolActive = false;
        this.marquee = null;
        if (this.tool.id !== 'select') this.setTool('select');
        else this.clearSelection();
        $('ctxMenu').classList.add('hidden');
        return;
      }
      if (e.key === '.') {
        this.stepOnce();
        return;
      }
      if (e.key === 'r' || e.key === 'R') {
        this.reset(e.shiftKey);
        return;
      }
      if (e.key === '0' || e.key === 'Home') {
        this.fitView(true);
        return;
      }
      if (e.key === '?') {
        openHelp();
        return;
      }
      if (e.key.startsWith('Arrow') && this.selection.length) {
        e.preventDefault();
        const d = e.shiftKey ? 0.1 : 0.01;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
        const dy = e.key === 'ArrowDown' ? -d : e.key === 'ArrowUp' ? d : 0;
        for (const s of this.selection) moveEntity(this, s.kind, s.obj, dx, dy);
        clearTimeout(this._nudgeT);
        this._nudgeT = setTimeout(() => this.commit('Nudge'), 400);
        return;
      }
      const k = e.key.toUpperCase();
      const t = TOOLS.find((x) => x.key === k);
      if (t) this.setTool(t.id);
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        const held = this.spaceTimer ? performance.now() - this.spaceTimer : 0;
        this.spaceDown = false;
        this.spaceTimer = null;
        if (!this.spaceUsedForPan && held < 400) this.togglePlay();
        this.spaceUsedForPan = false;
      }
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
