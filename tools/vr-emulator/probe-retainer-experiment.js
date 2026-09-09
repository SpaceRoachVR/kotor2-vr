/**
 * ROADMAP 0.3 — decide which back-reference actually retains the orphaned models,
 * by breaking one and watching whether they become collectable.
 *
 * The heap snapshot named the candidates but could not rank them: these objects
 * point at each other, and V8 collects cycles, so an immediate retainer is not
 * evidence on its own. `OdysseyModel3D.animationManager` is the clearest example
 * - the model constructs its own manager and the manager points back, which is a
 * self-cycle and collectable.
 *
 * A causal test settles it where graph-walking cannot: break one edge class,
 * force a GC, and count the parentless models again. If the count falls, that
 * edge was holding them.
 *
 *   node tools/vr-emulator/probe-retainer-experiment.js --attach 9440 --break textureOwnerModel
 *   node tools/vr-emulator/probe-retainer-experiment.js --attach 9440 --break odysseyModel
 *   node tools/vr-emulator/probe-retainer-experiment.js --attach 9440 --break none
 *
 * `--break none` is the control: it takes both counts without changing anything,
 * so a fall that would have happened anyway is visible as noise rather than
 * mistaken for the result.
 *
 * This mutates a live page and is a diagnostic, not something to run in a real
 * session.
 */
const WebSocket = require('ws');
const { CdpSession, findPageTarget } = require('./cdp');

function parseArgs(argv) {
  const args = { port: 9440, edge: 'none' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--attach') args.port = Number(argv[++i]);
    else if (argv[i] === '--break') args.edge = argv[++i];
  }
  return args;
}

const RESOLVE_PROTO = `(() => {
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

/** Count parentless models, and optionally cut one class of edge first. */
const makeFn = (edge) => `function () {
  const edge = ${JSON.stringify(edge)};
  let orphans = 0, touched = 0;
  for (const m of this) {
    if (m.parent) continue;
    orphans++;
    if (edge === 'none') continue;
    try {
      m.traverse((o) => {
        if (edge === 'textureOwnerModel') {
          const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
          for (const mat of mats) {
            if (mat && mat.userData && mat.userData.textureOwnerModel) {
              mat.userData.textureOwnerModel = undefined;
              touched++;
            }
          }
        } else if (edge === 'odysseyModel') {
          if (o.odysseyModel) { o.odysseyModel = undefined; touched++; }
        } else if (edge === 'animationManager') {
          if (o.animationManager && o.animationManager.model) {
            o.animationManager.model = undefined;
            touched++;
          }
        }
      });
      if (edge === 'odysseyModel' && m.odysseyModel) { m.odysseyModel = undefined; touched++; }
      if (edge === 'animationManager' && m.animationManager) {
        m.animationManager.model = undefined; touched++;
      }
    } catch (e) {}
  }
  return { orphans: orphans, touched: touched };
}`;

async function countOrphans(cdp, edge) {
  const proto = await cdp.evaluate(RESOLVE_PROTO, { timeoutMs: 30000 });
  if (!proto || !proto.ok) throw new Error((proto && proto.error) || 'no prototype');
  const handle = await cdp.send('Runtime.evaluate', { expression: 'window.__omProto', returnByValue: false });
  const objects = await cdp.send('Runtime.queryObjects', { prototypeObjectId: handle.result.objectId });
  const res = await cdp.send('Runtime.callFunctionOn', {
    objectId: objects.objects.objectId,
    returnByValue: true,
    functionDeclaration: makeFn(edge),
  });
  // Both handles retain everything they returned; drop them or the next GC is
  // measuring this probe rather than the engine.
  await cdp.send('Runtime.releaseObject', { objectId: objects.objects.objectId }).catch(() => {});
  await cdp.send('Runtime.releaseObject', { objectId: handle.result.objectId }).catch(() => {});
  await cdp.evaluate('(() => { delete window.__omProto; return true; })()').catch(() => {});
  return res.result.value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = await findPageTarget(args.port, (u) => /launch|localhost|127\.0\.0\.1/.test(u), 15000);
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const cdp = new CdpSession(ws);
  try {
    await cdp.send('HeapProfiler.enable').catch(() => {});
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});

    const before = await countOrphans(cdp, 'none');
    console.log(`baseline parentless models: ${before.orphans}`);

    const cut = await countOrphans(cdp, args.edge);
    console.log(`cut '${args.edge}': ${cut.touched} edge(s) cleared across ${cut.orphans} models`);

    // Two collections: the first drops the probe's own handles, the second the
    // objects those were keeping alive.
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
    await cdp.send('HeapProfiler.collectGarbage').catch(() => {});

    const after = await countOrphans(cdp, 'none');
    console.log(`after GC: ${after.orphans} parentless models remain`);

    const freed = before.orphans - after.orphans;
    console.log(`\n  freed: ${freed} of ${before.orphans}` +
      (args.edge === 'none' ? '   (control run — any change here is noise)' : ''));
    if (args.edge !== 'none') {
      console.log(freed > before.orphans * 0.5
        ? `  => '${args.edge}' was holding them.`
        : `  => '${args.edge}' is NOT what holds them.`);
    }
  } finally {
    ws.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
