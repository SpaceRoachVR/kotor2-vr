/**
 * ROADMAP 0.3 — find what holds the orphaned models by cutting holders.
 *
 * Every module load leaves about 50-90 OdysseyModel3D instances alive with no
 * parent (+50-68 MB a load; round 14 went 0.77 -> 2.2 GB and 55 -> 19 FPS).
 * A heap snapshot of the page crashes the renderer at this size, and the
 * earlier cut experiment only reached edges by walking down from the models,
 * so it could not see a holder outside them.
 *
 * This works from the other end: enumerate every container (array, map, set,
 * plain object) reachable from the exported classes within --depth steps,
 * empty a range of them, force a GC and count the parentless models.
 *
 * The cut is destructive on purpose. Keeping the originals to restore them
 * would itself hold every model they reach, so a trial would never free
 * anything (the first version of this probe made exactly that mistake). The
 * holder list keeps only weak references. One page per trial; narrow by
 * running ranges:
 *
 *   node tools/vr-emulator/probe-leak-cut.js                 # cut all
 *   node tools/vr-emulator/probe-leak-cut.js --range 0:400   # cut a range
 *   node tools/vr-emulator/probe-leak-cut.js --list 0:400    # print labels
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : fallback; };
const CHECKPOINT = arg('--checkpoint', 'droids-cleared');
const RELOADS = Number(arg('--reloads', 2));
const DEPTH = Number(arg('--depth', 4));
const RANGE = arg('--range', null);
const LIST = arg('--list', null);
const PORT = Number(arg('--port', 9433));
const NAMES = argv.includes('--names');
const PATHS = argv.includes('--paths');
const SNAPSHOT = arg('--snapshot', null);

const ENUMERATE = `(() => {
  const K = window.KotOR;
  const gs = K.GameState;
  const DEPTH = ${DEPTH};
  const isContainer = (v) => v && typeof v === 'object' && (Array.isArray(v) || v instanceof Map || v instanceof Set ||
    Object.getPrototypeOf(v) === Object.prototype);
  const skip = (v) => !v || typeof v !== 'object' || ArrayBuffer.isView(v) || v instanceof ArrayBuffer ||
    (typeof Node !== 'undefined' && v instanceof Node) || v === window;
  const visited = new Set();
  const holders = [];
  const queue = [];
  for (const exportName of Object.keys(K).sort()) {
    const owner = K[exportName];
    if (owner && (typeof owner === 'function' || typeof owner === 'object')) queue.push([owner, exportName, 0]);
  }
  while (queue.length && holders.length < 50000) {
    const [owner, label, depth] = queue.shift();
    if (visited.has(owner)) continue;
    visited.add(owner);
    let names = [];
    try { names = Object.getOwnPropertyNames(owner).sort(); } catch (e) { continue; }
    for (const prop of names) {
      if (prop === 'prototype' || prop === 'constructor') continue;
      let value;
      try {
        const d = Object.getOwnPropertyDescriptor(owner, prop);
        if (!d || !('value' in d)) continue;
        value = d.value;
        if (skip(value)) continue;
        if (isContainer(value) && d.writable) {
          const size = Array.isArray(value) ? value.length : (value instanceof Map || value instanceof Set) ? value.size : Object.keys(value).length;
          if (size > 0) holders.push({ owner: new WeakRef(owner), prop, label: label + '.' + prop, size, kind: Array.isArray(value) ? 'a' : value instanceof Map ? 'm' : value instanceof Set ? 's' : 'o' });
        }
      } catch (e) { continue; }
      if (depth + 1 < DEPTH && !Array.isArray(value) && !(value instanceof Map) && !(value instanceof Set) && !visited.has(value)) {
        queue.push([value, label + '.' + prop, depth + 1]);
      }
    }
  }
  window.__leakHolders = holders;
  return holders.length;
})()`;

const CUT = (from, to) => `(() => {
  const holders = window.__leakHolders;
  let cut = 0;
  for (let i = ${from}; i < Math.min(${to}, holders.length); i++) {
    const h = holders[i];
    const owner = h.owner.deref();
    if (!owner) continue;
    try {
      owner[h.prop] = h.kind === 'a' ? [] : h.kind === 'm' ? new Map() : h.kind === 's' ? new Set() : {};
      cut++;
    } catch (e) {}
  }
  return cut;
})()`;

async function countOrphans(harness) {
  const cdp = harness.cdp;
  for (let i = 0; i < 3; i++) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const proto = await cdp.send('Runtime.evaluate', { expression: 'window.__leakProto', returnByValue: false });
  const objects = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
  const counted = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objects.objectId,
    returnByValue: true,
    functionDeclaration: 'function () { let orphans = 0; for (const m of this) if (!m.parent) orphans++; return { total: this.length, orphans }; }',
  });
  await cdp.send('Runtime.releaseObject', { objectId: objects.objects.objectId }).catch(() => {});
  await cdp.send('Runtime.releaseObject', { objectId: proto.result.objectId }).catch(() => {});
  return counted.result.value;
}

async function reloadModule(harness) {
  await harness.evaluate(`(() => { const gs = window.KotOR.GameState; Promise.resolve(gs.LoadModule(gs.module.filename)).catch(() => undefined); return true; })()`);
  await steps.sleep(2000);
  await harness.waitFor(`(() => { const gs = window.KotOR.GameState; return !!(gs.module && gs.loadingModule === false && gs.module.readyToProcessEvents === true && gs.module.area); })()`, 180000, 2000);
  await steps.sleep(3000);
}

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: PORT, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, CHECKPOINT);
    await steps.sleep(4000);
    await harness.cdp.send('HeapProfiler.enable').catch(() => {});
    await harness.evaluate(`(() => { const K = window.KotOR; const gs = K.GameState; let s = null;
      for (const c of (gs.module.area.creatures || [])) { if (c && c.model) { s = c.model; break; } }
      if (!s) s = K.PartyManager.party[0].model; window.__leakProto = Object.getPrototypeOf(s); return true; })()`);
    const base = await countOrphans(harness);
    for (let i = 0; i < RELOADS; i++) await reloadModule(harness);
    const before = await countOrphans(harness);
    const leaked = before.orphans - base.orphans;
    console.log(`orphans ${base.orphans} -> ${before.orphans} over ${RELOADS} reloads (leaked ${leaked})`);
    if (PATHS) {
      // Tag the orphans, then walk the object graph from window.KotOR and
      // print how each tagged model is reached. Closures are invisible here:
      // a model found by nothing is held by one.
      const proto = await harness.cdp.send('Runtime.evaluate', { expression: 'window.__leakProto', returnByValue: false });
      const objects = await harness.cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
      const tagged = await harness.cdp.send('Runtime.callFunctionOn', {
        objectId: objects.objects.objectId, returnByValue: true,
        functionDeclaration: 'function () { let n = 0; window.__leakAllTagged = []; for (const m of this) if (!m.parent) { Object.defineProperty(m, "__leakTag", { value: true, enumerable: false }); window.__leakAllTagged.push(m); n++; } return n; }',
      });
      await harness.cdp.send('Runtime.releaseObject', { objectId: objects.objects.objectId }).catch(() => {});
      console.log(`tagged ${tagged.result.value} orphaned models`);
      const report = await harness.evaluate(`(() => {
        const start = window.KotOR;
        const parent = new Map();
        parent.set(start, null);
        let frontier = [start];
        let visited = 1;
        const found = [];
        const skip = (v) => !v || (typeof v !== 'object' && typeof v !== 'function') || ArrayBuffer.isView(v) ||
          v instanceof ArrayBuffer || (typeof Node !== 'undefined' && v instanceof Node) || v === window;
        const visit = (from, key, v) => {
          if (skip(v) || parent.has(v)) return;
          parent.set(v, [from, key]);
          visited++;
          if (v.__leakTag) found.push(v);
          next.push(v);
        };
        let next = [];
        while (frontier.length && visited < 20000000 && found.length < 400) {
          next = [];
          for (const o of frontier) {
            if (o.__leakTag) continue;
            if (o instanceof Map) { for (const [k, v] of o) { visit(o, '<map>', k); visit(o, '<map>', v); } }
            else if (o instanceof Set) { for (const v of o) visit(o, '<set>', v); }
            let names = [];
            try { names = Object.getOwnPropertyNames(o); } catch (e) { continue; }
            const isArray = Array.isArray(o);
            for (const name of names) {
              if (isArray && name !== 'length' && /^\d+$/.test(name)) { visit(o, '[]', o[name]); continue; }
              let d; try { d = Object.getOwnPropertyDescriptor(o, name); } catch (e) { continue; }
              if (d && 'value' in d) visit(o, name, d.value);
              else if (d && d.get && o === start) { try { visit(o, name, o[name]); } catch (e) {} }
            }
          }
          frontier = next;
        }
        const label = (o) => {
          if (o === start) return 'KotOR';
          const c = o && o.constructor && o.constructor.name;
          return (typeof o === 'function' ? 'fn:' + (o.name || '?') : (c || 'Object')) + (o && o.name && typeof o.name === 'string' && typeof o !== 'function' ? '(' + o.name.slice(0, 24) + ')' : '');
        };
        const patterns = {};
        for (const m of found) {
          const chain = [];
          let cur = m;
          while (cur && parent.get(cur)) { const [from, key] = parent.get(cur); chain.unshift(label(from) + '.' + key); cur = from; }
          const sig = chain.join(' > ');
          patterns[sig] = (patterns[sig] || 0) + 1;
        }
        const reached = new Set(found);
        window.__leakUnreached = (window.__leakAllTagged || []).filter((m) => !reached.has(m));
        window.__leakAllTagged = null;
        return { visited, found: found.length, patterns: Object.entries(patterns).sort((a, b) => b[1] - a[1]).slice(0, 25) };
      })()`, { timeoutMs: 600000 });
      console.log(`walked ${report.visited} objects; reached ${report.found} tagged models`);
      if (SNAPSHOT) {
        // Mark only what the walk could NOT reach: the truly leaked models,
        // held by a closure. An enumerable string property is an edge the
        // dominator analysis can find, and adds no retaining edge itself.
        const marked = await harness.evaluate(`(() => { let n = 0; for (const m of window.__leakUnreached || []) { m.__kotor2vrLeakTag = 'leak'; n++; } window.__leakUnreached = null; return n; })()`);
        console.log(`marked ${marked} unreached models for the snapshot`);
        await harness.cdp.send('HeapProfiler.collectGarbage').catch(() => {});
        const fs = require('fs');
        const stream = fs.createWriteStream(SNAPSHOT);
        let bytes = 0;
        harness.cdp.on('HeapProfiler.addHeapSnapshotChunk', (p) => { bytes += p.chunk.length; stream.write(p.chunk); });
        console.log('taking heap snapshot…');
        await harness.cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
        await new Promise((r) => stream.end(r));
        console.log(`SNAPSHOT ${SNAPSHOT} ${(bytes / 1048576).toFixed(0)} MB`);
      }
      for (const [sig, count] of report.patterns) console.log(`PATH ${String(count).padStart(4)}  ${sig}`);
      return;
    }
    if (NAMES) {
      // Which models leak: name, and a few flags that say what owned them.
      const proto = await harness.cdp.send('Runtime.evaluate', { expression: 'window.__leakProto', returnByValue: false });
      const objects = await harness.cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId });
      const census = await harness.cdp.send('Runtime.callFunctionOn', {
        objectId: objects.objects.objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          const groups = {};
          for (const m of this) {
            if (m.parent) continue;
            const owner = m.moduleObject || (m.userData && m.userData.moduleObject);
            const key = [String(m.name || '?'), owner ? (owner.constructor && owner.constructor.name) + ':' + (owner.getTag ? owner.getTag() : '') : 'no-owner',
              'disposed=' + !!m.disposed, 'children=' + (m.children ? m.children.length : 0)].join(' | ');
            groups[key] = (groups[key] || 0) + 1;
          }
          return Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 40);
        }`,
      });
      for (const [key, count] of census.result.value) console.log(`NAME ${String(count).padStart(4)}  ${key}`);
      // One leaked model of each name, in detail: who made it.
      const detail = await harness.cdp.send('Runtime.callFunctionOn', {
        objectId: objects.objects.objectId,
        returnByValue: true,
        functionDeclaration: `function () {
          const seen = new Set(); const out = [];
          for (const m of this) {
            if (m.parent || seen.has(m.name)) continue;
            seen.add(m.name);
            const child = m.children && m.children[0];
            out.push({ name: m.name, userData: Object.keys(m.userData || {}), childName: child && child.name, childType: child && child.type,
              hasSource: !!m.sourceModel, sourceName: m.sourceModel && m.sourceModel.geometryHeader && m.sourceModel.geometryHeader.modelName,
              nodes: m.nodes && m.nodes.size, meshes: (m.meshes || []).length, emitters: (m.emitters || []).length,
              animationManager: !!m.animationManager, ctxGroup: !!(m.context && m.context.group),
              matrixAuto: m.matrixAutoUpdate, visible: m.visible });
            if (out.length >= 12) break;
          }
          return out;
        }`,
      });
      for (const row of detail.result.value) console.log('DETAIL ' + JSON.stringify(row));
      const keys = await harness.evaluate(`(() => { const K = window.KotOR; const gs = K.GameState; let s = null;
        for (const c of (gs.module.area.creatures || [])) { if (c && c.model) { s = c.model; break; } }
        return Object.keys(s).slice(0, 80); })()`);
      console.log('MODEL KEYS ' + keys.join(','));
      return;
    }
    const n = await harness.evaluate(ENUMERATE);
    console.log(`holders enumerated: ${n} (depth ${DEPTH})`);
    if (LIST) {
      const [a, b] = LIST.split(':').map(Number);
      const labels = await harness.evaluate(`window.__leakHolders.slice(${a}, ${b}).map((h, i) => (${a} + i) + ' ' + h.label + ' (' + h.size + ')')`);
      console.log(labels.join('\n'));
      return;
    }
    const [from, to] = RANGE ? RANGE.split(':').map(Number) : [0, n];
    // Stop the world from refilling what was cut while we count.
    await harness.evaluate(`(() => { window.KotOR.GameState.State = 0; return true; })()`).catch(() => {});
    const cut = await harness.evaluate(CUT(from, to));
    const after = await countOrphans(harness);
    const freed = before.orphans - after.orphans;
    console.log(`RESULT range ${from}:${to} cut ${cut}: orphans ${before.orphans} -> ${after.orphans} (freed ${freed} of ${leaked} leaked)`);
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
