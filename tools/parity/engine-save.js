/**
 * Writes a fresh save with the current build, for save_schema.py to check.
 *
 * Boots like `vr:sweep`, warps into a module, lets it settle, and calls
 * SaveGame.SaveCurrentGame. The save lands in the harness user root
 * (%LOCALAPPDATA%\Kotor2VR\Saves), never the retail install's saves folder.
 *
 *   node tools/parity/engine-save.js --module 101PER
 *
 * Prints the new save folder's absolute path as its last line.
 */
const path = require('path');
const { VrHarness } = require('../vr-emulator/harness');
const { startAssetService } = require('../vr-emulator/asset-service');
const { bootEngine } = require('../vr-emulator/module-sweep');

async function main() {
  const i = process.argv.indexOf('--module');
  const moduleName = (i > -1 ? process.argv[i + 1] : '101PER').toUpperCase();
  const service = await startAssetService();
  const harness = new VrHarness({ port: 9448 });
  try {
    await harness.launch(service.url);
    await bootEngine(harness, console.log, true);
    console.log(`loading ${moduleName}...`);
    const folder = await harness.evaluate(`(async () => {
      const K = window.KotOR, GS = K.GameState;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      GS.loadingModule = false;
      try { GS.MenuManager.ClearMenus(); } catch (e) {}
      const previous = GS.module;
      Promise.resolve(GS.LoadModule(${JSON.stringify(moduleName)})).catch(() => undefined);
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        if (GS.module && GS.module !== previous && GS.loadingModule === false
            && GS.module.readyToProcessEvents === true && GS.module.area) break;
        await sleep(500);
      }
      await sleep(8000);
      const before = new Set(K.SaveGame.saves.map((s) => s.folderName));
      await K.SaveGame.SaveCurrentGame('parity ${moduleName}');
      const created = K.SaveGame.saves.map((s) => s.folderName).filter((f) => !before.has(f));
      return created[0] || null;
    })()`, { timeoutMs: 420_000 });
    if (!folder) throw new Error('SaveCurrentGame did not add a save');
    console.log(path.join(service.userRoot || path.join(process.env.LOCALAPPDATA, 'Kotor2VR'), 'Saves', folder));
  } finally {
    await harness.close();
    service.stop();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
