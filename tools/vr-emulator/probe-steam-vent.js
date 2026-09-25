/**
 * Stands the Exile on one 102PER HotSteam vent (tr_steamdam: d3+1 fire on
 * enter) and samples HP every 200 ms for four seconds, counting the trigger's
 * enter events and listing the effects on the player, to measure how often
 * the vent really fires.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const VENT = { x: -73.1, y: -58.0 };
const SNAP = `(() => {
  const K = window.KotOR; const p = K.PartyManager.party[0]; const area = K.GameState.module.area;
  const vents = (area.triggers || []).filter((t) => String(t.tag) === 'HotSteam');
  const here = vents.filter((t) => t.box && t.box.containsPoint(p.position)).map((t) => ({ id: t.id, triggered: t.triggered, inside: (t.objectsInside || []).length }));
  return { hp: p.getHP(), max: p.getMaxHP(), pos: [+p.position.x.toFixed(2), +p.position.y.toFixed(2)], positionChanged: p.positionChanged,
    effects: (p.effects || []).map((e) => (e.constructor && e.constructor.name) + ':' + e.durationType + ':' + (e.duration ?? '')).slice(0, 12), ventsHere: here };
})()`;

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, 'mining-tunnels');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.addHP(999); return true; })()`).catch(() => undefined);
    // Count every hit: wrap subtractHP, and count OnObjectEnter script runs
    // by wrapping the trigger's onEnter.
    await harness.evaluate(`(() => {
      const K = window.KotOR; const p = K.PartyManager.party[0]; window.__hits = []; window.__enters = [];
      const orig = p.subtractHP.bind(p); p.subtractHP = (n) => { window.__hits.push({ t: Math.round(performance.now()), n }); return orig(n); };
      for (const t of K.GameState.module.area.triggers) { if (String(t.tag) !== 'HotSteam') continue; const o = t.onEnter.bind(t); t.onEnter = (obj) => { window.__enters.push({ t: Math.round(performance.now()), id: t.id }); return o(obj); }; }
      window.__adds = []; window.__execs = []; window.__runs = [];
      const addOrig = p.addEffect.bind(p); p.addEffect = (e, ty, du) => { const st = String(new Error().stack); window.__adds.push({ t: Math.round(performance.now()), e: e && e.constructor.name, stack: st.split(String.fromCharCode(10)).slice(2, 9).map((l) => l.trim().slice(0, 100)) }); return addOrig(e, ty, du); };
      const Sig = K.GameEventFactory.EventSignalEvent; const execOrig = Sig.prototype.execute;
      Sig.prototype.execute = function () { window.__execs.push({ t: Math.round(performance.now()), type: this.eventType, obj: this.getObject() ? String(this.getObject().tag) : null }); return execOrig.call(this); };
      for (const t of K.GameState.module.area.triggers) { if (String(t.tag) !== 'HotSteam') continue; const inst = t.getScriptInstance(3) || t.scripts && Object.values(t.scripts)[0]; if (inst && inst.nwscript && !inst.nwscript.__wrapped) { const nw = inst.nwscript; const ni = nw.newInstance.bind(nw); nw.newInstance = () => { const i = ni(); const r = i.run.bind(i); i.run = (o) => { window.__runs.push({ t: Math.round(performance.now()), tag: String(o && o.tag) }); return r(o); }; return i; }; nw.__wrapped = true; } }
      return true;
    })()`);
    const before = harness.consoleMessages.length;
    console.log('BEFORE', JSON.stringify(await harness.evaluate(SNAP)));
    // Stand south of the vent chain, confirm the placement took, then drive
    // north through it by thumbstick while sampling.
    await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.party[0]; p.position.set(-73, -61, 3.36); p.positionChanged = true; if (p.collisionManager) { p.collisionManager.groundFace = undefined; } return true; })()`);
    await steps.sleep(1500);
    console.log('PLACED', JSON.stringify(await harness.evaluate(SNAP)));
    const samples = [];
    const sampler = (async () => {
      for (let i = 0; i < 120; i += 1) {
        await steps.sleep(100);
        const s = await harness.evaluate(SNAP).catch(() => null);
        if (!s) continue;
        const enters = harness.consoleMessages.slice(before).filter((m) => /HotSteam enter/.test(m.text)).length;
        samples.push(`t=${(i + 1) * 100}ms hp=${s.hp}/${s.max} pos=${JSON.stringify(s.pos)} enters=${enters} vents=${s.ventsHere.length} effects=${s.effects.length}`);
        if (s.hp <= 0) break;
      }
    })();
    const walk = await steps.moveTo(harness, { x: -80, y: -40, z: 3.36, range: 1.5, label: 'through the vents', timeoutMs: 12000, usePath: false }).catch((e) => ({ error: String(e.message).slice(0, 120) }));
    await sampler;
    console.log('WALK', JSON.stringify(walk).slice(0, 200));
    for (const line of samples) console.log(line);
    const counts = await harness.evaluate(`(() => ({ hits: window.__hits, enters: window.__enters, adds: window.__adds, execs: window.__execs, runs: window.__runs, effects: (window.KotOR.PartyManager.party[0].effects || []).map((e) => e.constructor.name + ':' + e.durationType) }))()`);
    console.log('ADDS', counts.adds.length);
    const seen = new Map();
    for (const a of counts.adds) { const k = a.stack.join(' | '); seen.set(k, (seen.get(k) || 0) + 1); }
    for (const [k, n] of seen) console.log(`ADD x${n}: ${k}`);
    console.log('EXECS', JSON.stringify(counts.execs));
    console.log('RUNS', JSON.stringify(counts.runs));
    console.log('HITS', JSON.stringify(counts.hits));
    console.log('ENTERS', JSON.stringify(counts.enters));
    console.log('EFFECTS', JSON.stringify(counts.effects));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
