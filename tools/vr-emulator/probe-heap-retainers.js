/**
 * ROADMAP 0.3 — name the edge that retains orphaned models.
 *
 * probe-memory-growth.js established *what* leaks: whole OdysseyModel3D
 * instances survive their owner's destroy(), roughly 90 per module load, which
 * at three or four geometries each accounts for the ~300 retained geometries a
 * revisit costs. It could not say *who* holds them - `Runtime.queryObjects`
 * counts instances but has no notion of an incoming edge.
 *
 * Only a heap snapshot carries retainers, so this takes one and walks it.
 *
 * HOW THE ORPHANS ARE FOUND IN THE SNAPSHOT
 *
 * Class names are minified in the bundle, so "find the OdysseyModel3D nodes" is
 * not available by name. Instead the page tags them first: every parentless
 * model gets a marker property, which - being a string - adds no retaining edge
 * of its own. In the snapshot those are exactly the nodes carrying a property
 * edge with the marker's name.
 *
 * WHY IT STREAMS
 *
 * A snapshot of this page is 2.3 GB, past both `JSON.parse` and Node's maximum
 * string length. `heapsnapshot-stream.js` walks the members instead, so this
 * pays one pass per member and never holds the file.
 *
 *   # against a session already running (a sweep is ideal - orphans accumulate)
 *   node --max-old-space-size=8192 tools/vr-emulator/probe-heap-retainers.js --attach 9440
 *
 *   # re-analyse a capture without taking another
 *   node --max-old-space-size=8192 tools/vr-emulator/probe-heap-retainers.js --analyze <file>
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const WebSocket = require('ws');
const { CdpSession, findPageTarget } = require('./cdp');
const { readHeader, scanIntArray, scanStringArray } = require('./heapsnapshot-stream');

const MARKER = '__kotor2vrLeakTag';

function parseArgs(argv) {
  const args = { port: 9440, analyze: null, out: null, top: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--attach') args.port = Number(argv[++i]);
    else if (argv[i] === '--analyze') args.analyze = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--top') args.top = Number(argv[++i]);
  }
  return args;
}

const TAG = `(() => {
  const gs = window.KotOR.GameState;
  let sample = null;
  const area = gs.module && gs.module.area;
  if (area) {
    for (const c of (area.creatures || [])) { if (c && c.model) { sample = c.model; break; } }
    if (!sample) for (const p of (area.placeables || [])) { if (p && p.model) { sample = p.model; break; } }
  }
  if (!sample) { const pl = window.KotOR.PartyManager.Player; sample = pl && pl.model; }
  if (!sample) return { ok: false, error: 'no live model to take a prototype from' };
  window.__omProto = Object.getPrototypeOf(sample);
  return { ok: true, module: gs.module && gs.module.filename };
})()`;

const TAG_FN = `function () {
  let tagged = 0, parented = 0;
  for (const m of this) {
    if (m.parent) { parented++; continue; }
    try { m[${JSON.stringify(MARKER)}] = 1; tagged++; } catch (e) {}
  }
  return { tagged: tagged, parented: parented, total: tagged + parented };
}`;

async function capture(args) {
  const target = await findPageTarget(args.port, (u) => /launch|localhost|127\.0\.0\.1/.test(u), 15000);
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const cdp = new CdpSession(ws);
  try {
    await cdp.send('HeapProfiler.enable').catch(() => {});
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});

    const proto = await cdp.evaluate(TAG, { timeoutMs: 30000 });
    if (!proto || !proto.ok) throw new Error((proto && proto.error) || 'could not resolve model prototype');
    const handle = await cdp.send('Runtime.evaluate', { expression: 'window.__omProto', returnByValue: false });
    const objects = await cdp.send('Runtime.queryObjects', { prototypeObjectId: handle.result.objectId });
    const tagResult = await cdp.send('Runtime.callFunctionOn', {
      objectId: objects.objects.objectId,
      returnByValue: true,
      functionDeclaration: TAG_FN,
    });
    const counts = tagResult.result.value;
    console.log(`module ${proto.module}: ${counts.total} live models, ${counts.parented} parented, ${counts.tagged} tagged as orphaned`);
    if (!counts.tagged) throw new Error('nothing to analyse: no orphaned models');

    // queryObjects holds its own result array; drop it before snapshotting so
    // this tool does not turn up in its own retainer paths.
    await cdp.send('Runtime.releaseObject', { objectId: objects.objects.objectId }).catch(() => {});
    await cdp.send('Runtime.releaseObject', { objectId: handle.result.objectId }).catch(() => {});
    await cdp.evaluate('(() => { delete window.__omProto; return true; })()').catch(() => {});
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});

    const outFile = args.out || path.join(os.tmpdir(), `kotor2vr-${Date.now()}.heapsnapshot`);
    const stream = fs.createWriteStream(outFile);
    let bytes = 0;
    cdp.on('HeapProfiler.addHeapSnapshotChunk', (params) => {
      bytes += params.chunk.length;
      stream.write(params.chunk);
    });
    console.log('taking heap snapshot (slow, and large)…');
    await cdp.send('HeapProfiler.takeHeapSnapshot', {
      reportProgress: false, treatGlobalObjectsAsRoots: true, captureNumericValue: false,
    });
    await new Promise((res) => stream.end(res));
    console.log(`snapshot -> ${outFile} (${(bytes / 1048576).toFixed(1)} MB)`);
    return outFile;
  } finally {
    ws.close();
  }
}

async function analyze(file, top) {
  const header = readHeader(file);
  const meta = header.meta;
  const NF = meta.node_fields.length;
  const EF = meta.edge_fields.length;
  const nodeTypes = meta.node_types[0];
  const edgeTypes = meta.edge_types[0];
  const F_TYPE = meta.node_fields.indexOf('type');
  const F_NAME = meta.node_fields.indexOf('name');
  const F_EDGES = meta.node_fields.indexOf('edge_count');
  const E_TYPE = meta.edge_fields.indexOf('type');
  const E_NAME = meta.edge_fields.indexOf('name_or_index');
  const E_TO = meta.edge_fields.indexOf('to_node');
  const nodeCount = header.node_count;
  console.log(`  ${nodeCount.toLocaleString()} nodes, ${header.edge_count.toLocaleString()} edges`);

  const nodeName = new Uint32Array(nodeCount);
  const nodeType = new Uint8Array(nodeCount);
  const nodeEdges = new Uint32Array(nodeCount);
  console.log('  pass 1/4: nodes');
  await scanIntArray(file, 'nodes', (value, index) => {
    const ord = (index / NF) | 0;
    const field = index % NF;
    if (field === F_NAME) nodeName[ord] = value;
    else if (field === F_TYPE) nodeType[ord] = value;
    else if (field === F_EDGES) nodeEdges[ord] = value;
  });

  console.log('  pass 2/4: strings');
  const strings = [];
  await scanStringArray(file, 'strings', (s) => { strings.push(s); });
  const markerIdx = strings.indexOf(MARKER);
  console.log(`  ${strings.length.toLocaleString()} strings, marker at index ${markerIdx}`);
  if (markerIdx === -1) { console.log('  marker string absent — nothing tagged'); return; }

  // Walking edges means tracking which node owns the run being read.
  const makeOwnerWalker = () => {
    let ord = 0;
    let left = nodeEdges[0];
    return () => {
      while (left === 0 && ord < nodeCount - 1) { ord++; left = nodeEdges[ord]; }
      const current = ord;
      if (left > 0) left--;
      return current;
    };
  };

  console.log('  pass 3/4: edges — finding tagged nodes');
  const tagged = new Set();
  {
    const nextOwner = makeOwnerWalker();
    let owner = 0;
    let type = 0;
    let name = 0;
    await scanIntArray(file, 'edges', (value, index) => {
      const field = index % EF;
      if (field === 0) owner = nextOwner();
      if (field === E_TYPE) type = value;
      else if (field === E_NAME) name = value;
      else if (field === E_TO) {
        if (edgeTypes[type] === 'property' && name === markerIdx) tagged.add(owner);
      }
    });
  }
  console.log(`  tagged orphan models found in snapshot: ${tagged.size}`);
  if (!tagged.size) return;

  console.log('  pass 4/4: edges — collecting retainers');
  const retainerCount = new Map();
  const holdersOf = new Map();
  {
    const nextOwner = makeOwnerWalker();
    let owner = 0;
    let type = 0;
    let name = 0;
    await scanIntArray(file, 'edges', (value, index) => {
      const field = index % EF;
      if (field === 0) owner = nextOwner();
      if (field === E_TYPE) type = value;
      else if (field === E_NAME) name = value;
      else if (field === E_TO) {
        const to = (value / NF) | 0;
        if (!tagged.has(to)) return;
        const et = edgeTypes[type];
        const label = (et === 'element' || et === 'hidden') ? `[${name}]` : (strings[name] || '?');
        const holderIsOrphan = tagged.has(owner);
        const key = `${nodeTypes[nodeType[owner]]} ${strings[nodeName[owner]] || '?'} --${label}-->` +
          (holderIsOrphan ? '  (holder is itself an orphan model)' : '');
        retainerCount.set(key, (retainerCount.get(key) || 0) + 1);
        if (!holdersOf.has(to)) holdersOf.set(to, []);
        holdersOf.get(to).push(holderIsOrphan);
      }
    });
  }

  const rows = [...retainerCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  console.log(`\n=== who points at the ${tagged.size} orphaned models ===`);
  for (const [key, n] of rows) console.log('  ' + String(n).padStart(6), key);

  let unretained = 0;
  let onlyByOrphans = 0;
  let heldFromOutside = 0;
  for (const ord of tagged) {
    const holders = holdersOf.get(ord);
    if (!holders || !holders.length) { unretained++; continue; }
    if (holders.every(Boolean)) onlyByOrphans++;
    else heldFromOutside++;
  }
  console.log(`\n  no retainer at all (already collectable): ${unretained}`);
  console.log(`  retained only by other orphan models:     ${onlyByOrphans}`);
  console.log(`  retained from outside that set:           ${heldFromOutside}`);
  // Immediate retainers are not the answer on their own. These objects point at
  // each other - a material back at its model, a model at its animation manager -
  // and V8 collects cycles, so a mutually-referencing island is collectable on
  // its own. What keeps them alive is whichever holder is reachable from a GC
  // root, so the climb below is the part that actually answers the question.
  //
  // Climbing one level at a time keeps it cheap: each pass tracks only the
  // current frontier, which costs a scan rather than a reverse index over 98M
  // edges. Root distance is small in practice, so it converges in a few levels.
  await climbToRoot(file, {
    NF, EF, E_TYPE, E_NAME, E_TO, nodeTypes, edgeTypes, nodeName, nodeType,
    nodeEdges, nodeCount, strings, tagged,
  });
}

/**
 * Walk backwards from the leaked set until a GC root is reached, and report the
 * path shapes that hold them.
 */
async function climbToRoot(file, ctx) {
  const {
    NF, EF, E_TYPE, E_NAME, E_TO, nodeTypes, edgeTypes,
    nodeName, nodeType, nodeEdges, nodeCount, strings, tagged,
  } = ctx;
  const describe = (ord) => `${nodeTypes[nodeType[ord]]} ${strings[nodeName[ord]] || '?'}`;
  const isRoot = (ord) => ord === 0 || nodeTypes[nodeType[ord]] === 'synthetic';

  const seen = new Set(tagged);
  const parent = new Map();
  let frontier = new Set(tagged);

  for (let depth = 1; depth <= 10 && frontier.size; depth += 1) {
    const found = [];
    const next = new Set();
    let ord = 0;
    let left = nodeEdges[0];
    const nextOwner = () => {
      while (left === 0 && ord < nodeCount - 1) { ord++; left = nodeEdges[ord]; }
      const current = ord;
      if (left > 0) left--;
      return current;
    };
    let owner = 0; let type = 0; let name = 0;
    await scanIntArray(file, 'edges', (value, index) => {
      const field = index % EF;
      if (field === 0) owner = nextOwner();
      if (field === E_TYPE) type = value;
      else if (field === E_NAME) name = value;
      else if (field === E_TO) {
        const to = (value / NF) | 0;
        if (!frontier.has(to)) return;
        if (seen.has(owner) && !isRoot(owner)) return;
        const et = edgeTypes[type];
        const label = (et === 'element' || et === 'hidden') ? `[${name}]` : (strings[name] || '?');
        // The debugger retains everything it has ever returned, so a snapshot
        // taken over CDP always shows a "DevTools console" global handle onto the
        // objects the probe just inspected. That root is this tool's own
        // footprint, not the engine's - counting it would report the measurement
        // as the defect. Skip it and keep climbing for a root that is really there.
        if (isRoot(owner) && /DevTools|debugger|console/i.test(label)) return;
        if (!parent.has(owner)) parent.set(owner, { child: to, label });
        if (isRoot(owner)) found.push(owner);
        else next.add(owner);
      }
    });

    if (found.length) {
      console.log(`\n=== retaining path to a GC root (reached at depth ${depth}) ===`);
      const shapes = new Map();
      for (const rootOrd of found.slice(0, 300)) {
        const chain = [];
        let cur = rootOrd;
        let guard = 0;
        while (cur !== undefined && guard++ < 20) {
          const step = parent.get(cur);
          if (!step) break;
          chain.push(`${describe(cur)} --${step.label}-->`);
          if (tagged.has(step.child)) { chain.push('ORPHANED MODEL'); break; }
          cur = step.child;
        }
        const shape = chain.join('\n      ');
        shapes.set(shape, (shapes.get(shape) || 0) + 1);
      }
      const ranked = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
      for (const [shape, n] of ranked) console.log(`\n  x${n}\n      ${shape}`);
      return;
    }

    for (const k of next) seen.add(k);
    frontier = next;
    const sample = [...frontier].slice(0, 6).map(describe).join(' | ');
    console.log(`  depth ${depth}: ${frontier.size} holders — ${sample}`);
  }
  console.log('  no GC root reached within the depth limit');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = args.analyze || await capture(args);
  await analyze(file, args.top);
}

main().catch((error) => { console.error(error); process.exit(1); });
