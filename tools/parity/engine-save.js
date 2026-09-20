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
const { assertCanonicalEngineState, assertModuleLoadResult, bootstrapFreshNewGame } = require('./engine-snapshot');

function parseArgs(argv) {
  const args = { module: '101PER', canonical: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--module') {
      const moduleName = argv[++i];
      if (!moduleName || moduleName.startsWith('--')) throw new Error('--module requires a module name');
      args.module = moduleName.toUpperCase();
    } else if (argv[i] === '--canonical') {
      args.canonical = true;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const moduleName = args.module;
  const service = await startAssetService();
  const harness = new VrHarness({ port: 9448 });
  try {
    await harness.launch(service.url);
    await bootstrapFreshNewGame(harness, console.log);
    console.log(`loading ${moduleName}...`);
    const folder = await harness.evaluate(`(async () => {
      const K = window.KotOR, GS = K.GameState;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      GS.loadingModule = false;
      try { GS.MenuManager.ClearMenus(); } catch (e) {}
      const previous = GS.module;
      // Preserve this value from before LoadModule. Loading itself can write
      // gameinprogress, which must not turn an initially fresh module into a
      // false save-derived rejection.
      let loadedFromSave = null;
      try { loadedFromSave = !!(await K.CurrentGame.IsModuleSaved(${JSON.stringify(moduleName)})); } catch (e) { /* unknown */ }
      let loadError = null;
      Promise.resolve(GS.LoadModule(${JSON.stringify(moduleName)})).catch((error) => {
        loadError = String((error && error.stack) || error);
      });
      const deadline = Date.now() + 300000;
      while (Date.now() < deadline) {
        if (loadError) return { error: 'LoadModule threw: ' + loadError };
        if (GS.module && GS.module !== previous && GS.loadingModule === false
            && GS.module.readyToProcessEvents === true && GS.module.area) break;
        await sleep(500);
      }
      if (loadError) return { error: 'LoadModule threw: ' + loadError };
      if (!(GS.module && GS.module !== previous && GS.loadingModule === false
          && GS.module.readyToProcessEvents === true && GS.module.area)) {
        return { error: 'module did not settle before timeout' };
      }
      await sleep(8000);
      const party = K.PartyManager && K.PartyManager.party;
      const player = Array.isArray(party) ? party[0] : null;
      const state = {
        loadedFromSave,
        bootstrap: 'new-game-ui',
        module: String(GS.module.filename || ''),
        playerName: player && player.getName ? String(player.getName() || '') : '',
        partySize: Array.isArray(party) ? party.length : null,
      };
      return { state };
    })()`, { timeoutMs: 420_000 });
    const state = assertModuleLoadResult(folder, moduleName);
    if (args.canonical) assertCanonicalEngineState(state);
    folder.folder = await harness.evaluate(`(async () => {
        const before = new Set(window.KotOR.SaveGame.saves.map((save) => save.folderName));
        await window.KotOR.SaveGame.SaveCurrentGame('parity ${moduleName}');
        return window.KotOR.SaveGame.saves.map((save) => save.folderName)
          .find((name) => !before.has(name)) || null;
      })()`, { timeoutMs: 120_000 });
    if (!folder.folder) throw new Error('SaveCurrentGame did not add a save');
    console.log(path.join(service.userRoot || path.join(process.env.LOCALAPPDATA, 'Kotor2VR'), 'Saves', folder.folder));
  } finally {
    await harness.close();
    service.stop();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = { parseArgs };
