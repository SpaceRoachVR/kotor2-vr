/**
 * Why did Hangar Control (106PER hangterm.dlg) offer T3-M4 only "Log out"?
 * Loads the t3-spikes checkpoint and runs the console's own conditionals
 * (c_ic_skilrep / c_ic_skilrep0) against the live party, reporting what each
 * lookup they depend on returns. Diagnostic only.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

(async () => {
  const service = await startAssetService();
  await waitForPort(8479).catch(() => undefined);
  const harness = new VrHarness({ port: 9431, headless: true });
  try {
    await steps.boot(harness, service.url);
    await steps.resumeFromCheckpoint(harness, process.argv[2] || 't3-spikes');
    const result = await harness.evaluate(`(() => {
      const K = window.KotOR;
      const p = K.PartyManager.party[0];
      const out = { located: !!p };
      if (!p) return out;
      out.tag = String(p.tag); out.ctor = p.constructor && p.constructor.name;
      out.isPM = p.isPM; out.isPartyMember = typeof p.isPartyMember === 'function' ? p.isPartyMember() : null;
      const inv = K.GameState.InventoryManager;
      const part = inv.getItemByTag('K_REPAIR_PART');
      out.partyPart = part ? { tag: part.getTag(), stack: part.getStackSize ? part.getStackSize() : part.stackSize } : part;
      const own = p.getItemByTag('K_REPAIR_PART');
      out.ownPart = own ? { tag: own.getTag(), stack: own.getStackSize ? own.getStackSize() : own.stackSize } : own;
      out.partyInventory = (inv.inventory || []).map((i) => String(i.getTag()) + 'x' + (i.getStackSize ? i.getStackSize() : i.stackSize));
      const runCond = (name, p1) => {
        try {
          const s = K.NWScript.Load(name);
          if (!s) return { name, loaded: false };
          s.setScriptParam(1, p1); s.setScriptParam(2, 0); s.setScriptParam(3, 0); s.setScriptParam(4, 0); s.setScriptParam(5, 0);
          s.setScriptStringParam('');
          const r = s.run(p, 0);
          return { name, p1, result: r, type: typeof r };
        } catch (e) { return { name, p1, threw: String(e && e.message || e) }; }
      };
      out.skills = (() => { try { return { raw: p.skills ? p.skills.map((s) => s && (s.rank ?? s)) : null, repair: p.getSkillLevel ? p.getSkillLevel(5) : null, hasSkill5: typeof p.hasSkill === 'function' ? p.hasSkill(5) : null }; } catch (e) { return String(e); } })();
      out.classes = (() => { try { return (p.classes || []).map((c) => ({ id: c.id, level: c.level })); } catch (e) { return String(e); } })();
      out.skilrep1 = runCond('c_ic_skilrep', 1);
      out.skilrep0 = runCond('c_ic_skilrep0', 0);
      out.comspk1 = runCond('c_ic_has_comspk', 1);
      return out;
    })()`, { timeoutMs: 60000 });
    console.log(JSON.stringify(result, null, 2));
    const tail = harness.consoleMessages.slice(-40).map((m) => `${m.level}: ${m.text}`.slice(0, 220));
    console.log(tail.join('\n'));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
