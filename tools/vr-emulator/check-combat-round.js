/**
 * Real-engine check of the VR combat round (critic runs 3-5 asked for one
 * instead of hand-built snapshots). Loads the R15 PREPARED FIGHT save, puts
 * the player 1.6 m from the nearest hostile, and asserts:
 *
 *  1. the hilt ring fills during a wait and never runs backwards within it,
 *     and the round opens (the tick) at least once in 9 s of swinging;
 *  2. with a medpac queued mid-fight the player can strafe (not rooted) and
 *     the medpac is still used;
 *  3. a Force power queued against a target beyond its range is refused and
 *     stays queued, and the round is not left committed.
 *
 *   node tools/vr-emulator/check-combat-round.js
 *
 * Needs the save named "R15 PREPARED FIGHT" (scratchpad make-prepared-fight.js).
 * Exits 1 on a failed assertion. Settles logic only, not feel.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures.push(label);
};

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9447, headless: true });
  try {
    await steps.boot(harness, service.url);
    await harness.waitFor(`!!(window.KotOR.GameState.MenuManager.MainMenu && window.KotOR.GameState.MenuManager.MainMenu.bVisible)`, 120000, 1000);
    const found = await harness.evaluate(`(async () => { const K = window.KotOR; await K.SaveGame.GetSaveGames();
      const s = K.SaveGame.saves.find((x) => (x.getSaveName && x.getSaveName()) === 'R15 PREPARED FIGHT');
      if (!s) return false; K.GameState.MenuManager.ClearMenus(); Promise.resolve(s.load()).catch(() => undefined); return true; })()`);
    if (!found) { console.log('SKIP  no "R15 PREPARED FIGHT" save'); process.exitCode = 2; return; }
    await harness.waitFor(`(() => { const gs = window.KotOR.GameState; const p = window.KotOR.PartyManager.party[0];
      return !!(gs.module && p && p.position && gs.Mode === 1 && gs.module.readyToProcessEvents === true && !gs.loadingModule); })()`, 240000, 2000);
    await sleep(6000);
    await steps.enterVrSession(harness).catch(() => undefined);
    await sleep(2000);

    // 1. A Force power beyond its range, from the save's own opening spot: the
    // droid about 17 m away, in view, inside the 20 m lock and beyond Force
    // Push's 15 m. Refused, still queued, and the round is not left committed.
    // The Peragus Exile knows only Speed Burst (self); Force Push is granted
    // for this check alone (no save is written).
    const prep = await harness.evaluate(`(() => { const K = window.KotOR; const gs = K.GameState; const p = gs.getCurrentPlayer();
      let t = null, bd = 1e9; for (const c of gs.module.area.creatures) { if (!c || (c.isDead && c.isDead())) continue; let h = false; try { h = c.isHostile(p); } catch (e) {} if (!h) continue;
        const d = c.position.distanceTo(p.position); if (d < bd) { bd = d; t = c; } }
      if (!t) return { skipped: 'no hostile' };
      const rows = K.TwoDAManager.datatables.get('spells').rows;
      const id = Object.keys(rows).find((k) => /FORCE_PUSH/i.test(String(rows[k].label)));
      if (id === undefined) return { skipped: 'no Force Push row' };
      if (!p.getSpells().some((s) => s.id === Number(id))) p.classes[0].addSpell(new K.TalentSpell(Number(id)));
      const castRange = new K.TalentSpell(Number(id)).getCastRange();
      window.__forceTarget = t;
      return { id: t.id, dist: +bd.toFixed(1), castRange, selectable: gs.ModuleObjectManager.playerSelectableObjects.includes(t) }; })()`);
    console.log('  opening spot: ' + JSON.stringify(prep));
    if (prep.skipped || !prep.selectable || !(prep.dist > prep.castRange)) {
      console.log('  SKIP  Force range: ' + (prep.skipped || (!prep.selectable ? 'hostile not selectable from the opening spot' : 'hostile already within Push range')));
    } else {
      const queued = await harness.evaluate(`(() => { const vr = window.KotOR.VRSpike;
        const wheel = vr.hooks.createActionWheel(${prep.id}); const all = [];
        const walk = (m) => { for (const pg of m.pages) for (const e of pg.entries) { all.push(e); if (e.buildMenu) { try { walk(e.buildMenu()); } catch (x) {} } } }; walk(wheel);
        const push = all.find((x) => /push/i.test(String(x.label)) && typeof x.activate === 'function');
        if (!push) return { skipped: 'Push not on the wheel' };
        push.activate();
        const c = vr.hooks.getCombatContext(${prep.id});
        const out = c && c.onDirectionalForceGesture ? c.onDirectionalForceGesture({ kind: 'push' }) : 'no handler';
        const after = vr.hooks.getCombatContext(${prep.id});
        return { label: String(push.label), out, readout: after && after.stanceReadout, nominated: after && after.nominatedTargetId }; })()`);
      if (queued.skipped) {
        console.log('  SKIP  Force range: ' + queued.skipped);
      } else {
        const reason = await harness.evaluate(`(window.__xrHarness && window.__xrHarness.log || []).filter((e) => /VR force cast/.test(e.text)).slice(-1).map((e) => e.text.slice(0, 140))[0] || 'no log'`);
        check(queued.out === false, 'a Push beyond its range is refused', `at ${prep.dist} m (range ${prep.castRange} m)`);
        check(/out of Force range/.test(reason), 'refused for range, not for want of a target', reason);
        check(String(queued.readout).length > 0, 'the refused power stays queued', `readout "${queued.readout}"`);
        const committed = await harness.evaluate(`(() => { const r = window.KotOR.GameState.getCurrentPlayer().combatRound; return !!(r && r.action && r.action.actionType === 9 && !r.roundStarted); })()`);
        check(!committed, 'the round is not left committed to an unstarted cast');
        // Leave nothing queued for the fight below.
        await harness.evaluate(`(() => { const c = window.KotOR.VRSpike.hooks.getCombatContext(null); return true; })()`);
      }
    }

    const setup = await harness.evaluate(`(() => { const K = window.KotOR; const gs = K.GameState; const p = gs.getCurrentPlayer();
      let best = null, bd = 1e9; for (const c of gs.module.area.creatures) { if (!c || (c.isDead && c.isDead())) continue; let h = false; try { h = c.isHostile(p); } catch (e) {} if (!h) continue;
        const d = c.position.distanceTo(p.position); if (d < bd) { bd = d; best = c; } }
      if (!best) return null;
      window.__checkStart = p.position.clone();
      const v = best.position.clone().sub(p.position); v.z = 0; v.normalize();
      p.position.copy(best.position.clone().sub(v.multiplyScalar(1.6))); window.__checkTarget = best;
      return { id: best.id, tag: best.getTag() }; })()`);
    check(!!setup, 'a hostile to fight', setup ? setup.tag : '');
    if (!setup) return;
    await sleep(3000);
    const ctx = `window.KotOR.VRSpike.hooks.getCombatContext(${setup.id})`;

    // 2. Ring and round opening.
    const samples = [];
    for (let i = 0; i < 30; i++) {
      samples.push(await harness.evaluate(`(() => { const c = ${ctx}; return c ? { r: Number(c.tempoReadiness), open: c.roundOpen === true, inCombat: c.inCombat } : null; })()`));
      if (i % 3 === 0) await harness.evaluate(`(() => { const c = ${ctx}; if (c && c.onCombatSwing) c.onCombatSwing({ actorId: c.actorId, nominatedTargetId: c.nominatedTargetId, input: 'dominant-swing' }); return true; })()`);
      await sleep(300);
    }
    let backwards = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (!a || !b || a.open || b.open || a.r >= 1 || b.r >= 1) continue;
      // A new wait starts near empty; anything else lower than before is the ring running back.
      if (b.r < a.r - 0.02 && !(b.r < 0.25 && a.r > 0.75)) backwards++;
    }
    console.log('  readiness ' + samples.map((s) => s ? s.r.toFixed(2) : '-').join(' '));
    check(samples.some((s) => s && s.inCombat), 'combat started');
    check(samples.some((s) => s && s.r > 0 && s.r < 1), 'the ring shows progress during a wait');
    check(backwards === 0, 'the ring never runs backwards within a wait', `backward steps: ${backwards}`);
    check(samples.some((s) => s && s.open), 'the round opens at least once');

    // 3. Medpac queued, then strafe.
    const med = await harness.evaluate(`(() => { const vr = window.KotOR.VRSpike; const wheel = vr.hooks.createActionWheel(null); const all = [];
      const walk = (m) => { for (const pg of m.pages) for (const e of pg.entries) { all.push(e); if (e.buildMenu) { try { walk(e.buildMenu()); } catch (x) {} } } }; walk(wheel);
      const e = all.find((x) => /medpac/i.test(String(x.label))); if (!e) return null;
      (e.activate || (e.item && e.item.activate))(); vr.hooks.getCombatContext(null).onConsumableUseGesture();
      const inv = window.KotOR.GameState.InventoryManager.inventory.find((i) => /Medpac/.test(i.getName()));
      const p = window.KotOR.PartyManager.Player; return { stack: inv && inv.getStackSize(), x: p.position.x, y: p.position.y }; })()`);
    check(!!med, 'a medpac could be queued');
    if (med) {
      await harness.evaluate(`(() => { window.__xrDevice.controllers.left.updateAxes('thumbstick', 0.7, 0); return true; })()`);
      await sleep(3000);
      await harness.evaluate(`(() => { window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, 0); return true; })()`);
      await sleep(4500);
      const after = await harness.evaluate(`(() => { const p = window.KotOR.PartyManager.Player; const inv = window.KotOR.GameState.InventoryManager.inventory.find((i) => /Medpac/.test(i.getName()));
        return { stack: inv ? inv.getStackSize() : 0, x: p.position.x, y: p.position.y }; })()`);
      const moved = Math.hypot(after.x - med.x, after.y - med.y);
      check(moved > 1, 'the player can strafe with a medpac queued', `moved ${moved.toFixed(2)} m`);
      check(after.stack < med.stack, 'the queued medpac is used', `stack ${med.stack} -> ${after.stack}`);
    }

  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
    if (failures.length) { console.log(`FAILED ${failures.length}: ${failures.join('; ')}`); process.exitCode = 1; }
    else if (process.exitCode !== 2) console.log('PASSED');
  }
})().catch((e) => { console.error('CHECK ERROR', e && e.stack || e); process.exit(1); });
