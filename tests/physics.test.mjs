// Headless validation of the physics engine against analytic results.
import { World } from '../js/engine/world.js';
import { Body } from '../js/engine/body.js';

let failures = 0;
function check(name, got, want, tol) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(4)}, want ${want.toFixed(4)} ±${tol}`);
}
function run(world, seconds) {
  const n = Math.round(seconds * world.settings.stepRate);
  for (let i = 0; i < n; i++) world.step();
}
const vacuum = { airDensity: 0, airViscosity: 0 };

// 1. Free fall timed by a photogate (timer auto-starts at release)
{
  const w = new World(vacuum);
  const b = w.createBody({ geom: { kind: 'circle', r: 0.1 }, x: 0, y: 5, materialKey: 'steel' });
  const t = w.addTimer({ autoStart: true });
  w.addGate({ x1: -1, y1: 1, x2: 1, y2: 1, mode: 'center', timerId: t.id, action: 'stop' });
  run(w, 2);
  check('free fall 4 m (gate timer)', t.value(w.time), Math.sqrt(8 / 9.81), 0.002);
  void b;
}
// 1b. edge-mode gate: leading edge breaks beam earlier by radius
{
  const w = new World(vacuum);
  w.createBody({ geom: { kind: 'circle', r: 0.1 }, x: 0, y: 5, materialKey: 'steel' });
  const t = w.addTimer({ autoStart: true });
  w.addGate({ x1: -1, y1: 1, x2: 1, y2: 1, mode: 'edge', timerId: t.id, action: 'stop' });
  run(w, 2);
  check('free fall edge gate (3.9 m)', t.value(w.time), Math.sqrt(2 * 3.9 / 9.81), 0.002);
}
// 2. Block sliding on a 30 degree slope with kinetic friction 0.2
{
  const w = new World(vacuum);
  const ang = 30 * Math.PI / 180;
  const L = 12;
  w.createBody({ type: 'static', geom: { kind: 'box', w: L, h: 0.4 }, x: 0, y: 4, angle: -ang, material: { staticFriction: 0.2, friction: 0.2 } });
  const blk = w.createBody({ geom: { kind: 'box', w: 0.5, h: 0.3 }, angle: -ang, materialKey: 'wood', material: { staticFriction: 0.2, friction: 0.2, restitution: 0 } });
  // place on surface near the top
  const nx = Math.sin(ang), ny = Math.cos(ang);
  blk.x = -4 * Math.cos(ang) + nx * 0.35; blk.y = 4 + 4 * Math.sin(ang) + ny * 0.35; blk.updateTransform(); blk.syncShapes();
  run(w, 0.5);
  const v0 = Math.hypot(blk.vx, blk.vy);
  run(w, 1.0);
  const v1 = Math.hypot(blk.vx, blk.vy);
  check('slope acceleration g(sin-mu cos)', (v1 - v0) / 1.0, 9.81 * (Math.sin(ang) - 0.2 * Math.cos(ang)), 0.05);
}
// 2b. Static friction holds a block at 20 degrees when mu_s = 0.5
{
  const w = new World(vacuum);
  const ang = 20 * Math.PI / 180;
  w.createBody({ type: 'static', geom: { kind: 'box', w: 10, h: 0.4 }, x: 0, y: 4, angle: -ang, material: { staticFriction: 0.5, friction: 0.3 } });
  const blk = w.createBody({ geom: { kind: 'box', w: 0.5, h: 0.3 }, angle: -ang, material: { staticFriction: 0.5, friction: 0.3, restitution: 0 } });
  const nx = Math.sin(ang), ny = Math.cos(ang);
  blk.x = nx * 0.351; blk.y = 4 + ny * 0.351; blk.updateTransform(); blk.syncShapes();
  const x0 = blk.x;
  run(w, 3);
  check('static friction holds (displacement)', Math.abs(blk.x - x0), 0, 0.01);
}
// 3. Pendulum period (string, small amplitude)
{
  const w = new World(vacuum);
  const L = 2;
  const a0 = 5 * Math.PI / 180;
  const bob = w.createBody({ geom: { kind: 'circle', r: 0.05 }, x: L * Math.sin(a0), y: 8 - L * Math.cos(a0), materialKey: 'lead' });
  w.createJoint('distance', w.ground, bob, { mode: 'rope', localA: { x: 0, y: 8 }, localB: { x: 0, y: 0 }, length: L });
  let lastX = bob.x, crossings = [];
  for (let i = 0; i < 120 * 12; i++) {
    w.step();
    if (lastX > 0 && bob.x <= 0) crossings.push(w.time);
    lastX = bob.x;
  }
  const T = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  // finite amplitude correction: T0 (1 + a^2/16)
  check('pendulum period', T, 2 * Math.PI * Math.sqrt(L / 9.81) * (1 + a0 * a0 / 16), 0.01);
}
// 4. Spring oscillator period
{
  const w = new World({ ...vacuum, gravity: { x: 0, y: 0 } });
  const m = w.createBody({ geom: { kind: 'box', w: 0.3, h: 0.3 }, x: 1.5, y: 5 });
  m.setMass(2);
  w.createJoint('distance', w.ground, m, { mode: 'spring', localA: { x: 0, y: 5 }, localB: { x: 0, y: 0 }, length: 1, k: 50, c: 0 });
  let lastV = 0, turns = [];
  for (let i = 0; i < 120 * 10; i++) {
    w.step();
    if (lastV > 0 && m.vx <= 0) turns.push(w.time);
    lastV = m.vx;
  }
  const T = (turns[turns.length - 1] - turns[0]) / (turns.length - 1);
  check('spring period 2pi sqrt(m/k)', T, 2 * Math.PI * Math.sqrt(2 / 50), 0.01);
}
// 5. Bouncing ball restitution
{
  const w = new World(vacuum);
  const b = w.createBody({ geom: { kind: 'circle', r: 0.1 }, x: 0, y: 2.1, material: { restitution: 0.8 } });
  w.roomBodies.forEach((r) => (r.material.restitution = 0));
  let maxAfter = 0, bounced = false;
  for (let i = 0; i < 120 * 2; i++) {
    w.step();
    if (b.vy > 0) bounced = true;
    if (bounced) maxAfter = Math.max(maxAfter, b.y - 0.1);
  }
  check('bounce height e^2 h', maxAfter, 0.64 * 2.0, 0.04);
}
// 6. Stack stability
{
  const w = new World(vacuum);
  const boxes = [];
  for (let i = 0; i < 12; i++) boxes.push(w.createBody({ geom: { kind: 'box', w: 0.5, h: 0.5 }, x: 0, y: 0.25 + i * 0.5 }));
  run(w, 6);
  const top = boxes[boxes.length - 1];
  check('12-box stack top drift x', Math.abs(top.x), 0, 0.02);
  check('12-box stack top height', top.y, 0.25 + 11 * 0.5, 0.05);
  console.log('      stack asleep:', boxes.every((b) => !b.awake));
}
// 7. Buoyancy equilibrium of wood (700) in water (1000)
{
  const w = new World(vacuum);
  w.addPool({ x0: -3, x1: 3, bottom: 0, level: 2, waves: false });
  const b = w.createBody({ geom: { kind: 'box', w: 1, h: 0.4 }, x: 0, y: 2.5, materialKey: 'wood' });
  run(w, 10);
  const submergedDepth = 2 - (b.y - 0.2);
  check('floating depth fraction (wood)', submergedDepth / 0.4, 0.7, 0.03);
}
// 8. Atwood machine acceleration g (m1-m2)/(m1+m2)
{
  const w = new World(vacuum);
  const a = w.createBody({ geom: { kind: 'box', w: 0.3, h: 0.3 }, x: -1, y: 5 });
  const b = w.createBody({ geom: { kind: 'box', w: 0.3, h: 0.3 }, x: 1, y: 5 });
  a.setMass(2); b.setMass(1);
  w.createJoint('pulley', a, b, { groundA: { x: -1, y: 8 }, groundB: { x: 1, y: 8 } });
  run(w, 0.2);
  const v0 = a.vy; run(w, 0.5); const v1 = a.vy;
  check('Atwood acceleration', -(v1 - v0) / 0.5, 9.81 / 3, 0.03);
}
// 9. Elastic collision of equal masses swaps velocities (no gravity, no friction)
{
  const w = new World({ ...vacuum, gravity: { x: 0, y: 0 } });
  const a = w.createBody({ geom: { kind: 'circle', r: 0.2 }, x: -2, y: 5, vx: 3, material: { restitution: 1, friction: 0, staticFriction: 0 } });
  const b = w.createBody({ geom: { kind: 'circle', r: 0.2 }, x: 0, y: 5, material: { restitution: 1, friction: 0, staticFriction: 0 } });
  run(w, 1.5);
  check('elastic collision: A after', a.vx, 0, 0.05);
  check('elastic collision: B after', b.vx, 3, 0.05);
}
// 10. Terminal velocity with quadratic drag
{
  const w = new World({ airDensity: 1.225, airViscosity: 0 });
  w.settings.room.floor = false; w.rebuildRoom();
  const b = w.createBody({ geom: { kind: 'circle', r: 0.2 }, x: 0, y: 200, materialKey: 'foam' });
  run(w, 8);
  const vt = Math.sqrt((2 * b.mass * 9.81) / (1.225 * 0.47 * 0.4 * w.settings.depth));
  check('terminal velocity', -b.vy, vt, 0.05 * vt);
}
// 11. Particle fluid settles without exploding
{
  const w = new World(vacuum);
  w.settings.room.left = -1.5; w.settings.room.right = 1.5; w.rebuildRoom();
  const n = w.fluid.fillRect(-1.4, 0.05, 1.4, 1.6, 'water');
  run(w, 4);
  let maxV = 0, maxY = 0;
  for (let i = 0; i < w.fluid.count; i++) { maxV = Math.max(maxV, Math.hypot(w.fluid.vx[i], w.fluid.vy[i])); maxY = Math.max(maxY, w.fluid.y[i]); }
  console.log(`      fluid: ${n} particles -> ${w.fluid.count}, max speed ${maxV.toFixed(3)}, surface ~${maxY.toFixed(3)}`);
  check('fluid particles retained', w.fluid.count, n, 0);
  check('fluid settled (max speed)', maxV, 0, 0.6);
}
// 12. Wave string speed sqrt(T/mu)
{
  const w = new World(vacuum);
  const { WaveString } = await import('../js/engine/wavestring.js');
  const s = new WaveString({ x1: 0, y1: 5, x2: 10, y2: 5, nodes: 300, tension: 25, density: 0.04, damping: 0, endB: 'absorb', driver: { type: 'pulse', frequency: 4, amplitude: 0.2 } });
  w.waveStrings.push(s);
  s.sendPulse(0);
  let tPeak5 = null, tPeak8 = null;
  const i5 = Math.round(0.5 * 299), i8 = Math.round(0.8 * 299);
  let best5 = 0, best8 = 0;
  for (let i = 0; i < 120 * 2; i++) {
    w.step();
    if (s.u[i5] > best5) { best5 = s.u[i5]; tPeak5 = w.time; }
    if (s.u[i8] > best8) { best8 = s.u[i8]; tPeak8 = w.time; }
  }
  check('wave speed on string', 3 / (tPeak8 - tPeak5), Math.sqrt(25 / 0.04), 1.0);
}

// 13. Cannon range in vacuum, R = v^2 sin(2 theta) / g
{
  const w = new World(vacuum);
  const { Cannon, Slingshot } = await import('../js/engine/devices.js');
  const c = new Cannon({ x: -10, y: 3, angle: 40, speed: 10, projectile: { r: 0.05, material: 'steel' } });
  w.cannons.push(c);
  const shot = c.fire(w);
  const m = c.muzzle();
  let lastY = shot.y, landX = null;
  for (let i = 0; i < 120 * 3 && landX === null; i++) {
    w.step();
    if (shot.vy < 0 && lastY > m.y && shot.y <= m.y) landX = shot.x - (shot.y - m.y) / shot.vy * shot.vx;
    lastY = shot.y;
  }
  check('projectile range', landX - m.x, 100 * Math.sin(80 * Math.PI / 180) / 9.81, 0.01);
  // 14. Slingshot launch speed from elastic energy
  const w2 = new World({ ...vacuum, gravity: { x: 0, y: 0 } });
  const s = new Slingshot({ x: 0, y: 5, k: 200 });
  w2.slingshots.push(s);
  const stone = s.grab(w2, -1.5, 5);
  stone.setMass(0.5);
  w2.step();
  s.release(w2);
  for (let i = 0; i < 24; i++) w2.step();
  check('slingshot launch speed s*sqrt(k/m)', stone.vx, 1.5 * Math.sqrt(200 / 0.5), 0.15);
}
// 15. Conveyor belt carries a box up to belt speed
{
  const w = new World(vacuum);
  w.createBody({ type: 'static', geom: { kind: 'box', w: 10, h: 0.2 }, x: 0, y: 1, surfaceSpeed: 2, material: { friction: 0.8, staticFriction: 0.9 } });
  const box = w.createBody({ geom: { kind: 'box', w: 0.4, h: 0.4 }, x: -3, y: 1.31, material: { friction: 0.8, staticFriction: 0.9 } });
  run(w, 2);
  check('conveyor carries box at belt speed', box.vx, 2, 0.02);
}
// 16. Concave polygon: L shape decomposes, area exact, rests stably
{
  const w = new World(vacuum);
  const L = w.createBody({ geom: { kind: 'poly', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.3 }, { x: 0.3, y: 0.3 }, { x: 0.3, y: 1 }, { x: 0, y: 1 }] }, x: 0, y: 2 });
  check('L-shape area', L.area, 0.51, 1e-9);
  run(w, 4);
  check('L-shape at rest (speed)', Math.hypot(L.vx, L.vy), 0, 0.01);
}
// 17. Motorised wheel reaches motor speed
{
  const w = new World(vacuum);
  const wheel = w.createBody({ geom: { kind: 'circle', r: 0.4 }, x: 0, y: 5 });
  w.createJoint('revolute', w.ground, wheel, { localA: { x: 0, y: 5 }, localB: { x: 0, y: 0 }, enableMotor: true, motorSpeed: 3, maxMotorTorque: 500 });
  run(w, 1);
  check('motor angular speed', wheel.w, 3, 0.01);
}
// 18. Sealed tank with internal liquid: mass includes the liquid
{
  const w = new World(vacuum);
  const t = w.createBody({ geom: { kind: 'tank', w: 1, h: 1, t: 0.05 }, x: 0, y: 2, innerLiquid: { density: 1000, fraction: 0.5, liquid: 'water' } });
  check('tank liquid mass', t.liquidMass, 1000 * 0.9 * 0.9 * 0.5 * 0.1, 1e-6);
  run(w, 3);
  check('tank rests upright', Math.abs(t.angle), 0, 0.01);
}

// 19. Frictionless bead on a smooth (faceted) circular track conserves energy
{
  const w = new World(vacuum);
  const { Builder } = await import('../js/lab/builder.js');
  const B = new Builder(w);
  const pts = [];
  for (let i = 0; i <= 150; i++) { const a = -Math.PI / 2 - 1.3 + 2.6 * i / 150; pts.push({ x: 6 * Math.cos(a), y: 7 + 6 * Math.sin(a) }); }
  const fr = { staticFriction: 0, friction: 0, restitution: 0, density: 2000 };
  B.track(pts, { material: fr });
  const a0 = -Math.PI / 2 - 1.2;
  const bead = B.ball(5.8 * Math.cos(a0), 7 + 5.8 * Math.sin(a0), 0.2, 'teflon', { material: fr });
  const y0 = bead.y;
  let vmax = 0;
  for (let i = 0; i < 240; i++) { w.step(); vmax = Math.max(vmax, Math.hypot(bead.vx, bead.vy)); }
  const ideal = Math.sqrt(2 * 9.81 * (y0 - 1.2));
  check('bead on curved track keeps energy', vmax / ideal, 1, 0.01);
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
