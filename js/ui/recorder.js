// Records time series for bodies flagged `record` plus system energy, for
// the Data panel graphs and CSV export.

export const QUANTITIES = {
  y: { label: 'Height y', unit: 'm', get: (b) => b.y },
  x: { label: 'Position x', unit: 'm', get: (b) => b.x },
  speed: { label: 'Speed |v|', unit: 'm/s', get: (b) => Math.hypot(b.vx, b.vy) },
  vx: { label: 'Velocity vx', unit: 'm/s', get: (b) => b.vx },
  vy: { label: 'Velocity vy', unit: 'm/s', get: (b) => b.vy },
  acc: { label: 'Acceleration |a|', unit: 'm/s²', get: (b) => Math.hypot(b.ax, b.ay) },
  ax: { label: 'Acceleration ax', unit: 'm/s²', get: (b) => b.ax },
  ay: { label: 'Acceleration ay', unit: 'm/s²', get: (b) => b.ay },
  angle: { label: 'Angle θ', unit: '°', get: (b) => (b.angle * 180) / Math.PI },
  omega: { label: 'Angular velocity ω', unit: 'rad/s', get: (b) => b.w },
  ke: { label: 'Kinetic energy', unit: 'J', get: (b) => b.kineticEnergy() },
  pe: { label: 'Potential energy (mgh)', unit: 'J', get: (b, w) => -b.mass * b.gravityScale * (w.settings.gravity.x * b.x + w.settings.gravity.y * (b.y - w.settings.room.bottom)) },
  p: { label: 'Momentum |p|', unit: 'kg·m/s', get: (b) => b.mass * Math.hypot(b.vx, b.vy) },
  px: { label: 'Momentum px', unit: 'kg·m/s', get: (b) => b.mass * b.vx },
  submerged: { label: 'Submerged fraction', unit: '%', get: (b) => b.submerged * 100 },
};

export class Recorder {
  constructor() {
    this.interval = 1 / 60;
    this.maxSamples = 20000;
    this.paused = false;
    this.clear();
  }

  clear() {
    this.series = new Map(); // bodyId -> { name, color, t: [], q: {key: []} }
    this.system = { t: [], ke: [], pe: [], el: [], total: [], px: [], py: [] };
    this.last = -Infinity;
  }

  sample(world) {
    if (this.paused) return;
    if (world.time - this.last < this.interval - 1e-9) return;
    this.last = world.time;
    const t = world.time;
    for (const b of world.bodies) {
      if (!b.record || b.type === 'static') continue;
      let s = this.series.get(b.id);
      if (!s) {
        s = { id: b.id, t: [], q: {} };
        for (const k of Object.keys(QUANTITIES)) s.q[k] = [];
        this.series.set(b.id, s);
      }
      s.name = b.name || b.geom.kind;
      s.t.push(t);
      for (const [k, def] of Object.entries(QUANTITIES)) s.q[k].push(def.get(b, world));
      if (s.t.length > this.maxSamples) {
        s.t.shift();
        for (const k of Object.keys(s.q)) s.q[k].shift();
      }
    }
    const e = world.energy();
    const p = world.momentum();
    const sy = this.system;
    sy.t.push(t);
    sy.ke.push(e.kinetic);
    sy.pe.push(e.potential);
    sy.el.push(e.elastic);
    sy.total.push(e.total);
    sy.px.push(p.x);
    sy.py.push(p.y);
    if (sy.t.length > this.maxSamples) for (const k of Object.keys(sy)) sy[k].shift();
  }

  // drop samples after time t (used when rewinding)
  truncate(t) {
    for (const s of this.series.values()) {
      let n = s.t.length;
      while (n && s.t[n - 1] > t + 1e-9) n--;
      s.t.length = n;
      for (const k of Object.keys(s.q)) s.q[k].length = n;
    }
    const sy = this.system;
    let n = sy.t.length;
    while (n && sy.t[n - 1] > t + 1e-9) n--;
    for (const k of Object.keys(sy)) sy[k].length = n;
    this.last = n ? sy.t[n - 1] : -Infinity;
  }

  toCSV(world) {
    const lines = [];
    const keys = Object.keys(QUANTITIES);
    lines.push(['body', 'time_s', ...keys.map((k) => `${k}_${QUANTITIES[k].unit.replace(/[^a-zA-Z0-9/]/g, '')}`)].join(','));
    for (const s of this.series.values()) {
      for (let i = 0; i < s.t.length; i++) {
        lines.push([JSON.stringify(s.name), s.t[i].toFixed(4), ...keys.map((k) => +s.q[k][i].toFixed(6))].join(','));
      }
    }
    lines.push('');
    lines.push('system_time_s,kinetic_J,potential_J,elastic_J,total_J,px,py');
    const sy = this.system;
    for (let i = 0; i < sy.t.length; i++) lines.push([sy.t[i].toFixed(4), sy.ke[i].toFixed(5), sy.pe[i].toFixed(5), sy.el[i].toFixed(5), sy.total[i].toFixed(5), sy.px[i].toFixed(5), sy.py[i].toFixed(5)].join(','));
    if (world && world.gates.length) {
      lines.push('');
      lines.push('gate,event,time_s,body,speed_m_s,perp_speed_m_s,block_duration_s');
      for (const g of world.gates) for (const e of g.log) lines.push([JSON.stringify(g.name), e.kind, e.t.toFixed(5), JSON.stringify(e.name), e.speed.toFixed(4), e.vPerp.toFixed(4), e.duration !== undefined ? e.duration.toFixed(5) : ''].join(','));
    }
    if (world && world.timers.length) {
      lines.push('');
      lines.push('timer,kind,time_s,value_s');
      for (const t of world.timers) for (const l of t.laps) lines.push([JSON.stringify(t.name), l.kind, l.t.toFixed(5), l.value.toFixed(5)].join(','));
    }
    return lines.join('\n');
  }
}
