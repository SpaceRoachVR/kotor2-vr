/**
 * Probe: what happens to an effect applied at a location?
 *
 * `ApplyEffectAtLocation` sets a duration type and duration but no expiry, and
 * `Module.addEffect` pushes whatever it is given — an EffectLink included —
 * onto `Module.effects`, attached to the Module itself. `GameEffect.update`
 * only counts a TEMPORARY effect down once it has an expiry, so these look
 * like they never leave. This reads the live module instead of inferring.
 *
 * Applies, a couple of metres in front of the player, through the real
 * NWScript opcodes (EffectVisualEffect 180, EffectLinkEffects 199,
 * ApplyEffectAtLocation 216):
 *   vfx-temp     EffectVisualEffect                     TEMPORARY 3s
 *   link-temp    EffectLink(EffectVisualEffect, same)   TEMPORARY 3s
 *   vfx-perm     EffectVisualEffect                     PERMANENT     (must stay)
 *   vfx-instant  EffectVisualEffect                     INSTANT       (must not gain an expiry)
 * and samples, each second, which of those effects are on `Module.effects`,
 * what each is attached to, and how many holder models sit in the scene.
 *
 *   node tools/vr-emulator/probe-location-effect-expiry.js
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const DURATION_SECONDS = 3;
const SAMPLE_SECONDS = 9;
const OUT_NAME = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'location-effect-expiry.json';

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate('(() => {\n' +
    '  const wanted = ' + JSON.stringify(text) + '.toLowerCase();\n' +
    '  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };\n' +
    '  const btn = Array.from(document.querySelectorAll("button")).filter(visible)\n' +
    '    .find(b => (b.textContent || "").trim().toLowerCase() === wanted);\n' +
    '  if (!btn) return null;\n' +
    '  const r = btn.getBoundingClientRect();\n' +
    '  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };\n' +
    '})()');
  if (!box) throw new Error('No visible button labelled "' + text + '"');
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

const LOAD_SAVE = `(async () => {
  const gs = window.KotOR.GameState;
  gs.MenuManager.ClearMenus();
  if (gs.module) { try { gs.module.dispose(); } catch (e) {} gs.module = undefined; }
  Promise.resolve(window.KotOR.SaveGame.saves[0].load()).catch(() => undefined);
  return true;
})()`;

const SAVE_LANDED = `(() => {
  const gs = window.KotOR.GameState;
  const p = window.KotOR.PartyManager && window.KotOR.PartyManager.party && window.KotOR.PartyManager.party[0];
  return !!(gs && gs.module && gs.module.readyToProcessEvents && p && p.position && Number.isFinite(p.position.x));
})()`;

const APPLY = `(() => {
  const K = window.KotOR;
  const gs = K.GameState;
  const player = K.PartyManager.party[0];
  const defs = (K.NWScriptDefK2 || K.NWScriptDefK1).Actions;
  const INSTANT = 0, TEMPORARY = 1, PERMANENT = 2, D = ${DURATION_SECONDS};
  const script = { caller: player, getSpellId() { return -1; } };
  const call = (id, args) => defs[id].action.call(script, args);

  // A visualeffects.2da row with a real impact model, so rendering is observable.
  // getByID matches __rowlabel, so walk the rows themselves.
  const vfx2da = gs.TwoDAManager.datatables.get('visualeffects');
  let vfxId = -1, vfxRow = null;
  const rowKeys = vfx2da ? Object.keys(vfx2da.rows) : [];
  for (const key of rowKeys) {
    const row = vfx2da.rows[key];
    const node = row && row.imp_impact_node;
    if (node && node !== '****' && String(row.type_fd).toUpperCase() === 'F') { vfxId = Number(row.__rowlabel); vfxRow = row; break; }
  }
  if (vfxId < 0 || !vfx2da.getByID(vfxId)) {
    return { vfxTablePresent: !!vfx2da, rowCount: rowKeys.length, sampleRow: rowKeys.length ? vfx2da.rows[rowKeys[0]] : null, vfxId };
  }
  const vfx = () => call(180, [vfxId, 0]);
  const link = (a, b) => call(199, [a, b]);
  const p = player.position;
  const loc = call(215, [{ x: p.x + 2, y: p.y, z: p.z }, 0]);
  const applyAt = (type, effect, dur) => call(216, [type, effect, loc, dur]);

  const moduleBefore = gs.module.effects.length;
  const groupBefore = gs.group.effects.children.length;
  const cases = {};
  const applyErrors = {};
  const attempt = (name, fn) => { try { cases[name] = fn(); } catch (e) { applyErrors[name] = String(e && e.message || e); } };
  attempt('vfx-temp', () => { const e = vfx(); applyAt(TEMPORARY, e, D); return [e]; });
  attempt('link-temp', () => { const l = link(vfx(), vfx()); applyAt(TEMPORARY, l, D); return [l, l.effect1, l.effect2]; });
  attempt('vfx-perm', () => { const e = vfx(); applyAt(PERMANENT, e, 0); return [e]; });
  attempt('vfx-instant', () => { const e = vfx(); applyAt(INSTANT, e, 0); return [e]; });

  window.__locProbe = { cases, startTime: gs.module.timeManager.pauseTime, startDay: gs.module.timeManager.pauseDay, groupBefore, moduleBefore };
  const describe = (e) => ({
    ctor: e.constructor.name, durationType: e.getDurationType(), duration: e.duration,
    expireDay: e.expireDay, expireTime: e.expireTime,
    attachedTo: e.object ? (e.object === gs.module ? 'Module' : (e.object.constructor && e.object.constructor.name) + (e.object.model ? '+model' : '')) : null,
  });
  const out = {
    playerPresent: !!player, playerTag: player.getTag(), module: gs.module.filename,
    vfxId, vfxImpactNode: vfxRow && vfxRow.imp_impact_node,
    moduleEffectsBefore: moduleBefore, moduleEffectsAfter: gs.module.effects.length,
    groupEffectsBefore: groupBefore, groupEffectsAfter: gs.group.effects.children.length,
    applyErrors,
    cases: {},
  };
  for (const [k, list] of Object.entries(cases)) out.cases[k] = list.map(describe);
  return out;
})()`;

const SAMPLE = `(() => {
  const gs = window.KotOR.GameState;
  const probe = window.__locProbe;
  if (!probe) return { probePresent: false };
  const tm = gs.module.timeManager;
  const out = {
    probePresent: true,
    gameSecondsElapsed: ((tm.pauseDay - probe.startDay) * 86400000 + (tm.pauseTime - probe.startTime)) / 1000,
    moduleEffects: gs.module.effects.length - probe.moduleBefore,
    groupEffects: gs.group.effects.children.length - probe.groupBefore,
    cases: {},
  };
  for (const [k, list] of Object.entries(probe.cases)) {
    out.cases[k] = list.map((e) => ({
      onModule: gs.module.effects.indexOf(e) >= 0,
      impactModel: !!e.impact_model,
      // Loaded is not rendered: impact() disposes the model when the attached
      // object has no scene node to hang it on.
      impactParented: !!(e.impact_model && e.impact_model.parent),
      duration: Math.round(e.duration * 100) / 100,
    }));
  }
  return out;
})()`;

async function main() {
  // Its own ports, so it can run beside a vr:play session holding 8479.
  const service = await startAssetService({ port: 8483 });
  const harness = new VrHarness({ port: 9448 });
  try {
    await harness.launch(service.url);
    try {
      await harness.waitFor(
        'Array.from(document.querySelectorAll("button")).some(b => (b.textContent||"").trim() === "OK")', 60000);
      await clickButtonByText(harness, 'OK');
    } catch (e) { /* already accepted */ }
    await harness.waitFor('!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)', 240000);
    await harness.waitFor('!!window.KotOR.GameState.MenuManager.MainMenu', 240000);
    await harness.evaluate('(async () => { await window.KotOR.SaveGame.GetSaveGames(); return window.KotOR.SaveGame.saves.length; })()',
      { timeoutMs: 120000 });

    await harness.evaluate(LOAD_SAVE);
    await harness.waitFor(SAVE_LANDED, 300000, 3000);
    await new Promise((r) => setTimeout(r, 5000));

    const errorsBefore = harness.pageErrors.length;
    const applied = await harness.evaluate(APPLY, { timeoutMs: 30000 });
    if (!applied.cases) {
      console.log('could not find a visualeffects row with an impact model: ' + JSON.stringify(applied).slice(0, 1500));
      process.exitCode = 2;
      return;
    }
    const samples = [];
    for (let i = 0; i <= SAMPLE_SECONDS; i++) {
      samples.push(await harness.evaluate(SAMPLE));
      await new Promise((r) => setTimeout(r, 1000));
    }
    const pageErrors = harness.pageErrors.slice(errorsBefore);

    const report = { applied, samples, pageErrorsDuringProbe: pageErrors.slice(0, 20), pageErrorCount: pageErrors.length };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const outFile = path.join(EVIDENCE_DIR, OUT_NAME);
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

    console.log('player located: ' + applied.playerPresent + ' (' + applied.playerTag + ') in ' + applied.module +
      ', vfx row ' + applied.vfxId + ' impact=' + applied.vfxImpactNode);
    console.log('Module.effects ' + applied.moduleEffectsBefore + ' -> ' + applied.moduleEffectsAfter +
      ', group.effects children ' + applied.groupEffectsBefore + ' -> ' + applied.groupEffectsAfter);
    for (const [k, message] of Object.entries(applied.applyErrors)) console.log('  THREW   ' + k.padEnd(12) + message);
    for (const [k, list] of Object.entries(applied.cases)) {
      console.log('  applied ' + k.padEnd(12) + list.map((e) =>
        e.ctor + '{type=' + e.durationType + ' dur=' + e.duration + ' expire=' + e.expireDay + '/' + e.expireTime + ' on=' + e.attachedTo + '}').join(' + '));
    }
    const names = Object.keys(applied.cases);
    console.log('\n t(game s)  ' + names.map((k) => k.padEnd(16)).join('') + 'module  holders');
    for (const s of samples) {
      if (!s.probePresent) { console.log('  probe state missing'); continue; }
      console.log(' ' + String(s.gameSecondsElapsed.toFixed(1)).padStart(8) + '  ' +
        Object.values(s.cases).map((list) => list.map((e) => (e.onModule ? 'on' : '--')).join('/').padEnd(16)).join('') +
        String(s.moduleEffects).padEnd(8) + s.groupEffects);
    }
    const last = samples[samples.length - 1];
    console.log('\nimpact models loaded: ' + JSON.stringify(Object.fromEntries(Object.entries(last.cases).map(([k, l]) => [k, l.map((e) => e.impactModel)]))));
    console.log('impact models in scene: ' + JSON.stringify(Object.fromEntries(Object.entries(last.cases).map(([k, l]) => [k, l.map((e) => e.impactParented)]))));
    console.log('page errors during probe: ' + pageErrors.length);
    for (const e of pageErrors.slice(0, 5)) console.log('  ' + String(e).split('\n')[0]);
    console.log('full report -> ' + path.relative(process.cwd(), outFile));
  } finally {
    await harness.close();
    service.stop();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
