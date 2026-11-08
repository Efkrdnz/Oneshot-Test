// Small math helpers shared by the engine. Vectors are plain {x, y} objects;
// hot loops work on scalars directly to avoid allocations.

export const EPS = 1e-9;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function v2(x = 0, y = 0) {
  return { x, y };
}

export function len(x, y) {
  return Math.sqrt(x * x + y * y);
}

export function dist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

export function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

// Rotate local vector (x, y) by an angle given as cos / sin.
export function rot(c, s, x, y) {
  return { x: c * x - s * y, y: s * x + c * y };
}

// Inverse rotation.
export function invRot(c, s, x, y) {
  return { x: c * x + s * y, y: -s * x + c * y };
}

export function normalize(x, y) {
  const l = Math.sqrt(x * x + y * y);
  if (l < EPS) return { x: 0, y: 0 };
  return { x: x / l, y: y / l };
}

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function deg(rad) {
  return (rad * 180) / Math.PI;
}

export function rad(degrees) {
  return (degrees * Math.PI) / 180;
}

// Closest point on segment ab to point p.
export function closestOnSegment(px, py, ax, ay, bx, by) {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let t = l2 > EPS ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  t = clamp(t, 0, 1);
  return { x: ax + ex * t, y: ay + ey * t, t };
}

// Signed area of a polygon (positive when counter-clockwise).
export function polygonArea(points) {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

export function polygonCentroid(points) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    const c = p.x * q.y - q.x * p.y;
    a += c;
    cx += (p.x + q.x) * c;
    cy += (p.y + q.y) * c;
  }
  if (Math.abs(a) < EPS) {
    // Degenerate: fall back to the vertex average.
    let sx = 0;
    let sy = 0;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / points.length, y: sy / points.length, area: 0 };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a), area: a };
}

// Andrew's monotone chain convex hull. Returns CCW points.
export function convexHull(points) {
  const pts = points.map((p) => ({ x: p.x, y: p.y })).sort((a, b) => (a.x - b.x) || (a.y - b.y));
  if (pts.length < 3) return pts;
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossO(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossO(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function crossO(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

export function isConvex(points) {
  const n = points.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = crossO(points[i], points[(i + 1) % n], points[(i + 2) % n]);
    if (Math.abs(c) < 1e-12) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

// Remove consecutive near-duplicate and collinear points.
export function cleanPolygon(points, tol = 1e-4) {
  let pts = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > tol) pts.push({ x: p.x, y: p.y });
  }
  if (pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= tol) pts.pop();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs(crossO(a, b, c));
      if (area < tol * tol * 4) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

// Ear clipping triangulation for a simple polygon (CCW). Returns array of
// triangles, each an array of 3 indices into the original point list.
export function triangulate(points) {
  const n = points.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (polygonArea(points) < 0) idx.reverse();
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let earFound = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = points[i0];
      const b = points[i1];
      const c = points[i2];
      if (crossO(a, b, c) <= 1e-12) continue; // reflex
      let inside = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (pointInTri(points[j], a, b, c)) {
          inside = true;
          break;
        }
      }
      if (inside) continue;
      tris.push([i0, i1, i2]);
      idx.splice(i, 1);
      earFound = true;
      break;
    }
    if (!earFound) break; // self intersecting input; give up gracefully
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function pointInTri(p, a, b, c) {
  const d1 = crossO(a, b, p);
  const d2 = crossO(b, c, p);
  const d3 = crossO(c, a, p);
  const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12;
  const pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12;
  return !(neg && pos);
}

// Merge triangles into larger convex pieces (Hertel-Mehlhorn style greedy).
// Input: points and triangles (index triplets). Output: array of index loops.
export function mergeConvex(points, tris, maxVerts = 8) {
  let polys = tris.map((t) => t.slice());
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < polys.length; i++) {
      for (let j = i + 1; j < polys.length; j++) {
        const m = tryMerge(points, polys[i], polys[j], maxVerts);
        if (m) {
          polys[i] = m;
          polys.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return polys;
}

function tryMerge(points, a, b, maxVerts) {
  if (a.length + b.length - 2 > maxVerts) return null;
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b0 = b[j];
      const b1 = b[(j + 1) % b.length];
      if (a0 === b1 && a1 === b0) {
        // shared edge a0->a1 in a and a1->a0 in b
        const res = [];
        for (let k = 0; k < a.length; k++) res.push(a[(i + 1 + k) % a.length]); // starts at a1 ends at a0
        // b: from b1(=a0) ... to b0(=a1) exclusive of endpoints
        for (let k = 2; k < b.length; k++) res.push(b[(j + k) % b.length]);
        const pts = res.map((r) => points[r]);
        if (isConvex(pts)) return res;
        return null;
      }
    }
  }
  return null;
}

// Clip a polygon (array of {x,y}) by half-plane nx*x + ny*y <= d.
export function clipPolygon(points, nx, ny, d) {
  const out = [];
  const n = points.length;
  if (n === 0) return out;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    const dp = nx * p.x + ny * p.y - d;
    const dq = nx * q.x + ny * q.y - d;
    if (dp <= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) {
      const t = dp / (dp - dq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
}

export function fmt(v, digits = 2) {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e5 || a < 1e-3)) return v.toExponential(digits);
  return v.toFixed(digits);
}

// Deterministic pseudo random generator (mulberry32).
export function rng(seed = 1) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
