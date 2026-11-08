// Narrow-phase collision between convex shapes. All functions produce a
// manifold { nx, ny, points: [{ x, y, sep, id }] } where the normal points
// from shape A to shape B, or null when shapes are further apart than
// `margin` (speculative contacts are produced for separations < margin).

export const LINEAR_SLOP = 0.005;

export function collideShapes(a, b, margin) {
  if (a.type === 'circle') {
    if (b.type === 'circle') return collideCircles(a, b, margin);
    const m = collidePolygonCircle(b, a, margin);
    if (m) flip(m);
    return m;
  }
  if (b.type === 'circle') return collidePolygonCircle(a, b, margin);
  return collidePolygons(a, b, margin);
}

function flip(m) {
  m.nx = -m.nx;
  m.ny = -m.ny;
}

export function collideCircles(a, b, margin) {
  const dx = b.wx - a.wx;
  const dy = b.wy - a.wy;
  const d = Math.sqrt(dx * dx + dy * dy);
  const sep = d - a.r - b.r;
  if (sep > margin) return null;
  let nx = 1;
  let ny = 0;
  if (d > 1e-9) {
    nx = dx / d;
    ny = dy / d;
  }
  const px = a.wx + nx * (a.r + sep * 0.5);
  const py = a.wy + ny * (a.r + sep * 0.5);
  return { nx, ny, points: [{ x: px, y: py, sep, id: 0 }] };
}

// Polygon (A) vs circle (B).
export function collidePolygonCircle(poly, circle, margin) {
  const cx = circle.wx;
  const cy = circle.wy;
  const r = circle.r;
  const n = poly.count;
  const wv = poly.wv;
  const wn = poly.wn;
  // separation along every face normal
  let inside = true;
  let bestFace = -1;
  let bestSep = -Infinity;
  for (let i = 0; i < n; i++) {
    const s = wn[i * 2] * (cx - wv[i * 2]) + wn[i * 2 + 1] * (cy - wv[i * 2 + 1]);
    if (s > 0) inside = false;
    if (!poly.ghost[i] && s > bestSep) {
      bestSep = s;
      bestFace = i;
    }
  }
  if (bestFace < 0) return null;
  if (inside) {
    const nx = wn[bestFace * 2];
    const ny = wn[bestFace * 2 + 1];
    const sep = bestSep - r;
    if (sep > margin) return null;
    const px = cx - nx * (r + sep * 0.5);
    const py = cy - ny * (r + sep * 0.5);
    return { nx, ny, points: [{ x: px, y: py, sep, id: bestFace }] };
  }
  // closest point over non-ghost edges
  let best = Infinity;
  let qx = 0;
  let qy = 0;
  let bestEdge = 0;
  let bestT = 0.5;
  for (let i = 0; i < n; i++) {
    if (poly.ghost[i]) continue;
    const ax = wv[i * 2];
    const ay = wv[i * 2 + 1];
    const j = (i + 1) % n;
    const bx = wv[j * 2];
    const by = wv[j * 2 + 1];
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-12 ? ((cx - ax) * ex + (cy - ay) * ey) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const px = ax + ex * t;
    const py = ay + ey * t;
    const d2 = (cx - px) * (cx - px) + (cy - py) * (cy - py);
    if (d2 < best) {
      best = d2;
      qx = px;
      qy = py;
      bestEdge = i;
      bestT = t;
    }
  }
  const d = Math.sqrt(best);
  const sep = d - r;
  if (sep > margin) return null;
  // vertex contact at a seam with a neighbouring piece: let the neighbour's
  // face handle it when the circle centre lies in that face's region
  if (poly.nbrPrev && (bestT <= 0 || bestT >= 1)) {
    const nb = bestT <= 0 ? poly.nbrPrev[bestEdge] : poly.nbrNext[bestEdge];
    if (nb && (nb.concave || circleInNeighborRegion(poly.body, nb, cx, cy))) return null;
  }
  let nx;
  let ny;
  if (d > 1e-9) {
    nx = (cx - qx) / d;
    ny = (cy - qy) / d;
  } else {
    nx = wn[bestEdge * 2];
    ny = wn[bestEdge * 2 + 1];
  }
  const px = qx + nx * (sep * 0.5);
  const py = qy + ny * (sep * 0.5);
  return { nx, ny, points: [{ x: px, y: py, sep, id: 100 + bestEdge }] };
}

function circleInNeighborRegion(body, nb, cx, cy) {
  const c = body.c;
  const s = body.s;
  const ax = body.x + c * nb.ax - s * nb.ay;
  const ay = body.y + s * nb.ax + c * nb.ay;
  const bx = body.x + c * nb.bx - s * nb.by;
  const by = body.y + s * nb.bx + c * nb.by;
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  if (l2 < 1e-12) return false;
  const t = ((cx - ax) * ex + (cy - ay) * ey) / l2;
  // outward normal of a CCW boundary edge is (ey, -ex)
  const side = (cx - ax) * ey - (cy - ay) * ex;
  return t >= 0 && t <= 1 && side > 0;
}

function findMaxSeparation(A, B) {
  const nA = A.count;
  const nB = B.count;
  let bestEdge = -1;
  let maxSep = -Infinity;
  for (let i = 0; i < nA; i++) {
    if (A.ghost[i]) continue;
    const nx = A.wn[i * 2];
    const ny = A.wn[i * 2 + 1];
    const vx = A.wv[i * 2];
    const vy = A.wv[i * 2 + 1];
    let si = Infinity;
    for (let j = 0; j < nB; j++) {
      const s = nx * (B.wv[j * 2] - vx) + ny * (B.wv[j * 2 + 1] - vy);
      if (s < si) si = s;
    }
    if (si > maxSep) {
      maxSep = si;
      bestEdge = i;
    }
  }
  return { edge: bestEdge, sep: maxSep };
}

export function collidePolygons(A, B, margin) {
  const sa = findMaxSeparation(A, B);
  if (sa.sep > margin) return null;
  const sb = findMaxSeparation(B, A);
  if (sb.sep > margin) return null;
  if (sa.edge < 0 && sb.edge < 0) return null;

  let ref;
  let inc;
  let edge;
  let flipped;
  const tol = 0.1 * LINEAR_SLOP;
  if (sa.edge < 0 || (sb.edge >= 0 && sb.sep > sa.sep + tol)) {
    ref = B;
    inc = A;
    edge = sb.edge;
    flipped = true;
  } else {
    ref = A;
    inc = B;
    edge = sa.edge;
    flipped = false;
  }

  const rn = ref.count;
  const nx = ref.wn[edge * 2];
  const ny = ref.wn[edge * 2 + 1];
  const i1r = edge;
  const i2r = (edge + 1) % rn;
  const v1x = ref.wv[i1r * 2];
  const v1y = ref.wv[i1r * 2 + 1];
  const v2x = ref.wv[i2r * 2];
  const v2y = ref.wv[i2r * 2 + 1];

  // incident edge: most anti-parallel to reference normal
  let incEdge = 0;
  let minDot = Infinity;
  for (let i = 0; i < inc.count; i++) {
    const d = nx * inc.wn[i * 2] + ny * inc.wn[i * 2 + 1];
    if (d < minDot) {
      minDot = d;
      incEdge = i;
    }
  }
  const j1 = incEdge;
  const j2 = (incEdge + 1) % inc.count;
  let c1x = inc.wv[j1 * 2];
  let c1y = inc.wv[j1 * 2 + 1];
  let c2x = inc.wv[j2 * 2];
  let c2y = inc.wv[j2 * 2 + 1];
  let id1 = j1;
  let id2 = j2;

  let tx = v2x - v1x;
  let ty = v2y - v1y;
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;

  // clip against side plane 1: dot(t, p) >= dot(t, v1)
  const o1 = tx * v1x + ty * v1y;
  let d1 = tx * c1x + ty * c1y - o1;
  let d2 = tx * c2x + ty * c2y - o1;
  if (d1 < 0 && d2 < 0) return null;
  if (d1 < 0) {
    const t = d1 / (d1 - d2);
    c1x += (c2x - c1x) * t;
    c1y += (c2y - c1y) * t;
    id1 = 50 + i1r;
  } else if (d2 < 0) {
    const t = d2 / (d2 - d1);
    c2x += (c1x - c2x) * t;
    c2y += (c1y - c2y) * t;
    id2 = 50 + i1r;
  }
  // clip against side plane 2: dot(t, p) <= dot(t, v2)
  const o2 = tx * v2x + ty * v2y;
  d1 = tx * c1x + ty * c1y - o2;
  d2 = tx * c2x + ty * c2y - o2;
  if (d1 > 0 && d2 > 0) return null;
  if (d1 > 0) {
    const t = d1 / (d1 - d2);
    c1x += (c2x - c1x) * t;
    c1y += (c2y - c1y) * t;
    id1 = 70 + i2r;
  } else if (d2 > 0) {
    const t = d2 / (d2 - d1);
    c2x += (c1x - c2x) * t;
    c2y += (c1y - c2y) * t;
    id2 = 70 + i2r;
  }

  const points = [];
  const s1 = nx * (c1x - v1x) + ny * (c1y - v1y);
  const s2 = nx * (c2x - v1x) + ny * (c2y - v1y);
  const base = (flipped ? 1 : 0) * 10000 + edge * 100;
  if (s1 <= margin) points.push({ x: c1x - nx * s1 * 0.5, y: c1y - ny * s1 * 0.5, sep: s1, id: base + id1 });
  if (s2 <= margin) points.push({ x: c2x - nx * s2 * 0.5, y: c2y - ny * s2 * 0.5, sep: s2, id: base + id2 });
  if (!points.length) return null;
  return flipped ? { nx: -nx, ny: -ny, points } : { nx, ny, points };
}

// --- Queries -------------------------------------------------------------

// Signed distance from a point to a shape (negative inside) and the outward
// normal at the closest surface point. Used by the particle fluid.
export function pointShapeDistance(sh, px, py) {
  if (sh.type === 'circle') {
    const dx = px - sh.wx;
    const dy = py - sh.wy;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-9) return { d: -sh.r, nx: 0, ny: 1 };
    return { d: d - sh.r, nx: dx / d, ny: dy / d };
  }
  const n = sh.count;
  const wv = sh.wv;
  const wn = sh.wn;
  let maxS = -Infinity;
  let face = 0;
  for (let i = 0; i < n; i++) {
    const s = wn[i * 2] * (px - wv[i * 2]) + wn[i * 2 + 1] * (py - wv[i * 2 + 1]);
    if (s > maxS) {
      maxS = s;
      face = i;
    }
  }
  if (maxS <= 0) {
    // inside: push out along the nearest non-ghost face if possible
    let bestS = -Infinity;
    let bestF = -1;
    for (let i = 0; i < n; i++) {
      if (sh.ghost[i]) continue;
      const s = wn[i * 2] * (px - wv[i * 2]) + wn[i * 2 + 1] * (py - wv[i * 2 + 1]);
      if (s > bestS) {
        bestS = s;
        bestF = i;
      }
    }
    if (bestF < 0) return { d: maxS, nx: wn[face * 2], ny: wn[face * 2 + 1] };
    return { d: bestS, nx: wn[bestF * 2], ny: wn[bestF * 2 + 1] };
  }
  // outside: distance to closest edge
  let best = Infinity;
  let qx = 0;
  let qy = 0;
  for (let i = 0; i < n; i++) {
    const ax = wv[i * 2];
    const ay = wv[i * 2 + 1];
    const j = (i + 1) % n;
    const ex = wv[j * 2] - ax;
    const ey = wv[j * 2 + 1] - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-12 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t;
    const cy = ay + ey * t;
    const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d2 < best) {
      best = d2;
      qx = cx;
      qy = cy;
    }
  }
  const d = Math.sqrt(best);
  if (d < 1e-9) return { d: 0, nx: wn[face * 2], ny: wn[face * 2 + 1] };
  return { d, nx: (px - qx) / d, ny: (py - qy) / d };
}

// Does segment (ax,ay)-(bx,by) intersect the shape?
export function segmentHitsShape(sh, ax, ay, bx, by) {
  if (sh.type === 'circle') {
    const ex = bx - ax;
    const ey = by - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 1e-12 ? ((sh.wx - ax) * ex + (sh.wy - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * t - sh.wx;
    const cy = ay + ey * t - sh.wy;
    return cx * cx + cy * cy <= sh.r * sh.r;
  }
  // clip segment against polygon half-planes (Cyrus-Beck)
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  for (let i = 0; i < sh.count; i++) {
    const nx = sh.wn[i * 2];
    const ny = sh.wn[i * 2 + 1];
    const num = nx * (sh.wv[i * 2] - ax) + ny * (sh.wv[i * 2 + 1] - ay);
    const den = nx * dx + ny * dy;
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return false;
    } else {
      const t = num / den;
      if (den < 0) {
        if (t > t0) t0 = t;
      } else if (t < t1) t1 = t;
      if (t0 > t1) return false;
    }
  }
  return true;
}

// Ray cast against a shape: returns fraction t in [0,1] or -1.
export function raycastShape(sh, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  if (sh.type === 'circle') {
    const fx = ax - sh.wx;
    const fy = ay - sh.wy;
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - sh.r * sh.r;
    const disc = b * b - 4 * a * c;
    if (disc < 0 || a < 1e-12) return -1;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    return t >= 0 && t <= 1 ? t : -1;
  }
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < sh.count; i++) {
    const nx = sh.wn[i * 2];
    const ny = sh.wn[i * 2 + 1];
    const num = nx * (sh.wv[i * 2] - ax) + ny * (sh.wv[i * 2 + 1] - ay);
    const den = nx * dx + ny * dy;
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return -1;
    } else {
      const t = num / den;
      if (den < 0) {
        if (t > t0) t0 = t;
      } else if (t < t1) t1 = t;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}
