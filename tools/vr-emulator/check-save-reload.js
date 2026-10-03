/**
 * Critic run 11: loading a save during play added the save's inventory to the
 * bag already carried (Medpac 4 -> 7 per reload) and kept the live player
 * (HP, position, gear) instead of the saved one. Loads "R15 PREPARED FIGHT",
 * changes the player, reloads it, then loads a different save, and asserts
 * each load matches a fresh load of that save. Prints the inventory too.
 *
 *   node tools/vr-emulator/check-save-reload.js [--port 8511]
 *
 * Never saves. Exits 1 on a failed assertion.
 */
const { VrHarness } = require('./harness');
const { startAssetService, waitForPort } = require('./asset-service');
const steps = require('./playthrough-steps');

const args = process.argv.slice(2);
const PORT = args.includes('--port') ? Number(args[args.indexOf('--port') + 1]) : 8511;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
  if (!ok) failures.push(label);
};

const SNAPSHOT = `(() => { const K = window.KotOR, gs = K.GameState, p = gs.getCurrentPlayer();
  const inv = gs.InventoryManager.inventory.map((i) => [i.getTag(), i.baseItemId, i.getName(), i.getStackSize()]);
  inv.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return { module: gs.module && gs.module.filename, hp: p.getHP(), fp: p.getFP(), maxFp: p.getMaxFP(), x: +p.position.x.toFixed(2), y: +p.position.y.toFixed(2),
    name: p.getName(), right: p.equipment.RIGHTHAND && p.equipment.RIGHTHAND.getTag(), gold: gs.PartyManager.Gold, inv }; })()`;

async function loadSave(harness, name) {
  const ok = await harness.evaluate(`(async () => { const K = window.KotOR; await K.SaveGame.GetSaveGames();
    const s = K.SaveGame.saves.find((x) => (x.getSaveName && x.getSaveName()) === ${JSON.stringify(name)});
    if (!s) return false; K.GameState.MenuManager.ClearMenus();
    K.GameState.SetEngineMode(-1);
    if (K.GameState.module) { K.GameState.module.dispose(); K.GameState.module = undefined; }
    Promise.resolve(s.load()).catch(() => undefined); return true; })()`);
  if (!ok) return false;
  await sleep(1500);
  await harness.waitFor(`(() => { const gs = window.KotOR.GameState; const p = window.KotOR.PartyManager.party[0];
    return !!(gs.module && p && p.position && gs.Mode === 1 && gs.module.readyToProcessEvents === true && !gs.loadingModule); })()`, 240000, 1000);
  await sleep(3000);
  return true;
}

(async () => {
  const service = await startAssetService({ port: PORT });
  await waitForPort(PORT).catch(() => undefined);
  const harness = new VrHarness({ port: PORT + 950, headless: true });
  try {
    await steps.boot(harness, service.url);
    await harness.waitFor(`!!(window.KotOR.GameState.MenuManager.MainMenu && window.KotOR.GameState.MenuManager.MainMenu.bVisible)`, 120000, 1000);
    const other = await harness.evaluate(`(async () => { const K = window.KotOR; await K.SaveGame.GetSaveGames();
      const names = K.SaveGame.saves.map((s) => s.getSaveName && s.getSaveName());
      const mods = K.SaveGame.saves.map((s) => s.getLastModule && s.getLastModule());
      const i = mods.findIndex((m, j) => m && String(m).toLowerCase() !== '102per' && names[j] && !/QUICKSAVE|AUTOSAVE/i.test(names[j]));
      return i >= 0 ? names[i] : null; })()`);
    if (!(await loadSave(harness, 'R15 PREPARED FIGHT'))) { console.log('SKIP  no "R15 PREPARED FIGHT" save'); process.exitCode = 2; return; }
    const fresh = await harness.evaluate(SNAPSHOT);
    console.log('fresh  ', JSON.stringify(fresh));
    // Change the live game: hurt the player, move them, add an item stack.
    await harness.evaluate(`(() => { const gs = window.KotOR.GameState, p = gs.getCurrentPlayer(); p.subtractHP(10); p.position.x += 3;
      const m = gs.InventoryManager.inventory.find((i) => i.baseItemId === 55); if (m) m.setStackSize(m.getStackSize() + 5); })()`);
    await loadSave(harness, 'R15 PREPARED FIGHT');
    const again = await harness.evaluate(SNAPSHOT);
    console.log('reload ', JSON.stringify(again));
    check(JSON.stringify(again.inv) === JSON.stringify(fresh.inv), 'reloading the same save gives the same inventory');
    check(again.hp === fresh.hp && again.x === fresh.x && again.y === fresh.y, 'reloading restores the saved HP and position', `hp ${again.hp}/${fresh.hp} at ${again.x},${again.y}`);
    check(again.gold === fresh.gold, 'reloading restores the saved credits', `${again.gold}/${fresh.gold}`);
    check(fresh.fp > 0 && fresh.fp <= fresh.maxFp, 'Force points read as current, within the max', `${fresh.fp}/${fresh.maxFp}`);
    if (other) {
      await loadSave(harness, other);
      const b = await harness.evaluate(SNAPSHOT);
      console.log('other  ', other, JSON.stringify(b));
      check(b.module !== fresh.module || b.x !== fresh.x, 'a different save puts the player where that save was', `${b.module} ${b.x},${b.y}`);
      check(JSON.stringify(b.inv) !== JSON.stringify(fresh.inv) || b.hp !== fresh.hp, 'a different save has its own player and bag');
    } else {
      console.log('  (no second save to load)');
    }
  } finally {
    await harness.close().catch(() => undefined);
    try { service.stop ? service.stop() : service.child?.kill(); } catch (e) {}
  }
  console.log(failures.length ? `FAILED ${failures.length}` : 'PASSED');
  if (failures.length) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
