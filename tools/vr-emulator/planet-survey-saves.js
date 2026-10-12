/** Create isolated, reload-verified location fixtures; never campaign checkpoints. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { VrHarness } = require('./harness');
const { startAssetService } = require('./asset-service');
const { bootstrapFreshNewGame } = require('../parity/engine-snapshot');
const { enterVrSession } = require('./playthrough-steps');
const { configureParty } = require('./memory-soak');
const { loadModule, landed, runtimeFailures } = require('./probe-memory-growth');

const DESTINATIONS = Object.freeze([
  { name: 'Peragus', module: '101PER' },
  { name: 'Telos', module: '231TEL' },
  { name: 'Nar Shaddaa', module: '301NAR' },
  { name: 'Dxun', module: '401DXN' },
  { name: 'Onderon', module: '501OND' },
  { name: 'Dantooine', module: '601DAN' },
  { name: 'Korriban', module: '701KOR' },
  { name: 'Malachor V', module: '901MAL' },
]);

function nextUnusedSaveId(names) {
  const ids = names.map(name => /^(\d{6}) - Game\d+$/.exec(name))
    .filter(Boolean).map(match => Number(match[1]));
  const next = Math.max(1, ...ids) + 1;
  if (next > 999999) throw new Error('Save slot range exhausted');
  return next;
}

function validateLocation(state, destination) {
  if (!state || state.module !== destination.module || !state.ready || state.loading
    || !state.playerFound || !state.modelFound || !state.presenting
    || !Number.isFinite(state.advancedFrames) || state.advancedFrames < 10
    || state.mode !== 1 || !Number.isFinite(state.hp) || state.hp <= 0
    || !state.position || !['x', 'y', 'z'].every(axis => Number.isFinite(state.position[axis]))) {
    throw new Error(`Survey location is not playable: ${JSON.stringify({ destination, state })}`);
  }
}

function publishSaves(manifestPath, savesRoot) {
  const report = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (report.completed !== true || !Array.isArray(report.saves)
    || report.saves.length !== DESTINATIONS.length || report.published) {
    throw new Error('Manifest must be complete, verified, and not already published');
  }
  const requiredFiles = ['savenfo.res', 'SAVEGAME.sav', 'GLOBALVARS.res', 'PARTYTABLE.res', 'Screen.tga'];
  const sources = DESTINATIONS.map(destination => {
    const matches = report.saves.filter(s => s.name === destination.name && s.module === destination.module && s.reloadVerified);
    if (matches.length !== 1) throw new Error(`Missing verified save: ${destination.name}`);
    const save = matches[0];
    if (!/^Saves[\\/]\d{6} - Game\d+$/.test(save.directory)) throw new Error('Unsafe source save directory');
    const source = path.resolve(report.userRoot, save.directory);
    const root = path.resolve(path.dirname(manifestPath), 'user');
    if (!source.startsWith(root + path.sep)) throw new Error('Save source escaped isolated storage');
    for (const name of requiredFiles) if (!fs.statSync(path.join(source, name)).isFile()) throw new Error(`Missing save file: ${name}`);
    return {save, source};
  });
  fs.mkdirSync(savesRoot, {recursive:true});
  let id = nextUnusedSaveId(fs.readdirSync(savesRoot));
  if (id + sources.length - 1 > 999999) throw new Error('Not enough free save slots');
  report.published = [];
  for (const {save, source} of sources) {
    const folder = `${String(id).padStart(6, '0')} - Game${id - 1}`;
    const target = path.join(savesRoot, folder);
    // Exclusive reservation prevents replacing any existing or concurrently created save.
    fs.mkdirSync(target);
    const hashes = {};
    for (const file of fs.readdirSync(source, {withFileTypes:true})) {
      if (!file.isFile()) throw new Error('Unexpected nested directory in save');
      const sourcePath = path.join(source, file.name), targetPath = path.join(target, file.name);
      fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
      const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
      hashes[file.name] = digest(sourcePath);
      if (digest(targetPath) !== hashes[file.name]) throw new Error(`Copied save hash mismatch: ${file.name}`);
    }
    report.published.push({name:save.name, module:save.module, directory:target, hashes});
    fs.writeFileSync(manifestPath, JSON.stringify(report, null, 2));
    id++;
  }
  return report.published;
}

async function prepareLocation(harness, destination) {
  await harness.waitFor(landed, 300000, 1000);
  const dismissed = await harness.evaluate(`(async () => {
    const gs = window.KotOR.GameState, cm = gs.CutsceneManager;
    const conversations = [];
    // Arrival scripts can enqueue dialogue after the first rendered frame.
    // Bound the survey-only dismissal window and keep the script identity as evidence.
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (cm.active) {
        conversations.push(String(cm.dialog?.resref || 'unknown'));
        cm.endConversation(true);
      }
      gs.MenuManager.InGameOverlay.open();
    }
    return conversations;
  })()`);
  const frame = await harness.evaluate('window.KotOR.GameState.renderer.info.render.frame');
  await harness.waitFor(`window.KotOR.GameState.renderer.info.render.frame >= ${frame + 10}`, 30000, 250);
  const state = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState, p = gs.getCurrentPlayer();
    return { module: String(gs.module?.filename).toUpperCase(), area: gs.module?.area?.areaName?.getValue(),
      ready: gs.module?.readyToProcessEvents === true, loading: gs.loadingModule,
      playerFound: !!p, modelFound: !!p?.model, hp: p?.getHP(), mode: gs.Mode,
      position: p ? {x:p.position.x, y:p.position.y, z:p.position.z} : null,
      dialogueActive: !!gs.CutsceneManager.active, conversation: String(gs.CutsceneManager.dialog?.resref || ''),
      presenting: gs.renderer.xr.isPresenting, advancedFrames: gs.renderer.info.render.frame - ${frame} };
  })()`);
  validateLocation(state, destination);
  return { ...state, openingDialogueDismissed: dismissed };
}

async function main(resumeManifest) {
  const out = resumeManifest ? path.dirname(path.resolve(resumeManifest))
    : fs.mkdtempSync(path.join(__dirname, 'evidence', 'planet-survey-'));
  const userRoot = path.join(out, 'user');
  if (!resumeManifest) fs.mkdirSync(userRoot);
  const report = resumeManifest ? JSON.parse(fs.readFileSync(resumeManifest, 'utf8'))
    : { createdAt: new Date().toISOString(), userRoot, completed: false, saves: [], error: null,
    purpose: 'Direct-warp VR location survey, fresh Exile; story progression is not established.' };
  if (report.completed || report.published || path.resolve(report.userRoot) !== path.resolve(userRoot)) throw new Error('Invalid resume manifest');
  for (let i = 0; i < report.saves.length; i++) {
    if (report.saves[i].name !== DESTINATIONS[i]?.name || !report.saves[i].reloadVerified) throw new Error('Invalid resume sequence');
  }
  report.error = null;
  const persist = () => fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(report, null, 2));
  const harness = new VrHarness({ port: 9451, observeServingBundle: true });
  let service;
  try {
    persist();
    service = await startAssetService({ port: 8491, userRoot });
    await harness.launch(service.url);
    await harness.evaluate(`window.__surveySkip = setInterval(() => {
      const v = window.KotOR?.GameState?.VideoManager;
      if (v?.currentMovie?.skippable) v.skipMovie();
    }, 250); true`);
    await bootstrapFreshNewGame(harness, console.log);
    report.bundle = await harness.getTrustedServingBundle();
    await harness.evaluate(`(() => { const gs = window.KotOR.GameState;
      if (gs.CutsceneManager.active) gs.CutsceneManager.endConversation(true);
      gs.MenuManager.InGameOverlay.open(); return true; })()`);
    await enterVrSession(harness);
    await configureParty(harness, false);
    await harness.evaluate(loadModule('101PER'));
    await prepareLocation(harness, DESTINATIONS[0]);
    await harness.evaluate(`window.KotOR.SaveGame.SaveCurrentGame('Survey baseline', 2)`, { timeoutMs: 180000 });
    for (let i = report.saves.length; i < DESTINATIONS.length; i++) {
      const destination = DESTINATIONS[i];
      console.log(`Creating ${destination.name} (${destination.module})`);
      await harness.evaluate(`(async () => {
        const save = window.KotOR.SaveGame.saves.find(s => s.getSaveNumber() === 2);
        if (!save) throw new Error('Baseline missing');
        window.__memoryProbeLoad = {module: '101PER', error: null};
        await save.load(); return true;
      })()`, { timeoutMs: 180000 });
      await harness.waitFor(landed, 300000, 1000);
      if (destination.module !== '101PER') await harness.evaluate(loadModule(destination.module));
      const before = await prepareLocation(harness, destination);
      const id = i + 3;
      const metadata = await harness.evaluate(`(async () => {
        const K = window.KotOR;
        await K.SaveGame.SaveCurrentGame(${JSON.stringify(destination.name)}, ${id});
        const matches = K.SaveGame.saves.filter(s => s.getSaveNumber() === ${id});
        if (matches.length !== 1) throw new Error('Save not uniquely located');
        const s = matches[0];
        if (s.getSaveName() !== ${JSON.stringify(destination.name)} || String(s.getLastModule()).toUpperCase() !== ${JSON.stringify(destination.module)}) throw new Error('Save metadata mismatch');
        const result = {name:s.getSaveName(), module:String(s.getLastModule()).toUpperCase(), directory:s.directory};
        window.__memoryProbeLoad = {module: result.module, error: null};
        await s.load(); return result;
      })()`, { timeoutMs: 180000 });
      const after = await prepareLocation(harness, destination);
      report.saves.push({ ...metadata, before, after, reloadVerified: true });
      persist();
      console.log(`Verified ${destination.name}: ${after.area}, HP ${after.hp}, XR frames +${after.advancedFrames}`);
      await harness.cdp.send('Runtime.discardConsoleEntries');
      await harness.cdp.send('HeapProfiler.collectGarbage');
    }
    report.runtimeFailures = runtimeFailures(harness.consoleMessages, harness.pageErrors);
    if (report.runtimeFailures.length) throw new Error(report.runtimeFailures.slice(0, 5).join('\n'));
    report.completed = true;
  } catch (error) {
    report.error = String(error.stack || error);
    throw error;
  } finally {
    persist();
    await harness.close();
    if (service) service.stop();
    console.log(`Manifest: ${path.join(out, 'manifest.json')}`);
  }
}

if (require.main === module) {
  if (process.argv[2] === '--publish') {
    try {
      if (!process.argv[3] || !process.argv[4]) throw new Error('Usage: --publish <manifest> <save directory>');
      console.log(publishSaves(path.resolve(process.argv[3]), path.resolve(process.argv[4])));
    } catch (error) { console.error(error); process.exitCode = 1; }
  } else main(process.argv[2] === '--resume' ? process.argv[3] : undefined)
    .catch(error => { console.error(error); process.exitCode = 1; });
}
module.exports = { DESTINATIONS, nextUnusedSaveId, validateLocation, publishSaves };
