/**
 * 103PER's Concealed Stash (OddCase, g_tresmilhig008) is authored with a
 * droid repair kit, three Components and hangar25control (the Hangar 25
 * Control Conduit). The run's take reported only the repair kit, the
 * inventory gained the components but never the conduit, and Hangar Control
 * then refused "Replace hangar control power conduit" (c_hasitem). From the
 * fuel-line checkpoint: list the stash's live inventory, take it the way the
 * container menu does, and list what the party holds afterwards.
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
    await steps.resumeFromCheckpoint(harness, 'fuel-line');
    await steps.enterVrSession(harness);
    await steps.sleep(3000);
    const before = await harness.evaluate(`(() => {
      const K = window.KotOR; const area = K.GameState.module.area;
      const stash = (area.placeables || []).find((p) => p && String(p.tag) === 'OddCase');
      if (!stash) return { found: false };
      const items = (stash.inventory || []).map((i) => ({ tag: i.tag, resref: i.template && i.template.RootNode ? undefined : undefined, name: (() => { try { return i.getName(); } catch (e) { return String(e.message); } })(), stack: i.getStackSize ? i.getStackSize() : null, plot: i.plot, baseItem: i.baseItem }));
      const inv = (K.InventoryManager.inventory || []).map((i) => ({ tag: i.tag, name: (() => { try { return i.getName(); } catch (e) { return '?'; } })(), stack: i.getStackSize ? i.getStackSize() : null }));
      return { found: true, id: stash.id, hasInventory: stash.hasInventory, locked: stash.isLocked && stash.isLocked(), items, partyInventory: inv.length, hasConduitBefore: inv.some((i) => /hangar25control/i.test(String(i.tag))) };
    })()`);
    console.log('BEFORE', JSON.stringify(before));
    const took = await harness.evaluate(`(() => {
      const K = window.KotOR; const area = K.GameState.module.area;
      const stash = (area.placeables || []).find((p) => p && String(p.tag) === 'OddCase');
      window.__added = [];
      const orig = K.InventoryManager.addItem.bind(K.InventoryManager);
      K.InventoryManager.addItem = (item, ...rest) => { let r; try { r = orig(item, ...rest); } catch (e) { window.__added.push({ tag: item && item.tag, threw: String(e.message) }); throw e; } window.__added.push({ tag: item && item.tag, name: (() => { try { return item.getName(); } catch (e) { return '?'; } })(), result: r === undefined ? 'undefined' : String(r && r.tag || r) }); return r; };
      try { stash.retrieveInventory(); } catch (e) { return { threw: String(e.message), added: window.__added }; }
      const inv = (K.InventoryManager.inventory || []).map((i) => ({ tag: i.tag, name: (() => { try { return i.getName(); } catch (e) { return '?'; } })(), stack: i.getStackSize ? i.getStackSize() : null }));
      return { added: window.__added, stashLeft: (stash.inventory || []).length, hasConduitAfter: inv.some((i) => /hangar25control/i.test(String(i.tag))), conduitEntry: inv.filter((i) => /conduit|hangar25/i.test(String(i.tag) + String(i.name))) };
    })()`);
    console.log('TAKE', JSON.stringify(took));
  } finally {
    await harness.close().catch(() => undefined);
    service.stop();
  }
})().catch((e) => { console.error('PROBE ERROR', e && e.stack || e); process.exit(1); });
