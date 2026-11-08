// Tiny declarative form builder for the side panels. Every control binds a
// getter/setter; `refresh()` pulls fresh values into controls that are not
// being edited and `tick()` updates live readouts.

import { icon } from './icons.js';

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class Form {
  constructor(container, opts = {}) {
    this.root = container;
    this.refreshers = [];
    this.tickers = [];
    this.onCommit = opts.onCommit || (() => {});
    this.parent = opts.parent || null;
  }

  // all refreshers live on the top-level form
  top() {
    return this.parent ? this.parent.top() : this;
  }

  addRefresher(fn) {
    this.top().refreshers.push(fn);
  }

  addTicker(fn) {
    this.top().tickers.push(fn);
  }

  commit(label) {
    this.top().onCommit(label);
  }

  section(title, opts = {}) {
    const sec = el('div', 'section' + (opts.collapsed ? ' collapsed' : ''));
    const head = el('div', 'section-head', `<span>${title}</span>${icon('chevron').replace('<svg', '<svg class="chev"')}`);
    const body = el('div', 'section-body');
    head.addEventListener('click', () => {
      sec.classList.toggle('collapsed');
      if (opts.id) sessionStore(opts.id, sec.classList.contains('collapsed'));
    });
    if (opts.id) {
      const saved = sessionLoad(opts.id);
      if (saved !== null) sec.classList.toggle('collapsed', saved);
    }
    sec.append(head, body);
    this.root.append(sec);
    return new Form(body, { parent: this });
  }

  row(label, ...controls) {
    const r = el('div', 'row');
    const l = el('label', '', label);
    l.title = label.replace(/<[^>]+>/g, '');
    const c = el('div', 'ctl');
    c.append(...controls);
    r.append(l, c);
    this.root.append(r);
    return r;
  }

  note(html) {
    const n = el('div', 'small-note', html);
    this.root.append(n);
    return n;
  }

  html(html) {
    const d = el('div', '', html);
    this.root.append(d);
    return d;
  }

  number(label, o) {
    const digits = o.digits ?? 3;
    const hasSlider = o.slider !== false && o.min !== undefined && o.max !== undefined;
    const num = el('input');
    num.type = 'number';
    num.step = o.step ?? 'any';
    if (o.min !== undefined && o.clamp !== false) num.min = o.min;
    if (o.max !== undefined && o.clamp !== false && !o.softMax) num.max = o.max;
    let range = null;
    const toSlider = o.log ? (v) => Math.log10(Math.max(v, o.min)) : (v) => v;
    const fromSlider = o.log ? (v) => Math.pow(10, v) : (v) => v;
    if (hasSlider) {
      range = el('input');
      range.type = 'range';
      range.min = toSlider(o.min);
      range.max = toSlider(o.max);
      range.step = o.log ? 0.01 : o.step ?? (o.max - o.min) / 200;
    }
    const unit = el('span', 'unit', o.unit || '');
    const apply = (v, commit) => {
      if (!isFinite(v)) return;
      if (o.clamp !== false) {
        if (o.min !== undefined) v = Math.max(o.min, v);
        if (o.max !== undefined && !o.softMax) v = Math.min(o.max, v);
      }
      o.set(v);
      if (commit) this.commit(label);
    };
    num.addEventListener('input', () => {
      const v = parseFloat(num.value);
      if (isFinite(v)) {
        apply(v, false);
        if (range) range.value = toSlider(v);
      }
    });
    num.addEventListener('change', () => apply(parseFloat(num.value), true));
    num.addEventListener('keydown', (e) => e.stopPropagation());
    if (range) {
      range.addEventListener('input', () => {
        const v = fromSlider(parseFloat(range.value));
        num.value = round(v, digits);
        apply(v, false);
      });
      range.addEventListener('change', () => this.commit(label));
    }
    const refresh = () => {
      const v = o.get();
      if (document.activeElement !== num) num.value = v === null || v === undefined || !isFinite(v) ? '' : round(v, digits);
      if (range && document.activeElement !== range) range.value = toSlider(v);
    };
    refresh();
    this.addRefresher(refresh);
    const r = range ? this.row(label, range, num, unit) : this.row(label, num, unit);
    if (o.title) r.title = o.title;
    return r;
  }

  select(label, options, o) {
    const s = el('select');
    for (const opt of options) {
      const op = el('option');
      if (typeof opt === 'string') {
        op.value = opt;
        op.textContent = opt;
      } else {
        op.value = opt.value;
        op.textContent = opt.label;
      }
      s.append(op);
    }
    s.addEventListener('change', () => {
      o.set(s.value);
      this.commit(label);
      if (o.rebuild) o.rebuild();
    });
    const refresh = () => {
      if (document.activeElement !== s) s.value = String(o.get());
    };
    refresh();
    this.addRefresher(refresh);
    return this.row(label, s);
  }

  check(label, o) {
    const c = el('input');
    c.type = 'checkbox';
    c.addEventListener('change', () => {
      o.set(c.checked);
      this.commit(label);
      if (o.rebuild) o.rebuild();
    });
    const refresh = () => {
      c.checked = !!o.get();
    };
    refresh();
    this.addRefresher(refresh);
    const r = this.row(label, c);
    r.classList.add('check');
    if (o.title) r.title = o.title;
    return r;
  }

  color(label, o) {
    const c = el('input');
    c.type = 'color';
    c.addEventListener('input', () => o.set(c.value));
    c.addEventListener('change', () => this.commit(label));
    const reset = o.reset ? el('button', 'btn small', 'Auto') : null;
    if (reset) {
      reset.addEventListener('click', () => {
        o.reset();
        this.commit(label);
        refresh();
      });
    }
    const refresh = () => {
      if (document.activeElement !== c) c.value = toHex(o.get() || '#94a3b8');
    };
    refresh();
    this.addRefresher(refresh);
    return reset ? this.row(label, c, reset) : this.row(label, c);
  }

  text(label, o) {
    const t = el(o.textarea ? 'textarea' : 'input');
    if (!o.textarea) t.type = 'text';
    t.addEventListener('input', () => o.set(t.value));
    t.addEventListener('change', () => this.commit(label));
    t.addEventListener('keydown', (e) => e.stopPropagation());
    const refresh = () => {
      if (document.activeElement !== t) t.value = o.get() ?? '';
    };
    refresh();
    this.addRefresher(refresh);
    return this.row(label, t);
  }

  buttons(list) {
    const row = el('div', 'btn-row');
    for (const b of list) {
      if (!b) continue;
      const btn = el('button', 'btn ' + (b.variant || '') + (b.small ? ' small' : ''), `${b.icon ? icon(b.icon) : ''}<span>${b.label}</span>`);
      if (b.title) btn.title = b.title;
      btn.addEventListener('click', (e) => b.onClick(e, btn));
      row.append(btn);
    }
    this.root.append(row);
    return row;
  }

  chips(options, o) {
    const row = el('div', 'chip-row');
    const btns = [];
    for (const opt of options) {
      const b = el('button', 'chip', opt.label);
      if (opt.title) b.title = opt.title;
      b.addEventListener('click', () => {
        o.set(opt.value);
        this.commit('chips');
        refresh();
        if (o.rebuild) o.rebuild();
      });
      btns.push([b, opt]);
      row.append(b);
    }
    const refresh = () => {
      const cur = o.get ? o.get() : undefined;
      for (const [b, opt] of btns) b.classList.toggle('on', o.isOn ? o.isOn(opt.value) : cur === opt.value);
    };
    refresh();
    this.addRefresher(refresh);
    this.root.append(row);
    return row;
  }

  readouts(list) {
    const grid = el('div', 'readouts');
    for (const r of list) {
      if (!r) continue;
      const d = el('div', 'ro', `<span>${r.label}</span><span>—</span>`);
      const v = d.lastChild;
      if (r.title) d.title = r.title;
      this.addTicker(() => {
        const val = r.get();
        v.textContent = val;
      });
      grid.append(d);
    }
    this.root.append(grid);
    return grid;
  }

  refresh() {
    for (const f of this.refreshers) f();
  }

  tick() {
    for (const f of this.tickers) f();
  }
}

function round(v, d) {
  const p = Math.pow(10, d);
  return Math.round(v * p) / p;
}

function toHex(c) {
  if (c.startsWith('#') && c.length === 7) return c;
  if (c.startsWith('#') && c.length === 4) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  const m = c.match(/\d+/g);
  if (m && m.length >= 3) return '#' + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('');
  return '#94a3b8';
}

function sessionStore(k, v) {
  try {
    sessionStorage.setItem('physlab.sec.' + k, v ? '1' : '0');
  } catch (e) { /* ignore */ }
}

function sessionLoad(k) {
  try {
    const v = sessionStorage.getItem('physlab.sec.' + k);
    return v === null ? null : v === '1';
  } catch (e) {
    return null;
  }
}
