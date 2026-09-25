/**
 * Plans a via chain over a rendered walkmesh map (probe-walkmesh-map.js).
 *   node tools/vr-emulator/walkmesh-route.js <map.txt> <fromX,fromY|@> <toX,toY> [--block=D,X] [--step=8]
 * BFS over walkable cells (and door/marker cells), then thins the path to a
 * via point every --step metres, printed as JS route entries.
 */
const fs = require('fs');
const [, , mapPath, fromArg, toArg, ...rest] = process.argv;
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const block = new Set((opt.block || '').split(',').filter(Boolean));
const step = Number(opt.step || 8);
const text = fs.readFileSync(mapPath, 'utf8').split('\n');
const head = text[0].match(/cell (\d+)m  x (-?\d+)\.\.(-?\d+)  y (-?\d+)\.\.(-?\d+)/);
const cell = +head[1], minX = +head[2], minY = +head[4];
const rows = text.slice(1).filter((l) => /^\s*-?\d+ /.test(l)).map((l) => ({ y: +l.slice(0, 6), s: l.slice(7) }));
const grid = new Map(); let z = null;
const legend = text.filter((l) => /^[a-zA-Z0-9] |^D\/o\/T|^X trigger/.test(l));
for (const r of rows) for (let i = 0; i < r.s.length; i += 1) { const ch = r.s[i]; if (ch !== ' ') grid.set(`${minX + i * cell},${r.y}`, ch); }
// The route z comes from any legend line with three coordinates (a door or
// placeable); transition triggers carry only two.
for (const l of legend) { const m = l.match(/@\([^,]+,[^,]+,([^)]+)\)/); if (m) { z = +m[1]; break; } }
function parse(arg) {
  if (arg === '@') { for (const [k, ch] of grid) if (ch === '@') return k.split(',').map(Number); throw new Error('no @ on map'); }
  const [x, y] = arg.split(',').map(Number); return [snap(x), snap(y)];
}
// A blocked marker (a locked door, a force field) spans its corridor, not
// one cell: everything within --blockRadius metres of it is impassable.
const snap = (v) => Math.round(v / cell) * cell;
const blockRadius = Number(opt.blockRadius || 0);
const blockedCells = new Set();
// --blockAt=x,y;x,y blocks the corridor around given coordinates instead of markers.
const blockAt = (opt.blockAt || '').split(';').filter(Boolean).map((pair) => pair.split(',').map(Number).map(snap));
const blockSources = [...[...grid].filter(([, ch]) => block.has(ch)).map(([k]) => k), ...blockAt.map((p) => `${p[0]},${p[1]}`)];
for (const k of blockSources) {
  const [bx, by] = k.split(',').map(Number);
  for (let dy = -blockRadius; dy <= blockRadius; dy += cell) for (let dx = -blockRadius; dx <= blockRadius; dx += cell) {
    if (Math.hypot(dx, dy) <= blockRadius) blockedCells.add(`${bx + dx},${by + dy}`);
  }
  blockedCells.add(k);
}
// Hazard cells ('~') are avoided when --avoidHazards is set; a run without
// it walks through them (the caller decides whether the damage is survivable).
const avoidHazards = opt.avoidHazards !== undefined && opt.avoidHazards !== 'false';
const passable = (k) => grid.has(k) && grid.get(k) !== '#' && !(avoidHazards && grid.get(k) === '~') && !blockedCells.has(k);
const nearestPassable = ([x, y]) => { for (let r = 0; r <= 6; r += 1) for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) { const k = `${x + dx * cell},${y + dy * cell}`; if (passable(k)) return k.split(',').map(Number); } throw new Error(`nothing walkable near ${x},${y}`); };
const from = nearestPassable(parse(fromArg)), to = nearestPassable(parse(toArg));
const key = (p) => `${p[0]},${p[1]}`;
// Dijkstra: a hazard cell ('~', a steam vent or a trap) costs --hazardCost
// steps instead of one, so the route crosses as few vents as possible where
// they cannot be avoided outright (102PER's west wall is one solid field).
const hazardCost = Number(opt.hazardCost || 25);
const cellCost = (k) => (grid.get(k) === '~' ? hazardCost : 1);
const prev = new Map([[key(from), null]]);
const dist = new Map([[key(from), 0]]);
const heap = [[0, from]];
const dirs = [[cell, 0], [-cell, 0], [0, cell], [0, -cell], [cell, cell], [cell, -cell], [-cell, cell], [-cell, -cell]];
const push = (item) => { heap.push(item); let i = heap.length - 1; while (i > 0) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return top; };
let found = null;
const settled = new Set();
while (heap.length) {
  const [d, p] = pop(); const pk = key(p);
  if (settled.has(pk)) continue; settled.add(pk);
  if (pk === key(to)) { found = p; break; }
  for (const [dx, dy] of dirs) {
    const n = [p[0] + dx, p[1] + dy]; const k = key(n);
    if (!passable(k) || settled.has(k)) continue;
    // no corner cutting through blocked diagonals
    if (dx && dy && !(passable(key([p[0] + dx, p[1]])) && passable(key([p[0], p[1] + dy])))) continue;
    const nd = d + cellCost(k) * (dx && dy ? 1.4142 : 1);
    if (dist.has(k) && dist.get(k) <= nd) continue;
    dist.set(k, nd); prev.set(k, p); push([nd, n]);
  }
}
if (!found) { console.log(`NO PATH from ${from} to ${to} (blocked ${[...block].join('') || 'nothing'})`); process.exit(2); }
const path = []; for (let p = found; p; p = prev.get(key(p))) path.unshift(p);
const through = path.map((p) => grid.get(key(p))).filter((ch) => ch !== '.' && ch !== '@' && ch !== '~');
const hazardCells = path.filter((p) => grid.get(key(p)) === '~').length;
let acc = 0; const vias = [];
for (let i = 1; i < path.length; i += 1) {
  acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  const ch = grid.get(key(path[i]));
  if (acc >= step || (ch !== '.' && ch !== '@' && ch !== '~') || i === path.length - 1) { vias.push(path[i]); acc = 0; }
}
console.log(`path ${path.length} cells, ${(path.length * cell)}m; passes markers: ${through.join(' ') || 'none'}; hazard cells crossed: ${hazardCells}`);
console.log(vias.map((p) => `  { x: ${p[0]}, y: ${p[1]}, z: ${z ?? 'Z'} },`).join('\n'));
