/**
 * Plans a via chain on the real walkmesh face graph, height-aware.
 *   node tools/vr-emulator/walkmesh-plan.js <map.faces.json> <fromX,fromY[,z]|@> <toX,toY[,z]> [--step=4] [--hazardCost=25] [--avoidHazards] [--blockAt="x,y;x,y"] [--blockRadius=3]
 *
 * The 2D raster planner treated two ledges that overlap in plan view as
 * one surface (104PER's exterior switchbacks), and the engine's own planner
 * jumps decks. Here nodes are walkable faces; faces are adjacent when they
 * share an edge (within 0.15 m) or, across rooms, when an edge midpoint of
 * one lies within 1.6 m of an edge midpoint of the other with under 1.2 m of
 * height difference (the doorway gaps). Cost is centroid distance, times a
 * hazard factor for faces inside a damaging trigger's polygon; faces under a
 * solid placeable are blocked. Output is route entries with real z.
 */
const fs = require('fs');
const [, , facesPath, fromArg, toArg, ...rest] = process.argv;
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const step = Number(opt.step || 4);
const hazardCost = opt.avoidHazards !== undefined ? 1e6 : Number(opt.hazardCost || 25);
const blockRadius = Number(opt.blockRadius || 3);
const blockAt = (opt.blockAt || '').split(';').filter(Boolean).map((p) => p.split(',').map(Number));
const data = JSON.parse(fs.readFileSync(facesPath, 'utf8'));
const faces = data.faces;

const centroid = (t) => [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];
const inside2d = (px, py, poly) => { let r = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) r = !r; } return r; };
const inTri = (px, py, t) => inside2d(px, py, t.map((v) => [v[0], v[1]]));

const hazard = /steam|fire|flame|dam|trap|hot|burn|gas|shock/i, harmless = /com|atton|spch|dlg|talk|spawn|ambush/i;
const hazardPolys = (data.scripted || []).filter((t) => (hazard.test(t.tag) || hazard.test(t.onEnter)) && !harmless.test(t.tag) && !harmless.test(t.onEnter)).map((t) => t.poly);
const solidTris = (data.solids || []).flatMap((s) => s.tris.map((t) => t.map((v) => [v[0], v[1]])));

const nodes = faces.map((f, i) => {
  const c = centroid(f.tri);
  const haz = hazardPolys.some((p) => inside2d(c[0], c[1], p));
  const solid = solidTris.some((t) => inside2d(c[0], c[1], t));
  const blocked = solid || blockAt.some(([bx, by]) => Math.hypot(c[0] - bx, c[1] - by) <= blockRadius);
  return { i, c, haz, blocked, room: f.room };
});

// Edge keys for same-room adjacency; midpoints for cross-room bridging.
const key = (a, b) => { const r = (v) => v.map((x) => Math.round(x / 0.15)).join(','); const ka = r(a), kb = r(b); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
const edgeMap = new Map();
const mids = [];
faces.forEach((f, i) => {
  for (let e = 0; e < 3; e += 1) {
    const a = f.tri[e], b = f.tri[(e + 1) % 3];
    const k = key(a, b);
    if (!edgeMap.has(k)) edgeMap.set(k, []);
    edgeMap.get(k).push(i);
    mids.push({ i, m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] });
  }
});
const adj = nodes.map(() => new Map());
const link = (a, b, extra = 0) => { if (a === b) return; const d = Math.hypot(nodes[a].c[0] - nodes[b].c[0], nodes[a].c[1] - nodes[b].c[1]) + extra; if (!adj[a].has(b) || adj[a].get(b) > d) adj[a].set(b, d); if (!adj[b].has(a) || adj[b].get(a) > d) adj[b].set(a, d); };
for (const list of edgeMap.values()) for (let x = 0; x < list.length; x += 1) for (let y = x + 1; y < list.length; y += 1) link(list[x], list[y]);
// Cross-room / seam bridging: bucket midpoints on a 2 m grid.
const bucket = new Map();
const bk = (m) => `${Math.floor(m[0] / 2)},${Math.floor(m[1] / 2)}`;
for (const e of mids) { const k = bk(e.m); if (!bucket.has(k)) bucket.set(k, []); bucket.get(k).push(e); }
let bridges = 0;
for (const e of mids) {
  const cx = Math.floor(e.m[0] / 2), cy = Math.floor(e.m[1] / 2);
  for (let dx = -1; dx <= 1; dx += 1) for (let dy = -1; dy <= 1; dy += 1) {
    for (const o of bucket.get(`${cx + dx},${cy + dy}`) || []) {
      if (o.i === e.i || nodes[o.i].room === nodes[e.i].room) continue;
      if (adj[e.i].has(o.i)) continue;
      const d = Math.hypot(e.m[0] - o.m[0], e.m[1] - o.m[1]);
      if (d <= 1.6 && Math.abs(e.m[2] - o.m[2]) <= 1.2) { link(e.i, o.i, 0.5); bridges += 1; }
    }
  }
}

function parsePoint(arg) {
  if (arg === '@') return data.player;
  const p = arg.split(',').map(Number);
  return p.length === 3 ? p : [p[0], p[1], null];
}
function nearestFace(p) {
  let best = -1, bestD = Infinity;
  nodes.forEach((n) => {
    if (n.blocked) return;
    const inside = inTri(p[0], p[1], faces[n.i].tri);
    const dz = p[2] === null ? 0 : Math.abs(n.c[2] - p[2]);
    const d = (inside ? 0 : Math.hypot(n.c[0] - p[0], n.c[1] - p[1])) + dz * 3;
    if (d < bestD) { bestD = d; best = n.i; }
  });
  return best;
}
const from = nearestFace(parsePoint(fromArg)), to = nearestFace(parsePoint(toArg));
if (from < 0 || to < 0) { console.log('NO FACE for start or goal'); process.exit(2); }

// Dijkstra
const dist = new Float64Array(nodes.length).fill(Infinity); const prev = new Int32Array(nodes.length).fill(-1);
dist[from] = 0; const heap = [[0, from]];
const push = (it) => { heap.push(it); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
const done = new Uint8Array(nodes.length);
while (heap.length) {
  const [d, u] = pop(); if (done[u]) continue; done[u] = 1; if (u === to) break;
  for (const [v, w] of adj[u]) {
    if (nodes[v].blocked) continue;
    const nd = d + w * (nodes[v].haz ? hazardCost : 1);
    if (nd < dist[v]) { dist[v] = nd; prev[v] = u; push([nd, v]); }
  }
}
if (!Number.isFinite(dist[to])) { console.log(`NO PATH from face ${from} to face ${to} (${faces.length} faces, ${bridges} seam bridges)`); process.exit(2); }
const path = []; for (let u = to; u >= 0; u = prev[u]) path.unshift(u);
const goal = parsePoint(toArg);
const pts = path.map((i) => nodes[i].c);
let acc = 0; const vias = [];
for (let i = 1; i < pts.length; i += 1) {
  acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  // Thin by distance only: forcing a point at every room change made the
  // chain zigzag along a corridor whose seam the path hugs (105PER).
  if (acc >= step) { vias.push(pts[i]); acc = 0; }
}
const hazardFaces = path.filter((i) => nodes[i].haz).length;
const rooms = [...new Set(path.map((i) => nodes[i].room))];
console.log(`path ${path.length} faces, ${Math.round(dist[to])} cost; rooms ${rooms.join('>')}; hazard faces ${hazardFaces}; seam bridges ${bridges}`);
console.log(vias.map((p) => `  { x: ${p[0].toFixed(1)}, y: ${p[1].toFixed(1)}, z: ${p[2].toFixed(1)} },`).join('\n'));
console.log(`  { x: ${goal[0]}, y: ${goal[1]}, z: ${(goal[2] ?? nodes[to].c[2]).toFixed ? (goal[2] ?? nodes[to].c[2]).toFixed(1) : goal[2]} },`);
