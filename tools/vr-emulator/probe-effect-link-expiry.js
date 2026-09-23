/**
 * Probe: do TEMPORARY effects applied through an EffectLink ever expire?
 *
 * `ModuleObject.addEffect` unpacks a link into its children and pushes those,
 * but copies only the duration type and duration down — not the expiry that
 * `ApplyEffectToObject` stamped on the link. `GameEffect.update` only counts a
 * TEMPORARY effect down when it has an expiry, so linked children look like
 * they live forever. This reads the live effect list instead of inferring.
 *
 * Applies, to the player, through the real NWScript opcodes:
 *   link-temp    EffectLink(EffectVisualEffect, EffectACIncrease)  TEMPORARY 3s
 *   plain-temp   EffectACIncrease                                  TEMPORARY 3s  (control)
 *   link-perm    EffectLink(EffectVisualEffect, EffectACIncrease)  PERMANENT     (must stay)
 *   direct-temp  EffectACIncrease via addEffect(e, TEMPORARY, 3)   (no NWScript stamping)
 * and samples which of those effect objects are still on the player each second.
 *
 *   node tools/vr-emulator/probe-effect-link-expiry.js
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');

const EVIDENCE_DIR = path.join(__dirname, 'evidence');
const DURATION_SECONDS = 3;
const SAMPLE_SECONDS = 9;

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
  const TEMPORARY = 1, PERMANENT = 2, D = ${DURATION_SECONDS};
  const script = { caller: player, getSpellId() { return -1; } };
  const call = (id, args) => defs[id].action.call(script, args);
  const vfx = () => call(180, [1003, 0]);
  const ac = (n) => call(115, [n, 0, 0]);
  const link = (a, b) => call(199, [a, b]);
  const apply = (type, effect, dur) => call(220, [type, effect, player, dur]);

  const cases = {};
  const before = player.effects.length;

  const lt = link(vfx(), ac(1)); apply(TEMPORARY, lt, D);
  cases['link-temp'] = [lt.effect1, lt.effect2];
  const pt = ac(2); apply(TEMPORARY, pt, D);
  cases['plain-temp'] = [pt];
  const lp = link(vfx(), ac(3)); apply(PERMANENT, lp, 0);
  cases['link-perm'] = [lp.effect1, lp.effect2];
  const dt = new gs.GameEffectFactory.EffectACIncrease();
  dt.setInt(1, 4); dt.initialize();
  player.addEffect(dt, TEMPORARY, D);
  cases['direct-temp'] = [dt];

  window.__effProbe = { player, cases, startTime: gs.module.timeManager.pauseTime, startDay: gs.module.timeManager.pauseDay };
  const describe = (e) => ({
    ctor: e.constructor.name, durationType: e.getDurationType(), duration: e.duration,
    expireDay: e.expireDay, expireTime: e.expireTime,
  });
  const out = { playerPresent: !!player, playerTag: player.getTag(), effectsBefore: before, effectsAfter: player.effects.length, cases: {} };
  for (const [k, list] of Object.entries(cases)) out.cases[k] = list.map(describe);
  return out;
})()`;

const SAMPLE = `(() => {
  const gs = window.KotOR.GameState;
  const probe = window.__effProbe;
  if (!probe) return { probePresent: false };
  const tm = gs.module.timeManager;
  const out = {
    probePresent: true,
    gameSecondsElapsed: ((tm.pauseDay - probe.startDay) * 86400000 + (tm.pauseTime - probe.startTime)) / 1000,
    engineMode: gs.Mode,
    paused: !!gs.State && gs.State,
    effectCount: probe.player.effects.length,
    cases: {},
  };
  for (const [k, list] of Object.entries(probe.cases)) {
    out.cases[k] = list.map((e) => ({ attached: probe.player.effects.indexOf(e) >= 0, duration: Math.round(e.duration * 100) / 100 }));
  }
  return out;
})()`;

async function main() {
  // Its own port, so it can run beside a vr:play session holding 8479.
  const service = await startAssetService({ port: 8481 });
  const harness = new VrHarness({ port: 9447 });
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
    // Let the load settle so the save's own effects are attached first.
    await new Promise((r) => setTimeout(r, 5000));

    const applied = await harness.evaluate(APPLY, { timeoutMs: 30000 });
    const samples = [];
    for (let i = 0; i <= SAMPLE_SECONDS; i++) {
      samples.push(await harness.evaluate(SAMPLE));
      await new Promise((r) => setTimeout(r, 1000));
    }

    const report = { applied, samples, pageErrors: harness.pageErrors.slice(0, 20) };
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const outFile = path.join(EVIDENCE_DIR, 'effect-link-expiry.json');
    fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

    console.log('player located: ' + applied.playerPresent + ' (' + applied.playerTag + ')' +
      ', effects ' + applied.effectsBefore + ' -> ' + applied.effectsAfter);
    for (const [k, list] of Object.entries(applied.cases)) {
      console.log('  applied ' + k.padEnd(12) + list.map((e) =>
        e.ctor + '{type=' + e.durationType + ' dur=' + e.duration + ' expire=' + e.expireDay + '/' + e.expireTime + '}').join(' + '));
    }
    console.log('\n t(game s)  ' + Object.keys(applied.cases).map((k) => k.padEnd(14)).join(''));
    for (const s of samples) {
      if (!s.probePresent) { console.log('  probe state missing'); continue; }
      console.log(' ' + String(s.gameSecondsElapsed.toFixed(1)).padStart(8) + '  ' +
        Object.values(s.cases).map((list) => list.map((e) => (e.attached ? 'on' : '--')).join('/').padEnd(14)).join(''));
    }
    const last = samples[samples.length - 1];
    const verdict = {};
    for (const [k, list] of Object.entries(last.cases || {})) verdict[k] = list.filter((e) => e.attached).length + '/' + list.length + ' still attached';
    console.log('\nafter ' + (last.gameSecondsElapsed || 0).toFixed(1) + ' game seconds: ' + JSON.stringify(verdict));
    if (report.pageErrors.length) console.log('page errors: ' + report.pageErrors.length);
    console.log('full report -> ' + path.relative(process.cwd(), outFile));
  } finally {
    await harness.close();
    service.stop();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
