// A stretched string carrying transverse waves, simulated with the 1D wave
// equation y_tt = (T/mu) y_xx - b y_t. Ends can be driven (sine / square /
// single pulse), fixed, free, or absorbing.

import { fieldUid } from './forces.js';

export class WaveString {
  constructor(o = {}) {
    this.id = fieldUid(o.id);
    this.name = o.name || 'Wave string';
    this.x1 = o.x1 ?? -3;
    this.y1 = o.y1 ?? 3;
    this.x2 = o.x2 ?? 3;
    this.y2 = o.y2 ?? 3;
    this.nodes = Math.max(16, Math.min(400, o.nodes ?? 160));
    this.tension = o.tension ?? 40; // N
    this.density = o.density ?? 0.05; // kg/m
    this.damping = o.damping ?? 0.05; // 1/s
    this.driver = Object.assign({ type: 'sine', frequency: 2, amplitude: 0.15 }, o.driver || {});
    this.endB = o.endB || 'fixed'; // fixed | free | absorb  (the far end)
    this.color = o.color || '#f472b6';
    this.showNodes = o.showNodes ?? false;
    this.u = new Float64Array(this.nodes);
    this.v = new Float64Array(this.nodes);
    this.pulseStart = null;
    this.time = 0;
  }

  get length() {
    return Math.hypot(this.x2 - this.x1, this.y2 - this.y1);
  }

  get speed() {
    return Math.sqrt(this.tension / Math.max(1e-6, this.density));
  }

  get wavelength() {
    return this.speed / Math.max(1e-6, this.driver.frequency);
  }

  // natural frequency of harmonic n for the current end conditions
  harmonic(n) {
    const L = this.length;
    const c = this.speed;
    if (this.endB === 'free') return ((2 * n - 1) * c) / (4 * L);
    return (n * c) / (2 * L);
  }

  resize() {
    this.nodes = Math.max(16, Math.min(400, Math.round(this.nodes)));
    this.u = new Float64Array(this.nodes);
    this.v = new Float64Array(this.nodes);
  }

  sendPulse(t) {
    this.pulseStart = t;
  }

  reset() {
    this.u.fill(0);
    this.v.fill(0);
    this.pulseStart = null;
  }

  driverValue(t) {
    const d = this.driver;
    const w = 2 * Math.PI * d.frequency;
    switch (d.type) {
      case 'sine': return d.amplitude * Math.sin(w * t);
      case 'square': return d.amplitude * (Math.sin(w * t) >= 0 ? 1 : -1) * Math.min(1, t * 20);
      case 'pulse': {
        if (this.pulseStart === null) return 0;
        const sigma = 0.25 / Math.max(0.1, d.frequency);
        const tt = t - this.pulseStart - 3 * sigma;
        return d.amplitude * Math.exp(-(tt * tt) / (sigma * sigma));
      }
      default: return 0;
    }
  }

  step(dt, worldTime) {
    const n = this.nodes;
    const L = this.length;
    if (L < 0.05) return;
    const dx = L / (n - 1);
    const c = this.speed;
    const sub = Math.max(1, Math.min(400, Math.ceil((c * dt) / (0.7 * dx))));
    const h = dt / sub;
    const c2 = (c * c) / (dx * dx);
    const u = this.u;
    const v = this.v;
    const b = this.damping;
    for (let s = 0; s < sub; s++) {
      const t = worldTime + (s + 1) * h;
      for (let i = 1; i < n - 1; i++) {
        v[i] += h * (c2 * (u[i - 1] + u[i + 1] - 2 * u[i]) - b * v[i]);
      }
      if (this.endB === 'free') v[n - 1] += h * (c2 * 2 * (u[n - 2] - u[n - 1]) - b * v[n - 1]);
      const last = u[n - 1];
      const prevNeighbour = u[n - 2];
      for (let i = 1; i < n; i++) u[i] += h * v[i];
      if (this.endB === 'fixed') {
        u[n - 1] = 0;
        v[n - 1] = 0;
      } else if (this.endB === 'absorb') {
        // first-order Mur absorbing boundary
        const k = (c * h - dx) / (c * h + dx);
        u[n - 1] = prevNeighbour + k * (u[n - 2] - last);
        v[n - 1] = 0;
      }
      u[0] = this.driver.type === 'none' ? 0 : this.driverValue(t);
      v[0] = 0;
    }
    this.time = worldTime + dt;
  }

  // world position of node i
  nodePos(i) {
    const n = this.nodes;
    const t = i / (n - 1);
    const dx = this.x2 - this.x1;
    const dy = this.y2 - this.y1;
    const L = Math.hypot(dx, dy) || 1;
    const px = -dy / L;
    const py = dx / L;
    return { x: this.x1 + dx * t + px * this.u[i], y: this.y1 + dy * t + py * this.u[i] };
  }

  // displace the string by plucking at parameter t (0..1) with offset d
  pluck(t, d) {
    const n = this.nodes;
    const k = Math.max(1, Math.min(n - 2, Math.round(t * (n - 1))));
    for (let i = 1; i < n - 1; i++) {
      this.u[i] = i <= k ? (d * i) / k : (d * (n - 1 - i)) / (n - 1 - k);
      this.v[i] = 0;
    }
  }

  energy() {
    const n = this.nodes;
    const dx = this.length / (n - 1);
    let e = 0;
    for (let i = 0; i < n; i++) {
      e += 0.5 * this.density * dx * this.v[i] * this.v[i];
      if (i < n - 1) {
        const du = this.u[i + 1] - this.u[i];
        e += (0.5 * this.tension * du * du) / dx;
      }
    }
    return e;
  }
}

export function stepWaveStrings(world, dt) {
  for (const w of world.waveStrings) w.step(dt, world.time);
}
