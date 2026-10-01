/**
 * ROADMAP 0.3 — what keeps the orphaned models alive: a dominator tree.
 *
 * probe-heap-retainers.js tags every parentless OdysseyModel3D and takes a
 * snapshot. Its backward search finds *a* path to a root, and the cut
 * experiment cuts edge classes, and both were inconclusive for the same
 * reason: an object held by several paths is freed by none of them alone.
 * The dominator tree answers the question directly. Object D dominates X when
 * every path from the root to X passes through D, so freeing D frees X. The
 * deepest object that dominates many orphans is what holds them.
 *
 *   node --max-old-space-size=8192 tools/vr-emulator/heap-dominators.js <file.heapsnapshot> [--top 30]
 *
 * Weak edges are ignored, as DevTools does when it computes retained sizes.
 * Everything is held in typed arrays: a 2.3 GB snapshot (36.7M nodes, 98.5M
 * edges) needs about 2 GB of them, outside the JS heap.
 */
const { readHeader, scanIntArray, scanStringArray } = require('./heapsnapshot-stream');

const MARKER = '__kotor2vrLeakTag';

async function load(file) {
  const header = readHeader(file);
  const meta = header.meta;
  const nf = meta.node_fields;
  const ef = meta.edge_fields;
  const N = header.node_count;
  const E = header.edge_count;
  const nodeTypes = meta.node_types[nf.indexOf('type')];
  const edgeTypes = meta.edge_types[ef.indexOf('type')];
  const NF = nf.length;
  const EF = ef.length;
  const iType = nf.indexOf('type');
  const iName = nf.indexOf('name');
  const iEdgeCount = nf.indexOf('edge_count');
  const iSelf = nf.indexOf('self_size');
  const iEType = ef.indexOf('type');
  const iEName = ef.indexOf('name_or_index');
  const iETo = ef.indexOf('to_node');

  const nodeType = new Uint8Array(N);
  const nodeName = new Uint32Array(N);
  const nodeSelf = new Float64Array(N);
  const edgeCount = new Uint32Array(N);
  let k = 0;
  await scanIntArray(file, 'nodes', (v) => {
    const n = (k / NF) | 0;
    const f = k % NF;
    if (f === iType) nodeType[n] = v;
    else if (f === iName) nodeName[n] = v;
    else if (f === iEdgeCount) edgeCount[n] = v;
    else if (f === iSelf) nodeSelf[n] = v;
    k++;
  });
  const firstEdge = new Uint32Array(N + 1);
  for (let n = 0; n < N; n++) firstEdge[n + 1] = firstEdge[n] + edgeCount[n];

  const edgeType = new Uint8Array(E);
  const edgeName = new Uint32Array(E);
  const edgeTo = new Uint32Array(E);
  k = 0;
  await scanIntArray(file, 'edges', (v) => {
    const e = (k / EF) | 0;
    const f = k % EF;
    if (f === iEType) edgeType[e] = v;
    else if (f === iEName) edgeName[e] = v;
    else if (f === iETo) edgeTo[e] = v / NF;
    k++;
  });

  const strings = [];
  await scanStringArray(file, 'strings', (s) => strings.push(s));
  return { N, E, nodeType, nodeName, nodeSelf, firstEdge, edgeType, edgeName, edgeTo, strings, nodeTypes, edgeTypes };
}

function computeDominators(g) {
  const { N, firstEdge, edgeType, edgeTo, edgeTypes } = g;
  const weak = edgeTypes.indexOf('weak');
  const skip = (e) => edgeType[e] === weak;

  // Iterative DFS from the root (node 0) for a postorder numbering.
  const postIndex = new Int32Array(N).fill(-1);
  const order = new Uint32Array(N);
  const visited = new Uint8Array(N);
  const stackNode = new Uint32Array(N);
  const stackEdge = new Uint32Array(N);
  let sp = 0;
  let post = 0;
  stackNode[0] = 0; stackEdge[0] = firstEdge[0]; visited[0] = 1; sp = 1;
  while (sp > 0) {
    const n = stackNode[sp - 1];
    const e = stackEdge[sp - 1];
    if (e < firstEdge[n + 1]) {
      stackEdge[sp - 1] = e + 1;
      if (skip(e)) continue;
      const to = edgeTo[e];
      if (!visited[to]) {
        visited[to] = 1;
        stackNode[sp] = to; stackEdge[sp] = firstEdge[to]; sp++;
      }
    } else {
      postIndex[n] = post;
      order[post++] = n;
      sp--;
    }
  }
  const reachable = post;

  // Predecessors, reachable nodes only.
  const predCount = new Uint32Array(N + 1);
  for (let n = 0; n < N; n++) {
    if (postIndex[n] < 0) continue;
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
      if (!skip(e)) predCount[edgeTo[e] + 1]++;
    }
  }
  for (let n = 0; n < N; n++) predCount[n + 1] += predCount[n];
  const predFill = predCount.slice(0, N);
  const preds = new Uint32Array(predCount[N]);
  for (let n = 0; n < N; n++) {
    if (postIndex[n] < 0) continue;
    for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
      if (!skip(e)) preds[predFill[edgeTo[e]]++] = n;
    }
  }

  // Cooper, Harvey, Kennedy: iterate in reverse postorder until stable.
  const UNDEF = 0xffffffff;
  const idom = new Uint32Array(N).fill(UNDEF);
  idom[0] = 0;
  const intersect = (a, b) => {
    while (a !== b) {
      while (postIndex[a] < postIndex[b]) a = idom[a];
      while (postIndex[b] < postIndex[a]) b = idom[b];
    }
    return a;
  };
  let changed = true;
  let passes = 0;
  while (changed) {
    changed = false;
    passes++;
    for (let i = reachable - 2; i >= 0; i--) {
      const n = order[i];
      let best = UNDEF;
      for (let p = predCount[n]; p < predCount[n + 1]; p++) {
        const pred = preds[p];
        if (idom[pred] === UNDEF) continue;
        best = best === UNDEF ? pred : intersect(pred, best);
      }
      if (best !== UNDEF && idom[n] !== best) { idom[n] = best; changed = true; }
    }
  }
  return { idom, postIndex, reachable, passes };
}

function describe(g, n) {
  const type = g.nodeTypes[g.nodeType[n]];
  const name = g.strings[g.nodeName[n]] || '';
  return `${type}:${name.length > 70 ? name.slice(0, 70) + '…' : name}#${n}`;
}

/** The first edge from `from` to `to`, for naming a link in a chain. */
function edgeLabel(g, from, to) {
  for (let e = g.firstEdge[from]; e < g.firstEdge[from + 1]; e++) {
    if (g.edgeTo[e] !== to) continue;
    const type = g.edgeTypes[g.edgeType[e]];
    const name = (type === 'element' || type === 'hidden') ? `[${g.edgeName[e]}]` : g.strings[g.edgeName[e]];
    return `${type}:${name}`;
  }
  return '(indirect)';
}

async function main() {
  const file = process.argv[2];
  const topAt = process.argv.indexOf('--top');
  const top = topAt > -1 ? Number(process.argv[topAt + 1]) : 30;
  if (!file) { console.error('usage: heap-dominators.js <file.heapsnapshot> [--top 30]'); process.exit(2); }
  console.time('load');
  const g = await load(file);
  console.timeEnd('load');
  console.log(`nodes ${g.N}, edges ${g.E}, strings ${g.strings.length}`);

  const marker = g.strings.indexOf(MARKER);
  if (marker < 0) throw new Error(`no ${MARKER} string: the snapshot carries no tagged models`);
  const property = g.edgeTypes.indexOf('property');
  const orphans = [];
  for (let n = 0; n < g.N; n++) {
    for (let e = g.firstEdge[n]; e < g.firstEdge[n + 1]; e++) {
      if (g.edgeType[e] === property && g.edgeName[e] === marker) { orphans.push(n); break; }
    }
  }
  console.log(`tagged orphaned models: ${orphans.length}`);

  console.time('dominators');
  const d = computeDominators(g);
  console.timeEnd('dominators');
  console.log(`reachable ${d.reachable} of ${g.N}, ${d.passes} passes`);

  const isOrphan = new Uint8Array(g.N);
  for (const o of orphans) isOrphan[o] = 1;
  const unreachable = orphans.filter((o) => d.postIndex[o] < 0).length;

  // Immediate dominators of the orphans, and every ancestor's orphan count.
  const immediate = new Map();
  const dominates = new Map();
  const depthOf = new Map();
  for (const o of orphans) {
    if (d.postIndex[o] < 0) continue;
    const id = d.idom[o];
    immediate.set(id, (immediate.get(id) || 0) + 1);
    let n = id;
    let depth = 0;
    const chain = [];
    while (n !== 0 && depth < 200) { chain.push(n); n = d.idom[n]; depth++; }
    chain.forEach((a, i) => {
      if (isOrphan[a]) return;
      dominates.set(a, (dominates.get(a) || 0) + 1);
      depthOf.set(a, chain.length - i);
    });
  }

  console.log(`\nunreachable once weak edges are ignored (would be collected): ${unreachable}`);
  console.log(`\nimmediate dominators of orphaned models:`);
  for (const [n, c] of [...immediate.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`  ${String(c).padStart(5)}  ${n === 0 ? '(root: held by more than one independent path)' : describe(g, n)}`);
  }

  // The useful holders dominate many orphans and sit deep (specific), not near
  // the root (which dominates everything).
  console.log(`\nobjects dominating the most orphans (deepest first among equals):`);
  const ranked = [...dominates.entries()]
    .filter(([, c]) => c >= Math.max(3, orphans.length * 0.05))
    .sort((a, b) => b[1] - a[1] || depthOf.get(b[0]) - depthOf.get(a[0]))
    .slice(0, top);
  for (const [n, c] of ranked) {
    console.log(`  ${String(c).padStart(5)} orphans  depth ${String(depthOf.get(n)).padStart(3)}  ${describe(g, n)}`);
  }

  // Who holds each orphan's immediate dominator: for a closure context, the
  // functions whose context it is; and the dominator chain a few steps up.
  const contextEdge = g.edgeTypes.indexOf('context');
  const closuresOf = new Map();
  for (let n = 0; n < g.N; n++) {
    for (let e = g.firstEdge[n]; e < g.firstEdge[n + 1]; e++) {
      if (g.edgeType[e] !== contextEdge) continue;
      const to = g.edgeTo[e];
      if (!immediate.has(to) && !(d.idom && orphans.some(() => false))) continue;
      if (!closuresOf.has(to)) closuresOf.set(to, []);
      closuresOf.get(to).push(n);
    }
  }
  const holderSummary = new Map();
  for (const o of orphans) {
    if (d.postIndex[o] < 0) continue;
    const chain = [];
    let n = d.idom[o];
    for (let i = 0; i < 6 && n !== 0; i++) { chain.push(n); n = d.idom[n]; }
    const first = chain[0];
    const fns = (closuresOf.get(first) || []).map((c) => describe(g, c).replace(/#\d+$/, '')).slice(0, 3).join(' | ');
    const up = chain.map((c) => describe(g, c).replace(/#\d+$/, '')).join(' < ');
    const modelName = (() => { for (let e = g.firstEdge[o]; e < g.firstEdge[o + 1]; e++) {
      if (g.edgeType[e] === property && g.strings[g.edgeName[e]] === 'name') return describe(g, g.edgeTo[e]).replace(/#\d+$/, ''); } return '?'; })();
    const key = `held by [${fns || 'no closure'}]  via  ${up}`;
    holderSummary.set(key, (holderSummary.get(key) || 0) + 1);
  }
  console.log(`
holders of the orphans' immediate dominators:`);
  for (const [key, count] of [...holderSummary.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
    console.log(`  ${String(count).padStart(4)}  ${key}`);
  }

  // The full dominator chain, root first, for the deepest strong holder.
  const deepest = ranked.slice().sort((a, b) => depthOf.get(b[0]) - depthOf.get(a[0]))[0];
  if (deepest) {
    const chain = [];
    let n = deepest[0];
    while (n !== 0) { chain.unshift(n); n = d.idom[n]; }
    console.log(`\ndominator chain to the deepest holder (${deepest[1]} orphans):`);
    let prev = 0;
    for (const c of chain) {
      console.log(`  ${edgeLabel(g, prev, c).padEnd(40)} -> ${describe(g, c)}`);
      prev = c;
    }
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { computeDominators };
