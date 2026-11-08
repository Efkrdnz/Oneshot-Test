// Geometry descriptors -> convex collision shapes + mass properties.
//
// A body's geometry is described by a small serialisable object (`geom`), e.g.
//   { kind: 'box', w: 1, h: 0.5 }
//   { kind: 'circle', r: 0.3 }
//   { kind: 'poly', points: [...] }       (concave allowed, decomposed)
//   { kind: 'container', w, h, t }        (open cup made of 3 slabs)
//   { kind: 'track', points, thickness }  (static polyline ramp/curve)
// buildGeometry() converts it to convex pieces in "design" coordinates.

import {
  EPS, polygonArea, convexHull, isConvex, cleanPolygon, triangulate, mergeConvex,
} from './math.js';

let SHAPE_UID = 1;

export function makeCircleShape(x, y, r) {
  return { type: 'circle', x, y, r, uid: SHAPE_UID++, wx: 0, wy: 0, aabb: newAABB() };
}

export function makePolyShape(points, ghost) {
  let verts = points.map((p) => ({ x: p.x, y: p.y }));
  let g = ghost ? ghost.slice() : verts.map(() => false);
  if (polygonArea(verts) < 0) {
    verts.reverse();
    // edge i (v_i -> v_i+1) after reversal corresponds to old edge (n-2-i) mod n
    const n = verts.length;
    const og = g.slice();
    g = verts.map((_, i) => og[(2 * n - 2 - i) % n]);
  }
  const n = verts.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l = Math.hypot(ex, ey) || 1;
    normals.push({ x: ey / l, y: -ex / l });
  }
  return {
    type: 'poly',
    verts,
    normals,
    ghost: g,
    count: n,
    uid: SHAPE_UID++,
    wv: new Float64Array(n * 2),
    wn: new Float64Array(n * 2),
    aabb: newAABB(),
  };
}

export function newAABB() {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function boxPoints(w, h, cx = 0, cy = 0, angle = 0) {
  const hw = w / 2;
  const hh = h / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ].map(([x, y]) => ({ x: cx + c * x - s * y, y: cy + s * x + c * y }));
}

// Decompose a simple polygon (any winding) into convex pieces. Internal
// edges are flagged as "ghost" so they are never used as collision normals.
export function decompose(points) {
  let pts = cleanPolygon(points);
  if (pts.length < 3) return [];
  if (polygonArea(pts) < 0) pts = pts.slice().reverse();
  if (isConvex(pts) && pts.length <= 12) return [{ points: pts, ghost: pts.map(() => false) }];
  let tris = triangulate(pts);
  const triArea = tris.reduce((s, t) => s + Math.abs(polygonArea(t.map((i) => pts[i]))), 0);
  if (!tris.length || Math.abs(triArea - Math.abs(polygonArea(pts))) > 1e-3 * Math.abs(polygonArea(pts)) + 1e-6) {
    // self intersecting outline: fall back to the convex hull
    const hull = convexHull(pts);
    return [{ points: hull.slice(0, 12), ghost: hull.slice(0, 12).map(() => false) }];
  }
  const loops = mergeConvex(pts, tris, 8);
  const n = pts.length;
  return loops.map((loop) => {
    const ghost = loop.map((a, i) => {
      const b = loop[(i + 1) % loop.length];
      // boundary edge iff consecutive in the original outline (either way)
      const boundary = (b === (a + 1) % n) || (a === (b + 1) % n);
      return !boundary;
    });
    return { points: loop.map((i) => pts[i]), ghost };
  });
}

// Convert geometry descriptor into raw convex pieces in design coordinates.
// Returns { pieces: [{type:'circle',x,y,r} | {type:'poly',points,ghost}], hull, interior }
export function buildGeometry(geom) {
  const pieces = [];
  let interior = null;
  let hull = null;
  switch (geom.kind) {
    case 'circle':
      pieces.push({ type: 'circle', x: 0, y: 0, r: Math.max(0.005, geom.r) });
      break;
    case 'box':
      pieces.push({ type: 'poly', points: boxPoints(Math.max(0.01, geom.w), Math.max(0.01, geom.h)) });
      break;
    case 'ngon': {
      const n = Math.max(3, Math.min(12, Math.round(geom.n)));
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.PI / 2 + (n % 2 === 0 ? Math.PI / n : 0);
        pts.push({ x: Math.cos(a) * geom.r, y: Math.sin(a) * geom.r });
      }
      pieces.push({ type: 'poly', points: pts });
      break;
    }
    case 'wedge': {
      // right triangle, right angle at bottom (left or right depending on flip)
      const w = Math.max(0.02, geom.w);
      const h = Math.max(0.02, geom.h);
      const pts = geom.flip
        ? [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }]
        : [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: -w / 2, y: h / 2 }];
      pieces.push({ type: 'poly', points: pts });
      break;
    }
    case 'capsule': {
      const w = Math.max(0.02, geom.w);
      const r = Math.max(0.01, geom.r);
      pieces.push({ type: 'poly', points: boxPoints(w, r * 2) });
      pieces.push({ type: 'circle', x: -w / 2, y: 0, r });
      pieces.push({ type: 'circle', x: w / 2, y: 0, r });
      hull = [];
      for (let i = 0; i <= 8; i++) {
        const a = -Math.PI / 2 + (i / 8) * Math.PI;
        hull.push({ x: w / 2 + Math.cos(a) * r, y: Math.sin(a) * r });
      }
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI / 2 + (i / 8) * Math.PI;
        hull.push({ x: -w / 2 + Math.cos(a) * r, y: Math.sin(a) * r });
      }
      break;
    }
    case 'container': {
      // open-top cup: bottom slab + two walls; origin at the outer box centre
      const w = Math.max(0.1, geom.w);
      const h = Math.max(0.1, geom.h);
      const t = Math.min(Math.max(0.01, geom.t || 0.06), w / 3, h / 2);
      const bottom = boxPoints(w, t, 0, -h / 2 + t / 2);
      const left = boxPoints(t, h - t, -w / 2 + t / 2, t / 2);
      const right = boxPoints(t, h - t, w / 2 - t / 2, t / 2);
      pieces.push({ type: 'poly', points: bottom });
      // the wall bottom edge (index 0) sits on the base slab: mark ghost
      pieces.push({ type: 'poly', points: left, ghost: [true, false, false, false] });
      pieces.push({ type: 'poly', points: right, ghost: [true, false, false, false] });
      interior = [
        { x: -w / 2 + t, y: -h / 2 + t }, { x: w / 2 - t, y: -h / 2 + t },
        { x: w / 2 - t, y: h / 2 }, { x: -w / 2 + t, y: h / 2 },
      ];
      hull = boxPoints(w, h);
      break;
    }
    case 'tank': {
      // closed hollow box (4 slabs) that can hold an internal liquid
      const w = Math.max(0.1, geom.w);
      const h = Math.max(0.1, geom.h);
      const t = Math.min(Math.max(0.01, geom.t || 0.05), w / 3, h / 3);
      pieces.push({ type: 'poly', points: boxPoints(w, t, 0, -h / 2 + t / 2) });
      pieces.push({ type: 'poly', points: boxPoints(w, t, 0, h / 2 - t / 2) });
      pieces.push({ type: 'poly', points: boxPoints(t, h - 2 * t, -w / 2 + t / 2, 0), ghost: [true, false, true, false] });
      pieces.push({ type: 'poly', points: boxPoints(t, h - 2 * t, w / 2 - t / 2, 0), ghost: [true, false, true, false] });
      interior = boxPoints(w - 2 * t, h - 2 * t);
      hull = boxPoints(w, h);
      break;
    }
    case 'boat': {
      // open hull with sloped sides
      const w = Math.max(0.2, geom.w);
      const h = Math.max(0.1, geom.h);
      const t = Math.min(Math.max(0.02, geom.t || 0.06), h / 2);
      const inset = Math.min(w * 0.2, h * 0.8);
      const bl = { x: -w / 2 + inset, y: -h / 2 };
      const br = { x: w / 2 - inset, y: -h / 2 };
      const tr = { x: w / 2, y: h / 2 };
      const tl = { x: -w / 2, y: h / 2 };
      // side direction vectors
      const sl = Math.hypot(inset, h);
      const nx = (h / sl) * t; // horizontal thickness offset
      pieces.push({ type: 'poly', points: [bl, br, { x: br.x, y: br.y + t }, { x: bl.x, y: bl.y + t }] });
      pieces.push({
        type: 'poly',
        points: [br, tr, { x: tr.x - nx, y: tr.y }, { x: br.x - nx * 0.2, y: br.y + t }],
        ghost: [false, false, false, true],
      });
      pieces.push({
        type: 'poly',
        points: [bl, { x: bl.x + nx * 0.2, y: bl.y + t }, { x: tl.x + nx, y: tl.y }, tl],
        ghost: [true, false, false, false],
      });
      interior = [
        { x: bl.x + nx * 0.2, y: bl.y + t }, { x: br.x - nx * 0.2, y: br.y + t },
        { x: tr.x - nx, y: tr.y }, { x: tl.x + nx, y: tl.y },
      ];
      hull = [bl, br, tr, tl];
      break;
    }
    case 'poly': {
      for (const part of decompose(geom.points)) pieces.push({ type: 'poly', points: part.points, ghost: part.ghost });
      if (!pieces.length) pieces.push({ type: 'poly', points: boxPoints(0.2, 0.2) });
      break;
    }
    case 'track': {
      const pts = geom.points;
      const th = Math.max(0.02, geom.thickness || 0.15);
      if (pts.length < 2) {
        pieces.push({ type: 'poly', points: boxPoints(1, th) });
        break;
      }
      // offset polyline below (to the right of travel direction) by thickness
      const n = pts.length;
      const off = [];
      for (let i = 0; i < n; i++) {
        let nx = 0;
        let ny = 0;
        if (i > 0) {
          const dx = pts[i].x - pts[i - 1].x;
          const dy = pts[i].y - pts[i - 1].y;
          const l = Math.hypot(dx, dy) || 1;
          nx += dy / l;
          ny += -dx / l;
        }
        if (i < n - 1) {
          const dx = pts[i + 1].x - pts[i].x;
          const dy = pts[i + 1].y - pts[i].y;
          const l = Math.hypot(dx, dy) || 1;
          nx += dy / l;
          ny += -dx / l;
        }
        const l = Math.hypot(nx, ny) || 1;
        nx /= l;
        ny /= l;
        // miter length correction, limited
        let scale = 1;
        if (i > 0 && i < n - 1) {
          const dx = pts[i + 1].x - pts[i].x;
          const dy = pts[i + 1].y - pts[i].y;
          const ll = Math.hypot(dx, dy) || 1;
          const cosHalf = Math.abs(nx * (dy / ll) + ny * (-dx / ll));
          scale = Math.min(2, 1 / Math.max(0.3, cosHalf));
        }
        // geom.side: 1 => thickness below the path (default), -1 above
        const side = geom.side === -1 ? -1 : 1;
        off.push({ x: pts[i].x + nx * th * scale * side, y: pts[i].y + ny * th * scale * side });
      }
      for (let i = 0; i < n - 1; i++) {
        const quad = [pts[i], pts[i + 1], off[i + 1], off[i]];
        // edges: 0 top (path), 1 joint (i+1), 2 bottom, 3 joint (i)
        const ghost = [false, i < n - 2, false, i > 0];
        if (Math.abs(polygonArea(quad)) < 1e-6) continue;
        pieces.push({ type: 'poly', points: quad, ghost });
      }
      break;
    }
    case 'compound': {
      for (const p of geom.parts) {
        if (p.type === 'circle') pieces.push({ type: 'circle', x: p.x, y: p.y, r: p.r });
        else pieces.push({ type: 'poly', points: p.points, ghost: p.ghost });
      }
      break;
    }
    default:
      pieces.push({ type: 'poly', points: boxPoints(0.5, 0.5) });
  }
  if (!hull) {
    const all = [];
    for (const p of pieces) {
      if (p.type === 'circle') {
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2;
          all.push({ x: p.x + Math.cos(a) * p.r, y: p.y + Math.sin(a) * p.r });
        }
      } else all.push(...p.points);
    }
    hull = convexHull(all);
  }
  return { pieces, hull, interior };
}

// Mass properties for unit density (area-weighted).
export function polygonMass(points) {
  const s = points[0];
  let area = 0;
  let cx = 0;
  let cy = 0;
  let I = 0;
  const inv3 = 1 / 3;
  for (let i = 1; i < points.length - 1; i++) {
    const e1x = points[i].x - s.x;
    const e1y = points[i].y - s.y;
    const e2x = points[i + 1].x - s.x;
    const e2y = points[i + 1].y - s.y;
    const D = e1x * e2y - e1y * e2x;
    const tri = 0.5 * D;
    area += tri;
    cx += tri * inv3 * (e1x + e2x);
    cy += tri * inv3 * (e1y + e2y);
    const intx2 = e1x * e1x + e2x * e1x + e2x * e2x;
    const inty2 = e1y * e1y + e2y * e1y + e2y * e2y;
    I += 0.25 * inv3 * D * (intx2 + inty2);
  }
  area = Math.abs(area);
  if (area < EPS) return { area: 0, cx: s.x, cy: s.y, I: 0 };
  // signed handling: points assumed CCW so area positive
  cx = cx / area;
  cy = cy / area;
  // I is about s; shift to centroid
  const Ic = Math.abs(I) - area * (cx * cx + cy * cy);
  return { area, cx: cx + s.x, cy: cy + s.y, I: Math.max(Ic, 0) };
}

export function pieceMass(p) {
  if (p.type === 'circle') {
    const area = Math.PI * p.r * p.r;
    return { area, cx: p.x, cy: p.y, I: 0.5 * area * p.r * p.r };
  }
  let pts = p.points;
  if (polygonArea(pts) < 0) pts = pts.slice().reverse();
  return polygonMass(pts);
}

// Combined mass properties of pieces, relative to the design origin.
export function compoundMass(pieces) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const mp = pieces.map(pieceMass);
  for (const m of mp) {
    area += m.area;
    cx += m.area * m.cx;
    cy += m.area * m.cy;
  }
  if (area < EPS) return { area: 0, cx: 0, cy: 0, I: 0 };
  cx /= area;
  cy /= area;
  let I = 0;
  for (const m of mp) {
    const dx = m.cx - cx;
    const dy = m.cy - cy;
    I += m.I + m.area * (dx * dx + dy * dy);
  }
  return { area, cx, cy, I };
}

// Area of a polygon shape helper for liquid fill etc.
export function areaOf(points) {
  return Math.abs(polygonArea(points));
}

// Approximate a circle by a polygon (used for buoyancy clipping & rendering helpers).
export function circlePolygon(x, y, r, n = 20) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r });
  }
  return out;
}

// For compound bodies whose convex pieces share boundary vertices (tracks,
// decomposed concave polygons), record for every boundary edge endpoint the
// neighbouring boundary edge in another piece. Circle collisions use this to
// ignore vertex contacts that the neighbour's face already covers, which
// removes "ghost bumps" when rolling or sliding across piece seams.
export function computeSmoothNeighbors(shapes) {
  const polys = shapes.filter((s) => s.type === 'poly');
  if (polys.length < 2) return;
  const eps = 1e-6;
  const edges = [];
  for (const s of polys) {
    s.nbrPrev = new Array(s.count).fill(null);
    s.nbrNext = new Array(s.count).fill(null);
    for (let i = 0; i < s.count; i++) {
      if (s.ghost[i]) continue;
      edges.push({ s, i, a: s.verts[i], b: s.verts[(i + 1) % s.count] });
    }
  }
  if (edges.length > 4000) return;
  for (const e of edges) {
    for (const f of edges) {
      if (f.s === e.s) continue;
      // f ends where e starts -> f is e's previous neighbour
      // concave (or flat) seam: the vertex can never be a genuine contact
      if (Math.abs(f.b.x - e.a.x) < eps && Math.abs(f.b.y - e.a.y) < eps) {
        const turn = (e.a.x - f.a.x) * (e.b.y - e.a.y) - (e.a.y - f.a.y) * (e.b.x - e.a.x);
        e.s.nbrPrev[e.i] = { ax: f.a.x, ay: f.a.y, bx: f.b.x, by: f.b.y, concave: turn <= 1e-9 };
      }
      if (Math.abs(f.a.x - e.b.x) < eps && Math.abs(f.a.y - e.b.y) < eps) {
        const turn = (e.b.x - e.a.x) * (f.b.y - f.a.y) - (e.b.y - e.a.y) * (f.b.x - f.a.x);
        e.s.nbrNext[e.i] = { ax: f.a.x, ay: f.a.y, bx: f.b.x, by: f.b.y, concave: turn <= 1e-9 };
      }
    }
  }
}
