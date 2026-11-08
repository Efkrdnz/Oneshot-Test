// Ready-made experiments. Each preset builds a world with the Builder API.

import { World } from '../engine/world.js';
import { Builder } from './builder.js';

const deg = (d) => (d * Math.PI) / 180;

function cycloidPoints(x0, y0, x1, y1, n) {
  // cycloid from (x0,y0) down to (x1,y1): x = R(t - sin t), y = -R(1 - cos t)
  const dx = x1 - x0;
  const dy = y0 - y1;
  const ratio = dx / dy;
  let lo = 1e-3;
  let hi = 2 * Math.PI - 1e-3;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    const r = (m - Math.sin(m)) / (1 - Math.cos(m));
    if (r < ratio) lo = m;
    else hi = m;
  }
  const T = (lo + hi) / 2;
  const R = dy / (1 - Math.cos(T));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (T * i) / n;
    pts.push({ x: x0 + R * (t - Math.sin(t)), y: y0 - R * (1 - Math.cos(t)) });
  }
  return pts;
}

function bezier(p0, p1, p2, p3, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    });
  }
  return pts;
}

// Ball resting on a track polyline at parameter index i (offset along normal)
function onPolyline(pts, i, r) {
  const a = pts[i];
  const b = pts[Math.min(i + 1, pts.length - 1)];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return { x: a.x - (dy / l) * r, y: a.y + (dx / l) * r };
}

export const PRESETS = [
  {
    id: 'sandbox',
    name: 'Empty lab',
    category: 'Sandbox',
    description: 'A clean room with a floor and walls. Build anything you like.',
    goals: ['Pick a tool on the left and drag in the room', 'Open "Room" to change gravity, air and walls'],
    build(B) {
      B.label(0, 7, 'Empty lab — choose a tool on the left to start building', { size: 0.45, color: '#64748b' });
    },
  },
  {
    id: 'galileo',
    name: 'Free fall: vacuum vs. air',
    category: 'Mechanics',
    description: 'Three objects are released from the same height. Photogates near the floor stop a chronometer for each. Turn the air off (Room → Air: Vacuum) and they land together.',
    goals: ['Press Play and compare the three times', 'Room → Air → Vacuum, then Reset & Play', 'Theory: t = √(2h/g) ≈ 1.41 s for h = 9.75 m'],
    build(B) {
      const lanes = [
        { x: -6, name: 'Steel ball', make: (x) => B.ball(x, 11, 0.25, 'steel', { trail: true, record: true, name: 'Steel ball' }) },
        { x: 0, name: 'Foam ball', make: (x) => B.ball(x, 11, 0.25, 'foam', { trail: true, record: true, name: 'Foam ball' }) },
        { x: 6, name: 'Foam sheet', make: (x) => B.box(x, 11, 1.2, 0.05, 'foam', { trail: true, record: true, name: 'Foam sheet' }) },
      ];
      for (const l of lanes) {
        const b = l.make(l.x);
        const t = B.timer(l.x, 13.1, l.name, { autoStart: true });
        B.gate(l.x - 1.2, 1, l.x + 1.2, 1, { timerId: t.id, action: 'stop', name: 'Floor gate', filterBody: b.id });
        B.label(l.x, 12.1, l.name, { size: 0.32 });
      }
      B.ruler(-8, 1, -8, 10.75, { name: 'Drop height' });
      B.label(-3, 0.45, 'Photogate beam at 1.00 m', { size: 0.22, color: '#94a3b8' });
    },
  },
  {
    id: 'incline',
    name: 'Inclined planes & friction',
    category: 'Mechanics',
    description: 'Three 30° slopes made of ice, wood and rubber with a matching block on each. Two photogates per slope time the block over 4.16 m. Static friction keeps the rubber block in place.',
    goals: ['Theory: a = g(sin θ − μk cos θ), stays put if tan θ ≤ μs', 'Change a slope angle by rotating it, or edit friction in the Inspector', 'Ice: a ≈ 4.65 m/s² · Wood: a ≈ 1.51 m/s² · Rubber: stays'],
    build(B) {
      const mats = [
        { key: 'ice', base: 8.6, name: 'Ice on ice' },
        { key: 'wood', base: 4.3, name: 'Wood on wood' },
        { key: 'rubber', base: 0, name: 'Rubber on rubber' },
      ];
      for (const m of mats) {
        const inc = B.incline(-9, m.base, 6, 30, m.key);
        if (m.base > 0) B.wall(-1, m.base - 0.1, 4, 0.2, m.key, { name: 'Shelf' });
        B.wall(1.1, m.base + 0.25, 0.2, 0.5, 'concrete', { name: 'Stop' });
        const p = B.onIncline(inc, 0.08, 0.151);
        const blk = B.box(p.x, p.y, 0.5, 0.3, m.key, { angle: p.angle, trail: false, record: true, name: m.name + ' block' });
        const t = B.timer(4.5, m.base + 2.6, m.name, {});
        const g1 = B.onIncline(inc, 0.2, 0.02);
        const g1b = B.onIncline(inc, 0.2, 0.9);
        const g2 = B.onIncline(inc, 0.8, 0.02);
        const g2b = B.onIncline(inc, 0.8, 0.9);
        B.gate(g1.x, g1.y, g1b.x, g1b.y, { timerId: t.id, action: 'start', name: 'Start', filterBody: blk.id });
        B.gate(g2.x, g2.y, g2b.x, g2b.y, { timerId: t.id, action: 'stop', name: 'Finish', filterBody: blk.id });
        B.label(4.5, m.base + 1.6, m.name + ' (30°)', { size: 0.26 });
      }
    },
  },
  {
    id: 'brachistochrone',
    name: 'Brachistochrone race',
    category: 'Mechanics',
    description: 'Three frictionless beads slide from the same start to the same finish along a straight ramp, a cycloid and a deep curve. Which arrives first? Collision layers keep the tracks independent.',
    goals: ['Press Play and watch the finish timers', 'The cycloid is the curve of fastest descent', 'Straight path is shortest but slowest'],
    build(B) {
      // E chosen so the cycloid reaches it exactly at its lowest point (horizontal arrival)
      const S = { x: -10, y: 10 };
      const E = { x: S.x + (Math.PI / 2) * 7.5, y: 2.5 };
      const frictionless = { staticFriction: 0, friction: 0, restitution: 0, density: 2000 };
      const lanes = [
        { name: 'Straight', pts: [S, E], color: '#f472b6', layer: 2 },
        { name: 'Cycloid', pts: cycloidPoints(S.x, S.y, E.x, E.y, 160), color: '#38bdf8', layer: 4 },
        { name: 'Deep curve', pts: bezier(S, { x: -9.8, y: -1.4 }, { x: E.x - 4, y: 0.3 }, E, 160), color: '#facc15', layer: 8 },
      ];
      lanes.forEach((l, idx) => {
        // after the finish: a smooth run-out onto a flat shelf
        const last = l.pts[l.pts.length - 1];
        const prev = l.pts[l.pts.length - 2];
        const dir = Math.atan2(last.y - prev.y, last.x - prev.x);
        const runout = [];
        if (dir > 0.05) {
          // arriving uphill: keep going straight (a convex bend would launch the bead)
          runout.push({ x: last.x + Math.cos(dir) * 3, y: last.y + Math.sin(dir) * 3 });
        } else {
          // arriving downhill: concave bend into a flat shelf
          for (let k = 1; k <= 12; k++) {
            const a = dir * (1 - k / 12);
            const p0 = runout.length ? runout[runout.length - 1] : last;
            runout.push({ x: p0.x + Math.cos(a) * 0.15, y: p0.y + Math.sin(a) * 0.15 });
          }
          runout.push({ x: Math.max(runout[runout.length - 1].x + 0.5, 11.4), y: runout[runout.length - 1].y });
        }
        const pts = l.pts.concat(runout);
        B.track(pts, { material: { staticFriction: 0, friction: 0, restitution: 0, density: 2200 }, layer: l.layer, mask: l.layer, color: l.color, name: l.name + ' track', thickness: 0.12 });
        const st = onPolyline(pts, 0, 0.2);
        const bead = B.ball(st.x + 0.05, st.y, 0.2, 'teflon', { material: frictionless, layer: l.layer, mask: 1 | l.layer, color: l.color, name: l.name + ' bead', trail: true });
        const t = B.timer(-4 + idx * 4.2, 13.1, l.name, { autoStart: true, color: l.color });
        B.gate(E.x + 0.4, E.y, E.x + 0.4, E.y + 1.2, { timerId: t.id, action: 'stop', mode: 'center', filterBody: bead.id, name: 'Finish (' + l.name + ')' });
      });
      B.room({ right: 12 });
      B.label(E.x + 0.4, E.y + 1.7, 'Finish line', { size: 0.26 });
    },
  },
  {
    id: 'projectile',
    name: 'Projectile motion & drag',
    category: 'Mechanics',
    description: 'Two identical balsa balls are fired at 45° and 14 m/s. The pink one feels air resistance, the blue one has Cd = 0 (as in vacuum). The dashed curve is the ideal parabola.',
    goals: ['Ideal range R = v² sin 2θ / g ≈ 20 m', 'Compare the two landing points', 'Change angle/speed in the Inspector (select a cannon)'],
    build(B) {
      B.cannon(-10.5, 0.6, 45, 14, { name: 'Twin cannons', fireOnStart: true, projectile: { r: 0.15, material: 'balsa', layer: 2, mask: 1, color: '#f472b6' } });
      const c2 = B.cannon(-10.5, 0.6, 45, 14, { name: 'Without drag (Cd = 0)', fireOnStart: true, projectile: { r: 0.15, material: 'balsa', dragCoef: 0, layer: 4, mask: 1, color: '#38bdf8' }, showPrediction: false });
      c2.hideLabel = true;
      B.ruler(-9.86, 0.2, 10.12, 0.2, { name: 'Ideal range' });
      B.label(0, 7.4, 'Max height (ideal) = v² sin²θ / 2g ≈ 5.0 m', { size: 0.28, color: '#94a3b8' });
      B.label(-4, 12, 'Pink: air drag   ·   Blue: no drag', { size: 0.32 });
    },
  },
  {
    id: 'pendulum',
    name: 'Pendulum lab',
    category: 'Oscillations',
    description: 'Three simple pendulums released from 15°. Two share the same length but have very different masses; one is longer. Photogates at the bottom record half-periods as laps.',
    goals: ['Theory: T = 2π√(L/g) — independent of mass', 'L = 2 m → T ≈ 2.84 s · L = 4.5 m → T ≈ 4.26 s', 'Lap times are half periods'],
    build(B) {
      B.room({ ceiling: true, top: 13.5 });
      const defs = [
        { x: -7, L: 2, mat: 'steel', name: 'L = 2 m (steel)' },
        { x: -1.5, L: 2, mat: 'wood', name: 'L = 2 m (wood)' },
        { x: 5, L: 4.5, mat: 'steel', name: 'L = 4.5 m (steel)' },
      ];
      for (const d of defs) {
        const py = 13.5;
        const a = deg(15);
        const bob = B.ball(d.x + d.L * Math.sin(a), py - d.L * Math.cos(a), 0.15, d.mat, { name: d.name, trail: true, record: true });
        B.rope(null, { x: d.x, y: py }, bob, { x: bob.x, y: bob.y }, { length: d.L, name: 'String' });
        const t = B.timer(d.x + 0.4, py - d.L - 1.7, d.name, {});
        B.gate(d.x, py - d.L - 0.5, d.x, py - d.L + 0.4, { mode: 'center', timerId: t.id, action: 'lap', filterBody: bob.id, name: 'Bottom gate' });
      }
      B.label(-1, 3, 'Each lap = half a period · T = 2π√(L/g)', { size: 0.3, color: '#94a3b8' });
    },
  },
  {
    id: 'cradle',
    name: "Newton's cradle",
    category: 'Collisions',
    description: 'Five steel balls hang side by side on strings. Momentum and energy are passed through the chain in (nearly) elastic collisions.',
    goals: ['Lift a ball with the Grab tool while running', 'Try pulling two balls', 'Lower restitution in the Inspector to see energy loss'],
    build(B) {
      B.room({ ceiling: true, top: 12 });
      B.wall(0, 11, 6, 0.3, 'steel', { name: 'Frame' });
      const r = 0.35;
      const L = 5;
      const mat = { density: 7850, staticFriction: 0, friction: 0, restitution: 1 };
      for (let i = 0; i < 5; i++) {
        const x = (i - 2) * (2 * r + 0.03); // small gaps make the collisions sequential
        let bx = x;
        let by = 10.85 - L;
        if (i === 0) {
          const a = deg(-40);
          bx = x + L * Math.sin(a);
          by = 10.85 - L * Math.cos(a);
        }
        const ball = B.ball(bx, by, r, 'steel', { material: mat, name: 'Ball ' + (i + 1), trail: i === 0 || i === 4 });
        B.rope(null, { x: x - 0.4, y: 10.85 }, ball, { x: bx, y: by }, { length: Math.hypot(0.4, L) });
        B.rope(null, { x: x + 0.4, y: 10.85 }, ball, { x: bx, y: by }, { length: Math.hypot(0.4, L) });
      }
      B.label(0, 3.2, 'Two strings per ball keep the motion in the plane', { size: 0.26, color: '#94a3b8' });
    },
  },
  {
    id: 'airtrack',
    name: 'Collisions on an air track',
    category: 'Collisions',
    description: 'Gliders on frictionless tracks. Top: elastic, equal masses (velocities swap). Middle: perfectly inelastic (they move together). Bottom: elastic, 1 kg hits 3 kg. Gates show speeds.',
    goals: ['Momentum p = m·v is conserved in every lane', 'Kinetic energy is conserved only for e = 1', 'Select a glider to read its velocity & momentum'],
    build(B) {
      B.room({ left: -12, right: 12 });
      const lanes = [
        { y: 9.5, ma: 1, mb: 1, va: 2, e: 1, name: 'Elastic, m₁ = m₂' },
        { y: 5.5, ma: 2, mb: 1, va: 2, e: 0, name: 'Inelastic, 2 kg → 1 kg' },
        { y: 1.5, ma: 1, mb: 3, va: 3, e: 1, name: 'Elastic, 1 kg → 3 kg' },
      ];
      for (const l of lanes) {
        const mat = { staticFriction: 0, friction: 0, restitution: l.e, density: 1000 };
        B.wall(0, l.y - 0.1, 24, 0.2, 'teflon', { material: { ...mat }, name: 'Air track' });
        const a = B.box(-8, l.y + 0.2, 0.8, 0.4, 'aluminum', { material: { ...mat }, mass: l.ma, vx: l.va, name: l.ma + ' kg glider', color: '#38bdf8', record: true });
        const b = B.box(-1, l.y + 0.2, l.mb === 3 ? 1.2 : 0.8, 0.4, 'aluminum', { material: { ...mat }, mass: l.mb, name: l.mb + ' kg glider', color: '#f472b6', record: true });
        void a;
        void b;
        B.gate(-4.5, l.y + 0.05, -4.5, l.y + 0.9, { mode: 'center', action: 'none', name: 'Gate A' });
        B.gate(4, l.y + 0.05, 4, l.y + 0.9, { mode: 'center', action: 'none', name: 'Gate B' });
        B.label(0, l.y + 1.6, l.name, { size: 0.3 });
      }
    },
  },
  {
    id: 'springs',
    name: 'Springs & oscillators',
    category: 'Oscillations',
    description: 'A vertical mass on a spring, a horizontal oscillator on a frictionless shelf and three coupled oscillators that trade energy back and forth.',
    goals: ['T = 2π√(m/k): 1 kg on 30 N/m → 1.15 s', 'Watch the coupled masses exchange energy (beats)', 'Open Data → Energy to see KE ↔ elastic PE'],
    build(B) {
      // vertical
      const m1 = B.box(-8, 7.6, 0.6, 0.6, 'steel', { mass: 1, name: '1 kg mass', fixedRotation: true, record: true });
      B.wall(-8, 11.2, 2, 0.3, 'steel', { name: 'Support' });
      B.spring(null, { x: -8, y: 11.05 }, m1, { x: -8, y: 7.9 }, 30, 2, { name: 'k = 30 N/m' });
      const t = B.timer(-5.6, 11, 'Vertical spring', {});
      B.gate(-9, 11.05 - 2 - 0.327 - 0.3, -7, 11.05 - 2 - 0.327 - 0.3, { mode: 'center', timerId: t.id, action: 'lap', filterBody: m1.id, name: 'Equilibrium' });
      B.label(-8, 12, 'Vertical: equilibrium stretch mg/k = 0.33 m', { size: 0.22, color: '#94a3b8' });
      // horizontal
      const ice = { staticFriction: 0, friction: 0, restitution: 0.1, density: 900 };
      B.wall(2.5, 2.9, 9, 0.2, 'ice', { material: ice, name: 'Frictionless shelf' });
      B.wall(-2.1, 3.5, 0.2, 1.4, 'concrete', { name: 'Wall' });
      const m2 = B.box(1, 3.3, 0.6, 0.6, 'steel', { material: { ...ice, density: 7850 }, mass: 2, name: '2 kg mass', record: true });
      B.spring(null, { x: -2, y: 3.3 }, m2, { x: 0.7, y: 3.3 }, 20, 2, { name: 'k = 20 N/m' });
      B.label(2.5, 4.6, 'Horizontal: T = 2π√(2/20) ≈ 1.99 s', { size: 0.24, color: '#94a3b8' });
      // coupled
      B.wall(2.5, 7.4, 17, 0.2, 'ice', { material: ice, name: 'Frictionless shelf' });
      B.wall(-6.1, 8.1, 0.2, 1.2, 'concrete');
      B.wall(11.1, 8.1, 0.2, 1.2, 'concrete');
      const xs = [-2, 2.5, 7];
      const ms = xs.map((x, i) => B.box(x + (i === 0 ? -0.9 : 0), 7.8, 0.6, 0.6, 'steel', { material: { ...ice, density: 7850 }, mass: 1, name: 'Mass ' + (i + 1), color: ['#38bdf8', '#a78bfa', '#f472b6'][i], record: true }));
      const anchors = [{ x: -6, y: 7.8 }, ...ms.map((m) => m), { x: 11, y: 7.8 }];
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i];
        const b = anchors[i + 1];
        const pa = a.shapes ? { x: a.x + 0.3, y: 7.8 } : a;
        const pb = b.shapes ? { x: b.x - 0.3, y: 7.8 } : b;
        B.spring(a.shapes ? a : null, pa, b.shapes ? b : null, pb, 25, 3.9, { name: 'k = 25 N/m', coils: 10 });
      }
      B.label(2.5, 9.4, 'Coupled oscillators — energy moves between the masses', { size: 0.26, color: '#94a3b8' });
    },
  },
  {
    id: 'buoyancy',
    name: 'Buoyancy & density',
    category: 'Fluids',
    description: 'Left: objects of different density dropped into water. Right: a layered tank with olive oil floating on water — ice and plastic settle at the interface.',
    goals: ['Floats if ρ_object < ρ_liquid; submerged fraction = ρ_object/ρ_liquid', 'Wood (700) floats 70% submerged in water', 'Try the Pool tool and change the liquid density'],
    build(B) {
      B.pool(-11.9, -0.9, 0, 3.2, 'water', { name: 'Water tank' });
      B.wall(-0.8, 1.9, 0.2, 3.8, 'glass', { name: 'Glass wall' });
      const left = [
        ['cork', -10.6], ['wood', -9.2], ['ice', -7.8], ['plastic', -6.4], ['rubber', -5], ['aluminum', -3.6], ['steel', -2.2],
      ];
      for (const [m, x] of left) {
        B.box(x, 5 + Math.random() * 0.4, 0.6, 0.6, m, { name: m[0].toUpperCase() + m.slice(1) });
        B.label(x, 7.2 - (x % 2 === 0 ? 0 : 0), m[0].toUpperCase() + m.slice(1), { size: 0.22, color: '#94a3b8' });
      }
      B.pool(-0.6, 11.9, 0, 2, 'water', { name: 'Water layer' });
      B.pool(-0.6, 11.9, 2, 3.2, 'oil', { name: 'Oil layer', waves: false });
      const right = [['wood', 1], ['ice', 3], ['plastic', 5], ['rubber', 7], ['cork', 9]];
      for (const [m, x] of right) {
        B.ball(x, 5 + Math.random() * 0.3, 0.3, m, { name: m[0].toUpperCase() + m.slice(1) });
        B.label(x, 7.2, m[0].toUpperCase() + m.slice(1), { size: 0.22, color: '#94a3b8' });
      }
      B.label(-6.4, 8.4, 'Water ρ = 1000 kg/m³', { size: 0.3 });
      B.label(5.6, 8.4, 'Oil (910) over water (1000)', { size: 0.3 });
    },
  },
  {
    id: 'atwood',
    name: 'Atwood machine & pulleys',
    category: 'Mechanics',
    description: 'Left: an Atwood machine with 2.0 kg and 1.5 kg masses. Right: a block on a table pulled by a hanging mass over a pulley. Photogates time the motion.',
    goals: ['Atwood: a = g(m₁ − m₂)/(m₁ + m₂) = 1.40 m/s²', 'Gate-to-gate time (3 m) ≈ 1.20 s', 'Table: a = g(m₂ − μ m₁)/(m₁ + m₂) ≈ 3.08 m/s²', 'Air is off here so results match the ideal formulas'],
    settings: { airDensity: 0, airViscosity: 0 },
    build(B) {
      const a = B.box(-7, 7.5, 0.6, 0.6, 'steel', { mass: 2, name: '2.0 kg', showLabel: true, record: true });
      const b = B.box(-5, 5, 0.6, 0.6, 'aluminum', { mass: 1.5, name: '1.5 kg', showLabel: true });
      B.wall(-6, 12.6, 3, 0.2, 'steel', { name: 'Beam' });
      B.pulley(a, { x: -7, y: 7.8 }, b, { x: -5, y: 5.3 }, { x: -7, y: 12 }, { x: -5, y: 12 }, { name: 'Pulley', wheelRadius: 1 });
      const t = B.timer(-9.6, 10, 'Atwood', {});
      B.gate(-7.8, 6.5, -6.2, 6.5, { timerId: t.id, action: 'start', mode: 'center', filterBody: a.id, name: 'Gate 1 (y = 6.5)' });
      B.gate(-7.8, 3.5, -6.2, 3.5, { timerId: t.id, action: 'stop', mode: 'center', filterBody: a.id, name: 'Gate 2 (y = 3.5)' });
      // table
      const mu = { staticFriction: 0.25, friction: 0.2, restitution: 0, density: 700 };
      B.wall(5.5, 5.8, 7, 0.4, 'wood', { material: { ...mu }, name: 'Table' });
      B.wall(2.4, 2.8, 0.3, 5.6, 'wood', { name: 'Leg' });
      B.wall(8.6, 2.8, 0.3, 5.6, 'wood', { name: 'Leg' });
      B.wall(8.35, 6.25, 0.2, 0.5, 'rubber', { name: 'Stopper' });
      const blk = B.box(3.5, 6.31, 0.8, 0.6, 'wood', { material: { ...mu }, mass: 2, name: '2 kg block', showLabel: true, record: true });
      const hang = B.box(9.4, 4.5, 0.5, 0.5, 'steel', { mass: 1.5, name: '1.5 kg', showLabel: true });
      B.pulley(blk, { x: 3.9, y: 6.31 }, hang, { x: 9.4, y: 4.75 }, { x: 9.15, y: 6.31 }, { x: 9.4, y: 6.06 }, { name: 'Table pulley', wheelRadius: 0.25 });
      const t2 = B.timer(5.5, 9.5, 'Table', {});
      B.gate(4.6, 6.05, 4.6, 7, { timerId: t2.id, action: 'start', mode: 'center', filterBody: blk.id, name: 'Start' });
      B.gate(7.1, 6.05, 7.1, 7, { timerId: t2.id, action: 'stop', mode: 'center', filterBody: blk.id, name: 'Stop (2.5 m)' });
    },
  },
  {
    id: 'slingshot',
    name: 'Slingshot vs. tower',
    category: 'Collisions',
    description: 'Pull the stone back in the slingshot pouch and let go. The launch speed follows from the elastic energy ½ks² = ½mv². Knock down the tower!',
    goals: ['Drag from the pouch (Select or Grab tool) and release', 'v = s·√(k/m) — the dotted arc predicts the flight', 'Change band stiffness k in the Inspector'],
    build(B) {
      B.slingshot(-8.5, 2.2, { k: 260, projectile: { kind: 'circle', r: 0.18, material: 'stone' } });
      const bx = 6;
      for (let level = 0; level < 4; level++) {
        const y0 = level * 1.3;
        B.box(bx - 1, y0 + 0.55, 0.25, 1.1, 'wood');
        B.box(bx + 1, y0 + 0.55, 0.25, 1.1, 'wood');
        B.box(bx, y0 + 1.2, 2.6, 0.2, 'wood');
      }
      B.ball(bx, 5.6, 0.3, 'rubber', { name: 'Target', color: '#f43f5e' });
      B.box(bx + 3.5, 0.5, 1, 1, 'plastic', { name: 'Crate' });
      B.box(bx + 3.5, 1.5, 1, 1, 'plastic', { name: 'Crate' });
      B.label(-8.5, 5, 'Pull the pouch back ↙ and release', { size: 0.3 });
    },
  },
  {
    id: 'dominoes',
    name: 'Domino chain reaction',
    category: 'Collisions',
    description: 'Thirty dominoes topple in sequence. A photogate near the first domino starts the chronometer and one near the last stops it, giving the wave speed of the chain.',
    goals: ['Press Play — the first domino is already tipping', 'Speed = distance / time (ruler shows 15.95 m)', 'Try spacing the dominoes differently'],
    build(B) {
      const n = 30;
      const sp = 0.55;
      const x0 = -9;
      let first = null;
      let last = null;
      for (let i = 0; i < n; i++) {
        const d = B.box(x0 + i * sp, 0.5, 0.12, 1, 'wood', { name: 'Domino ' + (i + 1), color: i % 2 ? '#e2e8f0' : '#cbd5e1' });
        if (i === 0) {
          d.w = -2.2;
          first = d;
        }
        last = d;
      }
      const t = B.timer(0, 4, 'Chain', {});
      B.gate(x0 + 0.25, 0.7, x0 + 0.25, 1.2, { timerId: t.id, action: 'start', filterBody: first.id, name: 'First domino' });
      B.gate(last.x + 0.25, 0.7, last.x + 0.25, 1.2, { timerId: t.id, action: 'stop', filterBody: last.id, name: 'Last domino' });
      B.ruler(x0, 1.6, last.x, 1.6, { name: 'Chain length' });
    },
  },
  {
    id: 'waves',
    name: 'Waves on strings',
    category: 'Waves',
    description: 'Top: a driven string at its 2nd harmonic forms a standing wave. Middle: a single pulse reflects from a free end. Bottom: a travelling wave is absorbed at the far end.',
    goals: ['Wave speed v = √(T/μ) = 31.6 m/s', 'Harmonics: fₙ = n·v / 2L (select a string to see them)', 'Fixed ends invert reflected pulses, free ends do not'],
    build(B) {
      B.waveString(-10, 11, 10, 11, { tension: 40, density: 0.04, damping: 0.15, nodes: 220, endB: 'fixed', driver: { type: 'sine', frequency: 1.581, amplitude: 0.06 }, name: 'Standing wave (n = 2)', color: '#f472b6' });
      const p = B.waveString(-10, 7, 10, 7, { tension: 40, density: 0.04, damping: 0.02, nodes: 220, endB: 'free', driver: { type: 'pulse', frequency: 3, amplitude: 0.8 }, name: 'Pulse, free end', color: '#38bdf8' });
      p.pulseStart = 0.1;
      B.waveString(-10, 3, 10, 3, { tension: 40, density: 0.04, damping: 0.02, nodes: 220, endB: 'absorb', driver: { type: 'sine', frequency: 3, amplitude: 0.35 }, name: 'Travelling wave, absorbing end', color: '#facc15' });
      B.label(0, 12.6, 'Standing wave — fixed end, driven at f₂ = 1.58 Hz', { size: 0.3 });
      B.label(0, 8.8, 'Single pulse — free end (Inspector: "Send pulse")', { size: 0.3 });
      B.label(0, 4.8, 'Travelling wave — absorbing end, λ = v / f ≈ 10.5 m', { size: 0.3 });
    },
  },
  {
    id: 'wavetank',
    name: 'Wave tank & boats',
    category: 'Waves',
    description: 'A paddle at the left generates surface waves (speed √(g·depth)); an absorbing beach at the right damps them. Boats, a buoy and a sealed tank half-filled with water ride the swell.',
    goals: ['Select the pool to change amplitude & frequency', 'Hull mode: a boat displaces its whole outline', 'The sealed tank carries internal liquid'],
    build(B) {
      B.pool(-12, 12, 0, 3.5, 'water', { name: 'Wave tank', generator: { on: true, amplitude: 0.25, frequency: 0.6, side: 'left' }, beach: 'absorb' });
      B.body({ kind: 'boat', w: 2.2, h: 0.6, t: 0.08 }, -5, 4.1, { materialKey: 'wood', hull: true, name: 'Boat', design: true });
      B.body({ kind: 'boat', w: 1.4, h: 0.45, t: 0.06 }, 1, 4.1, { materialKey: 'aluminum', hull: true, name: 'Dinghy', design: true });
      B.ball(4.5, 4.2, 0.3, 'cork', { name: 'Buoy', color: '#f97316' });
      B.body({ kind: 'tank', w: 1, h: 1, t: 0.05 }, 7.5, 4.6, { materialKey: 'plastic', hull: true, name: 'Sealed tank', innerLiquid: { liquid: 'water', density: 1000, fraction: 0.4 } });
      B.box(-9, 4, 1.8, 0.35, 'wood', { name: 'Log' });
      B.label(0, 7.5, 'Wave tank — paddle on the left, absorbing beach on the right', { size: 0.3 });
    },
  },
  {
    id: 'pour',
    name: 'Pouring liquid & a seesaw',
    category: 'Fluids',
    description: 'A faucet fills a cup sitting on a seesaw. As the cup gets heavier the balance tips. Particle liquid flows, splashes and is collected by a drain.',
    goals: ['Liquid mass adds up particle by particle', 'Try honey or mercury in the faucet settings', 'Use the Pour tool to paint liquid'],
    build(B) {
      B.room({ left: -10, right: 10 });
      const plank = B.box(0, 2.6, 7, 0.2, 'wood', { name: 'Seesaw plank' });
      B.wedge(0, 1.25, 1, 2.5, 'stone', { type: 'static', name: 'Fulcrum' });
      B.pin(plank, 0, 2.6, { name: 'Pivot', enableLimit: true, lowerAngle: -deg(12), upperAngle: deg(12) });
      const cup = B.container(-2.5, 3.36, 1.6, 1.3, 0.08, 'glass', { name: 'Cup' });
      B.weld(plank, cup, -2.5, 2.75, { name: 'Glue' });
      const cw = B.box(2.6, 3.1, 0.8, 0.8, 'steel', { name: 'Counterweight', showLabel: true });
      cw.setMass(140);
      B.weld(plank, cw, 2.6, 2.75, { name: 'Glue' });
      B.faucet(-2.5, 9.5, { rate: 70, speed: 1.5, width: 0.25, liquid: 'water', limit: 520, name: 'Faucet' });
      B.drain(8, 0.25, 3, 0.5, { name: 'Drain' });
      B.label(0, 11.5, 'The cup gets heavier as it fills — watch the seesaw tip', { size: 0.3 });
    },
  },
  {
    id: 'viscosity',
    name: 'Viscosity race',
    category: 'Fluids',
    description: 'Identical steel balls fall through water, olive oil and honey. Photogates measure how long each takes to fall 6 m — viscous drag sets a much lower terminal speed in honey.',
    goals: ['Viscous drag grows with viscosity μ', 'Terminal velocity: weight − buoyancy = drag', 'Change a pool to lava or slime'],
    build(B) {
      const lanes = [
        { x0: -11.8, x1: -4.2, liquid: 'water', name: 'Water' },
        { x0: -3.8, x1: 3.8, liquid: 'oil', name: 'Olive oil' },
        { x0: 4.2, x1: 11.8, liquid: 'honey', name: 'Honey' },
      ];
      for (const l of lanes) {
        B.pool(l.x0, l.x1, 0, 8.5, l.liquid, { name: l.name, waves: false });
        const cx = (l.x0 + l.x1) / 2;
        if (l.x1 < 11) B.wall(l.x1 + 0.2, 4.6, 0.2, 9.2, 'glass', { name: 'Glass' });
        const ball = B.ball(cx, 9.6, 0.2, 'steel', { name: 'Ball in ' + l.name.toLowerCase(), trail: true, record: true });
        const t = B.timer(cx, 12.2, l.name, {});
        B.gate(cx - 1.5, 7, cx + 1.5, 7, { timerId: t.id, action: 'start', mode: 'center', filterBody: ball.id, name: 'Top gate' });
        B.gate(cx - 1.5, 1, cx + 1.5, 1, { timerId: t.id, action: 'stop', mode: 'center', filterBody: ball.id, name: 'Bottom gate' });
        B.label(cx, 11.1, l.name, { size: 0.3 });
      }
    },
  },
  {
    id: 'terminal',
    name: 'Air resistance & terminal velocity',
    category: 'Mechanics',
    description: 'A tall drop shaft: a steel ball, a foam ball, a foam sheet and a high-drag "parachute" fall from 38 m. Graph their speeds in the Data panel to see each approach its terminal velocity.',
    goals: ['v_t = √(2mg / (ρ C_d A))', 'Data → plot |v| for the recorded bodies', 'Gates time the lower 15 m'],
    camera: { cx: 0, cy: 20, width: 34 },
    build(B) {
      B.room({ top: 40, left: -8, right: 8 });
      const defs = [
        { x: -5.5, make: (x) => B.ball(x, 38, 0.25, 'steel', { name: 'Steel ball', record: true, trail: true }) },
        { x: -2, make: (x) => B.ball(x, 38, 0.25, 'foam', { name: 'Foam ball', record: true, trail: true }) },
        { x: 1.6, make: (x) => B.box(x, 38, 1, 0.05, 'foam', { name: 'Foam sheet', record: true, trail: true }) },
        { x: 5.2, make: (x) => B.box(x, 38, 1.4, 0.1, 'plastic', { name: 'Parachute', dragCoef: 2.2, record: true, trail: true, fixedRotation: true }) },
      ];
      for (const d of defs) {
        const b = d.make(d.x);
        const t = B.timer(d.x, 39.4, b.name, {});
        B.gate(d.x - 1.4, 16, d.x + 1.4, 16, { timerId: t.id, action: 'start', filterBody: b.id, name: 'Gate 16 m' });
        B.gate(d.x - 1.4, 1, d.x + 1.4, 1, { timerId: t.id, action: 'stop', filterBody: b.id, name: 'Gate 1 m' });
      }
    },
  },
  {
    id: 'orbits',
    name: 'Orbits & gravity wells',
    category: 'Gravity',
    description: 'Gravity is switched off; a central attractor pulls with F = mμ/r². Satellites at the circular-orbit speed √(μ/r) circle forever, slower ones fall into ellipses.',
    goals: ['Circular orbit: v = √(μ/r)', "Kepler: T² ∝ r³", 'Add more attractors with the Attractor tool'],
    camera: { cx: 0, cy: 7, width: 34 },
    settings: { gravity: { x: 0, y: 0 }, airDensity: 0, airViscosity: 0, sleeping: false },
    build(B) {
      B.room({ floor: false, left_wall: false, right_wall: false, ceiling: false, left: -20, right: 20, bottom: -12, top: 26 });
      const mu = 80;
      B.attractor(0, 7, mu, { radius: 0.2, name: 'Planet' });
      B.ball(0, 7, 0.8, 'stone', { type: 'static', name: 'Planet', color: '#3b82f6' });
      const sat = (r, f, color, name) => B.ball(r, 7, 0.15, 'aluminum', { vy: Math.sqrt(mu / r) * f, trail: true, color, name });
      sat(3, 1, '#facc15', 'Circular r = 3');
      sat(5.5, 1, '#4ade80', 'Circular r = 5.5');
      sat(8, 0.75, '#f472b6', 'Elliptical');
      B.ball(-10, 7, 0.12, 'aluminum', { vy: -Math.sqrt(mu / 10) * 1.05, trail: true, color: '#38bdf8', name: 'Outer' });
    },
  },
  {
    id: 'machines',
    name: 'Conveyors & moving platforms',
    category: 'Mechanics',
    description: 'Conveyor belts carry crates using friction, an elevator platform moves up and down, a motorised wheel spins and a kinematic paddle sweeps.',
    goals: ['Select a belt to change its speed', 'Friction accelerates crates to belt speed', 'Kinematic bodies follow prescribed motion'],
    build(B) {
      B.wall(-6, 3, 9, 0.3, 'rubber', { surfaceSpeed: 2.5, name: 'Conveyor →', color: '#334155' });
      B.wall(4.5, 6, 9, 0.3, 'rubber', { surfaceSpeed: -2, name: '← Conveyor', color: '#334155' });
      B.box(-9.5, 3.6, 0.7, 0.7, 'wood', { name: 'Crate' });
      B.box(-8.3, 3.6, 0.7, 0.7, 'plastic', { name: 'Crate' });
      B.box(7.5, 6.6, 0.7, 0.7, 'wood', { name: 'Crate' });
      B.box(6.3, 6.6, 0.6, 0.6, 'ice', { name: 'Ice block' });
      const lift = B.box(10, 2, 2.4, 0.25, 'steel', { type: 'kinematic', name: 'Elevator', motion: { type: 'oscillate', direction: 90, amplitude: 1.8, period: 6, phase: 0 } });
      void lift;
      const wheel = B.body({ kind: 'ngon', n: 6, r: 1.1 }, -4, 9, { materialKey: 'steel', name: 'Motor wheel' });
      B.pin(wheel, -4, 9, { enableMotor: true, motorSpeed: -1.2, maxMotorTorque: 5000, name: 'Motor' });
      B.box(-0.5, 0.6, 3, 0.25, 'steel', { type: 'kinematic', name: 'Sweeper', motion: { type: 'swing', amplitude: 35, period: 4 } });
      for (let i = 0; i < 6; i++) B.ball(-4.8 + i * 0.32, 11.2 + (i % 2) * 0.4, 0.15, 'rubber', { name: 'Ball' });
    },
  },
  {
    id: 'skatepark',
    name: 'Energy skate park',
    category: 'Mechanics',
    description: 'A ball rolls back and forth in a half-pipe. Kinetic and potential energy trade places while the total stays (nearly) constant. Add friction to see energy dissipate.',
    goals: ['Data → Energy shows KE, PE and total', 'Release height = return height (no losses)', 'Rolling: part of the KE is rotational'],
    build(B) {
      const pts = [];
      for (let i = 0; i <= 60; i++) {
        const x = -10 + (20 * i) / 60;
        pts.push({ x, y: 1 + 9 * Math.pow(Math.abs(x) / 10, 2) });
      }
      B.track(pts, { material: 'rubber', name: 'Half-pipe', thickness: 0.25 });
      const p = onPolyline(pts, 3, 0.3);
      B.ball(p.x, p.y + 0.01, 0.3, 'rubber', { material: { density: 1100, staticFriction: 1, friction: 0.9, restitution: 0 }, name: 'Skater', trail: true, record: true, color: '#facc15' });
      B.ruler(-9.3, 7.8, 9.3, 7.8, { name: 'Release height' });
    },
  },
  {
    id: 'ballistic',
    name: 'Ballistic pendulum',
    category: 'Collisions',
    description: 'A 2 kg lead ball hits a hanging 8 kg sand bag. Measuring how high the bag swings gives the ball speed: v = (m+M)/m · √(2gh).',
    goals: ['Perfectly inelastic collision conserves momentum, not energy', 'Expected rise ≈ 0.8 m for v = 20 m/s', 'Change the cannon speed and compare'],
    build(B) {
      B.room({ ceiling: true, top: 12 });
      const bag = B.box(4, 6, 1, 1, 'foam', { material: { density: 800, staticFriction: 0.8, friction: 0.8, restitution: 0 }, name: 'Sand bag', record: true, trail: true, color: '#a16207' });
      bag.setMass(8);
      B.rope(null, { x: 3.6, y: 11.9 }, bag, { x: 3.6, y: 6.5 });
      B.rope(null, { x: 4.4, y: 11.9 }, bag, { x: 4.4, y: 6.5 });
      // aim so the ideal trajectory hits the middle of the bag's face
      const gun = { x: -6, y: 5.4, v: 20, barrel: 0.9 };
      const target = { x: 3.5, y: 6 };
      let lo = -0.3;
      let hi = 0.6;
      for (let i = 0; i < 60; i++) {
        const th = (lo + hi) / 2;
        const mx = gun.x + Math.cos(th) * gun.barrel;
        const my = gun.y + Math.sin(th) * gun.barrel;
        const t = (target.x - mx) / (gun.v * Math.cos(th));
        const y = my + gun.v * Math.sin(th) * t - 0.5 * 9.81 * t * t;
        if (y < target.y) lo = th;
        else hi = th;
      }
      B.cannon(gun.x, gun.y, (((lo + hi) / 2) * 180) / Math.PI, gun.v, { name: 'Gun', barrel: gun.barrel, projectile: { r: 0.1, material: 'lead', mass: 2, restitution: 0, dragCoef: 0 }, fireOnStart: true });
      B.ruler(6, 5.5, 6, 6.3, { name: 'Rise' });
      B.label(0, 9, 'Bag and ball move together right after impact', { size: 0.28, color: '#94a3b8' });
    },
  },
  {
    id: 'torque',
    name: 'Levers & torque',
    category: 'Mechanics',
    description: 'Two seesaws: the left one balances 2 kg at 1 m against 1 kg at 2 m (equal torques). The right one is unbalanced and tips.',
    goals: ['Equilibrium: Σ τ = Σ r × F = 0', 'Move masses with the Select tool (paused) and replay', 'Read the pivot reaction force in the Inspector'],
    build(B) {
      for (const [cx, rb] of [[-5.5, 2], [5.5, 2.6]]) {
        const plank = B.box(cx, 3, 6, 0.15, 'wood', { name: 'Lever' });
        plank.setMass(1);
        B.wedge(cx, 1.46, 0.8, 2.9, 'stone', { type: 'static', name: 'Fulcrum' });
        B.pin(plank, cx, 3, { name: 'Pivot', enableLimit: true, lowerAngle: -deg(15), upperAngle: deg(15) });
        B.box(cx - 1, 3.33, 0.5, 0.5, 'steel', { mass: 2, name: '2 kg', showLabel: true, material: { staticFriction: 1, friction: 1, restitution: 0, density: 8000 } });
        B.box(cx + rb, 3.33, 0.5, 0.5, 'aluminum', { mass: 1, name: '1 kg', showLabel: true, material: { staticFriction: 1, friction: 1, restitution: 0, density: 2700 } });
        B.label(cx, 6, rb === 2 ? '2 kg × 1 m = 1 kg × 2 m' : '2 kg × 1 m < 1 kg × 2.6 m', { size: 0.3 });
      }
    },
  },
  {
    id: 'playground',
    name: 'Wrecking ball playground',
    category: 'Sandbox',
    description: 'A wrecking ball on a chain swings into a tower of crates, a ramp launches a ball over a gap and a seesaw catapult waits for a falling weight.',
    goals: ['Grab things while the simulation runs', 'Cut the chain with the Scissors tool', 'Change gravity mid-flight'],
    build(B) {
      // wrecking ball on a chain of hinged links, raised 50° to the left
      const hook = { x: -2.5, y: 12.8 };
      B.wall(hook.x, hook.y + 0.2, 1.2, 0.3, 'steel', { name: 'Hook' });
      const a0 = deg(50);
      const dx = -Math.sin(a0);
      const dy = -Math.cos(a0);
      const seg = 0.6;
      const n = 16;
      let prev = null;
      for (let i = 0; i < n; i++) {
        const cx = hook.x + dx * seg * (i + 0.5);
        const cy = hook.y + dy * seg * (i + 0.5);
        const link = B.box(cx, cy, seg + 0.04, 0.1, 'steel', { angle: Math.atan2(dy, dx), name: 'Chain link', color: '#64748b' });
        B.hinge(prev, link, hook.x + dx * seg * i, hook.y + dy * seg * i);
        prev = link;
      }
      const end = { x: hook.x + dx * seg * n, y: hook.y + dy * seg * n };
      const wb = B.ball(end.x + dx * 0.55, end.y + dy * 0.55, 0.55, 'steel', { name: 'Wrecking ball', trail: true });
      B.hinge(prev, wb, end.x, end.y);
      for (let row = 0; row < 5; row++) for (let c = 0; c < 2; c++) B.box(-1.2 + c * 0.82, 0.4 + row * 0.8, 0.8, 0.8, 'wood', { name: 'Crate' });
      // catapult seesaw
      const arm = B.box(7, 1.3, 5, 0.18, 'wood', { name: 'Catapult arm' });
      arm.setMass(4);
      B.wedge(7, 0.6, 0.6, 1.2, 'stone', { type: 'static', name: 'Fulcrum' });
      B.pin(arm, 7, 1.3, { name: 'Pivot' });
      B.ball(4.9, 1.65, 0.22, 'rubber', { name: 'Payload', color: '#f43f5e', trail: true });
      B.box(9.1, 8, 0.8, 0.8, 'lead', { name: 'Drop weight' });
      B.label(4, 12.6, 'Grab, cut, throw — it is a playground', { size: 0.3, color: '#94a3b8' });
    },
  },
];

export const PRESET_CATEGORIES = ['Mechanics', 'Oscillations', 'Collisions', 'Fluids', 'Waves', 'Gravity', 'Sandbox'];

export function buildPreset(id) {
  const p = PRESETS.find((q) => q.id === id) || PRESETS[0];
  const world = new World(p.settings ? JSON.parse(JSON.stringify(p.settings)) : undefined);
  const B = new Builder(world);
  p.build(B, world);
  world.meta = { name: p.name, description: p.description, goals: p.goals || [], camera: p.camera || null, preset: p.id };
  for (const b of world.bodies) b.syncShapes();
  return world;
}
