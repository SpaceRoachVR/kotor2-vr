/**
 * Engine side of the parity check: what our build actually loaded.
 *
 * Boots the browser build, establishes a party through the visible fresh
 * new-game path, warps into one module, lets it settle, and dumps the
 * fields `retail_snapshot.py` reads from the retail data:
 *
 *   - every creature in the area: template, attributes, HP/FP, saves, classes,
 *     feats, skills, equipment, appearance fields
 *   - every texture routing decision TextureLoader recorded for that module
 *
 *   node tools/parity/engine-snapshot.js --module 101PER
 *   node tools/parity/engine-snapshot.js --module 101PER --url "<launch url>"
 *
 * Like module-probe.js, nothing here is JSON.stringify'd inside the page: every
 * value is copied into a plain object by hand, because engine objects hold
 * THREE textures that warn on serialisation.
 *
 * Reads the build in dist/. If src/ has changed since the last webpack build,
 * this measures the old code — `buildStamp`/`bundleMtime` in the output say which.
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('../vr-emulator/harness');
const { startAssetService } = require('../vr-emulator/asset-service');
const {
  waitForMenu, newGameThroughCharacterCreation, useTaggedWorldObject,
  dialogueSnapshot, sleep, findObjectByTag, enterVrSession, playDialogue,
} = require('../vr-emulator/playthrough-steps');
const { clickButtonByText, TIMEOUTS } = require('../vr-emulator/playthrough');
const { assertCanonicalEngineState } = require('./canonical-state');

const OUT_DIR = path.join(__dirname, 'out');
const LOAD_TIMEOUT_MS = 300_000;
const SETTLE_MS = 8_000;

function parseArgs(argv) {
  const args = { module: null, url: null, port: 9447, canonical: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module') args.module = argv[++i];
    else if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--canonical') args.canonical = true;
  }
  if (!args.module) throw new Error('usage: node tools/parity/engine-snapshot.js --module 101PER [--url <url>]');
  return args;
}

function normalizeModuleName(moduleName, fieldName) {
  if (typeof moduleName !== 'string' || !moduleName.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty module name`);
  }
  return moduleName.trim().toUpperCase();
}

function assertRequestedModuleIdentity(actualModule, requestedModule) {
  const actual = normalizeModuleName(actualModule, 'Loaded module');
  const requested = normalizeModuleName(requestedModule, 'Requested module');
  if (actual !== requested) {
    throw new Error(`Canonical parity capture rejected: module mismatch (requested ${requested}, loaded ${actual})`);
  }
  return actual;
}

function assertModuleLoadResult(result, requestedModule) {
  if (!result || typeof result !== 'object') {
    throw new TypeError('Module load did not return a result');
  }
  if (typeof result.error === 'string' && result.error.trim()) {
    throw new Error(result.error);
  }
  if (!result.state || typeof result.state !== 'object') {
    throw new TypeError('Module load did not return settled state');
  }
  assertRequestedModuleIdentity(result.state.module, requestedModule);
  return result.state;
}

function createEngineIdentity(state, metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new TypeError('Engine identity requires metadata');
  }
  for (const field of ['servingBundleSha256']) {
    if (typeof metadata[field] !== 'string' || !metadata[field].trim()) {
      throw new TypeError(`Engine identity requires ${field}`);
    }
  }
  if (!/^[a-f0-9]{64}$/i.test(metadata.servingBundleSha256)) {
    throw new TypeError('Engine identity requires a verified serving bundle SHA-256');
  }
  assertCanonicalEngineState(state, metadata.requestedModule);
  return Object.freeze({
    module: normalizeModuleName(state && state.module, 'Loaded module'),
    freshState: true,
    loadedFromSave: state.loadedFromSave,
    engineCommit: metadata.engineCommit,
    bundleMtime: metadata.bundleMtime,
    servingBundleSha256: metadata.servingBundleSha256.toLowerCase(),
  });
}

/**
 * Establish a party through the visible new-game route.  Canonical capture
 * deliberately never delegates to module-sweep's save-loading bootstrap:
 * save-derived state can make an unvisited target look clean while preserving
 * a foreign party and globals.
 */
async function awaitBootReadyForNewGame(harness, log) {
  await harness.waitFor(`(() => {
    const eulaVisible = Array.from(document.querySelectorAll('button')).some((button) =>
      (button.textContent || '').trim() === 'OK' &&
      button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0
    );
    const menus = window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager;
    return eulaVisible || !!(menus && menus.MainMenu && menus.MainMenu.bVisible);
  })()`, 90_000);
  const eulaVisible = await harness.evaluate(`Array.from(document.querySelectorAll('button')).some((button) =>
    (button.textContent || '').trim() === 'OK' &&
    button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0
  )`);
  if (eulaVisible) {
    await clickButtonByText(harness, 'OK');
    log('EULA accepted for fresh new-game bootstrap');
  }
  await harness.waitFor(
    `document.querySelector('#vr-spike-button') && !document.querySelector('#vr-spike-button').disabled`,
    TIMEOUTS.boot, 2000,
  );
}

async function bootstrapFreshNewGame(harness, log) {
  await awaitBootReadyForNewGame(harness, log);
  await waitForMenu(harness, 'MainMenu', 90_000);
  await newGameThroughCharacterCreation(harness);
  const provenance = await harness.evaluate(`(() => {
    const K = window.KotOR;
    const party = K.PartyManager && K.PartyManager.party;
    return {
      bootstrap: 'new-game-ui',
      partyPresent: Array.isArray(party) && party.length > 0,
      saveLoadInvoked: false,
      currentModule: K.GameState && K.GameState.module ? String(K.GameState.module.filename || '') : null,
    };
  })()`);
  if (!provenance.partyPresent || provenance.saveLoadInvoked !== false) {
    throw new Error('Fresh new-game bootstrap did not establish an unsaved party');
  }
  log(`fresh new-game bootstrap established in ${provenance.currentModule || 'unknown module'}`);
  return provenance;
}

async function identifyServingBundle(harness) {
  if (!harness || typeof harness.getTrustedServingBundle !== 'function') {
    throw new TypeError('Canonical serving build identification requires trusted external CDP observation');
  }
  const identity = await harness.getTrustedServingBundle();
  if (!identity || typeof identity.url !== 'string' || !/^[a-f0-9]{64}$/i.test(identity.sha256 || '')) {
    throw new Error('Cannot identify serving build from authenticated browser response');
  }
  let verifiedUrl;
  try { verifiedUrl = new URL(identity.url); } catch (_) { throw new Error('Cannot identify serving build from authenticated browser response'); }
  if (!['http:', 'https:'].includes(verifiedUrl.protocol) || verifiedUrl.username || verifiedUrl.password || verifiedUrl.search || verifiedUrl.hash) {
    throw new Error('Cannot retain an unsafe serving bundle URL');
  }
  const identityPath = /^\/bundles\/([a-f0-9]{64})\/KotOR\.js$/.exec(verifiedUrl.pathname);
  if (!identityPath || identityPath[1].toLowerCase() !== identity.sha256.toLowerCase()) {
    throw new Error('Cannot retain a serving bundle without an immutable executed-byte identity');
  }
  return Object.freeze({ url: verifiedUrl.toString(), sha256: identity.sha256.toLowerCase() });
}

function createSnapshotArtifact(snapshot, { externalUrl = false, buildStamp = null, bundleMtime = null } = {}) {
  return {
    ...snapshot,
    schema: 'kotor2-vr/parity-engine@1',
    capturedAt: new Date().toISOString(),
    buildStamp: externalUrl ? null : buildStamp,
    bundleMtime: externalUrl ? null : bundleMtime,
  };
}

const MEDCOM_INTERACTION_ID = '101per:medcom:medical-log-1';
const MEDCOM_GLOBAL = '101PER_Med_Log';

function createMedcomReplyChooser() {
  let step = 0;
  return (replies, snapshot) => {
    if (!Array.isArray(replies) || !snapshot || String(snapshot.conversationName).toLowerCase() !== 'medlog') {
      throw new Error('MedCom dialogue is not the authored medlog conversation');
    }
    const normalized = replies.map((reply) => String(reply).trim().replace(/^\d+\.\s*/, '').toLowerCase());
    const wantedText = step === 0 ? 'access medical logs.' : 'access log 253-12.';
    const matches = normalized.flatMap((reply, index) => reply === wantedText ? [index] : []);
    if (matches.length !== 1) throw new Error(`MedCom dialogue did not offer one ${wantedText} reply`);
    const index = matches[0];
    if (step === 1 && String(snapshot.replyScripts && snapshot.replyScripts[index]).toLowerCase() !== 'a_setmedlog1') {
      throw new Error('MedCom Access Log 253-12. reply did not carry a_setmedlog1');
    }
    if (step > 1) throw new Error('MedCom medical-log-1 interaction already selected');
    step += 1;
    return index;
  };
}

const MEDBAY_ROUTE_DOOR_TAG = 'peragusdoor1';
const MEDBAY_DOOR_RADIUS_METRES = 10;

/**
 * The route to MedCom crosses the medbay's own two doors, and the approach
 * refuses every door it was not given. Approve exactly those: unlocked
 * PeragusDoor1 doors within 10m of MedCom (measured live: 7.8m and 5.2m, the
 * next PeragusDoor1 is ~23m off). Nothing locked, plot or further away is
 * approved, so the trace cannot wander through unrelated parts of the module.
 */
function selectMedbayRouteDoors(matches, medcomPosition) {
  if (!Array.isArray(matches)) throw new TypeError('Medbay door candidates must be an array');
  if (!medcomPosition || ![medcomPosition.x, medcomPosition.y].every(Number.isFinite)) {
    throw new TypeError('MedCom position is required to select its doors');
  }
  const near = matches.filter((match) => match && match.kind === 'door' &&
    String(match.tag).toLowerCase() === MEDBAY_ROUTE_DOOR_TAG &&
    typeof match.promptId === 'string' && match.promptId.length > 0 &&
    match.position && Number.isFinite(match.position.x) && Number.isFinite(match.position.y) &&
    Math.hypot(match.position.x - medcomPosition.x, match.position.y - medcomPosition.y) <= MEDBAY_DOOR_RADIUS_METRES);
  if (!near.length) throw new Error('No PeragusDoor1 door was located beside MedCom');
  const unknown = near.find((door) => door.locked !== false);
  if (unknown) throw new Error(`Medbay door ${unknown.promptId} is not known to be unlocked`);
  return near.map((door) => door.promptId).sort();
}

function buildMedcomBehaviorChain(observation) {
  const missing = (reason) => ({
    coverage: 'missing-evidence', interactionId: MEDCOM_INTERACTION_ID,
    eventDispatchLocated: false, actionQueueLocated: false, resultStateLocated: false,
    reason,
  });
  if (!observation || typeof observation !== 'object') return missing('No MedCom interaction observation');
  if (observation.failure) return missing(String(observation.failure));
  const { target, before, action, event, reply, after } = observation;
  if (!target || target.located !== true || !Number.isInteger(target.id) ||
      String(target.tag).toLowerCase() !== 'medcom' ||
      String(target.onUsedScript).toLowerCase() !== 'a_compdlg') {
    return missing('MedCom target and authored OnUsed script were not located');
  }
  if (!before || before.located !== true || before.declared !== true || before.value !== 0) {
    return missing('Fresh declared medical-log global was not observed at zero');
  }
  if (!action || action.located !== true || action.name !== 'ActionUseObject' ||
      action.targetId !== target.id || !Number.isInteger(action.sequence)) {
    return missing('Targeted ActionUseObject was not observed in the player action queue');
  }
  if (!event || event.located !== true || event.name !== 'OnUsed' ||
      String(event.scriptName).toLowerCase() !== 'a_compdlg' ||
      !Number.isInteger(event.sequence) || event.sequence <= action.sequence) {
    return missing('MedCom OnUsed script execution was not observed after the use action');
  }
  if (!reply || reply.located !== true ||
      String(reply.scriptName).toLowerCase() !== 'a_setmedlog1' ||
      !Number.isInteger(reply.sequence) || reply.sequence <= event.sequence) {
    const ran = Array.isArray(observation.scriptRuns)
      ? observation.scriptRuns.filter((run) => run.sequence > event.sequence).slice(0, 12).map((run) => run.name).join(', ')
      : '';
    return missing(`Authored a_setmedlog1 reply execution was not observed after OnUsed${ran ? ` (scripts run after OnUsed: ${ran})` : ''}`);
  }
  if (!after || after.located !== true || after.declared !== true || after.value !== 1) {
    return missing('Declared medical-log global did not transition to one');
  }
  return {
    coverage: 'complete', interactionId: MEDCOM_INTERACTION_ID,
    eventDispatchLocated: true, actionQueueLocated: true, resultStateLocated: true,
    actionEventTrace: [
      { action: 'ActionUseObject', event: 'OnUsed' },
      { action: 'selectReply', event: 'a_setmedlog1' },
    ],
    resultState: { globalNumber: { [MEDCOM_GLOBAL]: after.value } },
    beforeState: { globalNumber: { [MEDCOM_GLOBAL]: before.value } },
  };
}

/**
 * Puts the freshly loaded 101PER into a state where the player can act, before
 * any trace hook is installed.
 *
 * Measured on the live page, not assumed: after the static snapshot the
 * controlled character is T3-M4, the opening conversation is still running,
 * and no immersive session is presenting - every approach is driven by the VR
 * stick, so without one the player never moves and each attempt "falls short"
 * at the spawn distance. Mirror the playthrough: enter VR, play the opening
 * conversation out, then require INGAME (Mode 1). Doing this before the hooks
 * keeps the opening conversation's reply scripts out of the MedCom evidence.
 */
const PROLOGUE_CARRYOVER_CONVERSATION = 'intro';

async function prepareMedcomApproach(harness) {
  await enterVrSession(harness);
  let opening = await dialogueSnapshot(harness);
  // The direct load out of 001EBO carries the prologue's `intro` conversation
  // (the Ebon Hawk text crawl) into 101PER with its menu hidden, so skipping
  // lines never ends it; a player cannot reach 101PER with it open. End only
  // that carried-over conversation, the way the DialogAbort key does, and play
  // any genuine 101PER conversation out normally.
  if (String(opening.conversationName || '').toLowerCase() === PROLOGUE_CARRYOVER_CONVERSATION) {
    await harness.evaluate(`(() => {
      const cm = window.KotOR.GameState.CutsceneManager;
      if (cm.active) cm.endConversation(true);
      return true;
    })()`);
    await sleep(1000);
    opening = await dialogueSnapshot(harness);
  }
  if (opening.visible || opening.engineMode === 3) {
    const played = await playDialogue(harness, { label: '101PER opening conversation' });
    if (!played.finished) throw new Error('101PER opening conversation did not finish');
  }
  const modeBefore = await harness.evaluate(`(() => {
    const gs = window.KotOR.GameState;
    const before = gs.Mode;
    if (gs.Mode !== 1) gs.MenuManager.InGameOverlay.open();
    return before;
  })()`);
  try {
    await harness.waitFor('window.KotOR.GameState.Mode === 1', 10_000, 250);
  } catch (error) {
    throw new Error(`101PER did not reach INGAME mode for the MedCom trace (mode was ${modeBefore})`);
  }
}

async function captureMedcomBehaviorChain(harness) {
  try {
    await prepareMedcomApproach(harness);
  } catch (error) {
    return buildMedcomBehaviorChain({ failure: String(error && error.message || error) });
  }
  const setup = await harness.evaluate(`(() => {
    const K = window.KotOR;
    const GS = K && K.GameState;
    const area = GS && GS.module && GS.module.area;
    const player = K && K.PartyManager && K.PartyManager.party && K.PartyManager.party[0];
    const manager = GS && GS.GlobalVariableManager;
    const table = manager && manager.Globals && manager.Globals.Number;
    const targets = area && Array.isArray(area.placeables)
      ? area.placeables.filter((item) => item && String(item.tag).toLowerCase() === 'medcom') : [];
    const target = targets.length === 1 ? targets[0] : null;
    const onUsed = target && target.scripts && target.scripts.OnUsed;
    const observation = {
      target: { located: !!target, id: target ? target.id : null, tag: target ? String(target.tag) : null,
        onUsedScript: onUsed ? String(onUsed.name) : null },
      before: { located: table instanceof Map, declared: table instanceof Map && table.has('101per_med_log'),
        value: table instanceof Map && table.has('101per_med_log') ? table.get('101per_med_log').value : null },
      action: null, event: null, reply: null, after: null,
    };
    if (!target || !onUsed || !player || !player.actionQueue || !GS.CutsceneManager ||
        !(table instanceof Map) || !table.has('101per_med_log')) return { installed: false, observation };
    const queue = player.actionQueue;
    // Scripts are observed where every one of them passes: the shared
    // NWScriptInstance.prototype.run. Patching the reply node's own instance
    // missed a_setmedlog1 on the live page while the global still changed, so
    // per-instance hooks cannot prove the reply did or did not run.
    const scriptProto = K.NWScriptInstance && K.NWScriptInstance.prototype;
    const originalAdd = queue.add;
    const originalScriptRun = scriptProto && scriptProto.run;
    if (typeof originalAdd !== 'function' || typeof originalScriptRun !== 'function') {
      return { installed: false, observation };
    }
    observation.scriptRuns = [];
    let sequence = 0;
    queue.add = function(action) {
      if (action && action.constructor && action.constructor.name === 'ActionUseObject') {
        const useTarget = typeof action.getParameter === 'function' ? action.getParameter(0) : null;
        if (useTarget && useTarget.id === target.id) {
          observation.action = { located: true, name: 'ActionUseObject', targetId: useTarget.id, sequence: ++sequence };
        }
      }
      return originalAdd.apply(this, arguments);
    };
    scriptProto.run = function(caller) {
      const name = String(this && this.name || '').toLowerCase();
      const callerId = caller && Number.isInteger(caller.id) ? caller.id : null;
      const entry = { name, callerId, sequence: ++sequence };
      if (observation.scriptRuns.length < 200) observation.scriptRuns.push(entry);
      // OnUsed is the placeable's own OnUsed instance, run on MedCom itself.
      if (!observation.event && this === onUsed && callerId === target.id) {
        observation.event = { located: true, name: 'OnUsed', scriptName: name, sequence: entry.sequence };
      }
      if (!observation.reply && observation.event && name === 'a_setmedlog1') {
        observation.reply = { located: true, scriptName: name, sequence: entry.sequence };
      }
      return originalScriptRun.apply(this, arguments);
    };
    window.__parityMedcomTrace = {
      observation,
      finish() {
        queue.add = originalAdd;
        scriptProto.run = originalScriptRun;
        observation.after = { located: true, declared: table.has('101per_med_log'),
          value: table.has('101per_med_log') ? table.get('101per_med_log').value : null };
        delete window.__parityMedcomTrace;
        return observation;
      },
    };
    return { installed: true, observation: { target: observation.target, before: observation.before } };
  })()`);
  if (!setup || setup.installed !== true) return buildMedcomBehaviorChain(setup && setup.observation);

  let failure = null;
  try {
    const medcoms = (await findObjectByTag(harness, 'MedCom')).filter((match) => match.kind === 'placeable');
    if (medcoms.length !== 1) throw new Error(`Expected one MedCom placeable, found ${medcoms.length}`);
    const routeDoors = selectMedbayRouteDoors(await findObjectByTag(harness, 'PeragusDoor1'), medcoms[0].position);
    await useTaggedWorldObject(harness, { tag: 'MedCom', actionPattern: /^Use:/i, permittedDoorPromptIds: routeDoors });
    await harness.waitFor(`(() => {
      const gs = window.KotOR.GameState;
      const menu = gs.MenuManager && gs.MenuManager.InGameComputer;
      return gs.Mode === 3 && menu && menu.bVisible === true;
    })()`, 20_000, 400);
    const choose = createMedcomReplyChooser();
    let selected = 0;
    for (let turn = 0; turn < 60 && selected < 2; turn += 1) {
      const snapshot = await dialogueSnapshot(harness, 'InGameComputer');
      if (!snapshot.located || String(snapshot.conversationName).toLowerCase() !== 'medlog') {
        throw new Error(`MedCom did not open medlog dialogue: ${JSON.stringify(snapshot)}`);
      }
      if (snapshot.state === 1 && snapshot.visible) {
        const index = choose(snapshot.replies, snapshot);
        const picked = await harness.evaluate(`(() => {
          try { window.KotOR.GameState.CutsceneManager.selectReplyAtIndex(${index}); return { ok: true }; }
          catch (error) { return { ok: false, reason: String(error && error.message || error) }; }
        })()`);
        if (!picked || picked.ok !== true) throw new Error(`MedCom reply selection failed: ${picked && picked.reason}`);
        selected += 1;
      } else {
        await harness.evaluate(`(() => {
          const cm = window.KotOR.GameState.CutsceneManager;
          if (cm && cm.currentEntry) cm.playerSkipEntry(cm.currentEntry);
        })()`);
      }
      await sleep(500);
    }
    if (selected !== 2) throw new Error('MedCom did not reach a_setmedlog1 within 60 dialogue turns');
    await harness.waitFor(`window.KotOR.GameState.GlobalVariableManager.GetGlobalNumber('101PER_Med_Log') === 1`, 15_000, 400);
  } catch (error) {
    failure = String(error && error.message || error);
  }
  const observation = await harness.evaluate(`window.__parityMedcomTrace && window.__parityMedcomTrace.finish()`);
  return buildMedcomBehaviorChain({ ...observation, failure });
}

function buildSnapshotSource(moduleName) {
  return `(async () => {
  const NAME = ${JSON.stringify(moduleName.toUpperCase())};
  const K = window.KotOR, GS = K.GameState;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const attempt = (fn, fallback) => { try { const v = fn(); return v === undefined ? fallback : v; } catch (e) { return fallback; } };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : (v == null ? null : Number(v));

  // Same load discipline as module-probe.js: reset a latched loadingModule and
  // require a DIFFERENT module object, fully built, before measuring.
  GS.loadingModule = false;
  attempt(() => GS.MenuManager.ClearMenus());
  const previous = GS.module;
  // A module the save already visited loads from gameinprogress, not its
  // pristine RIM, so creatures carry saved HP, deaths and inventory. Ask the
  // engine's own test (Module.GetModuleArchives uses it) before loading, since
  // loading can itself write the module into gameinprogress.
  let loadedFromSave = null;
  try { loadedFromSave = !!(await K.CurrentGame.IsModuleSaved(NAME)); } catch (e) { /* unknown */ }
  const diagBefore = attempt(() => K.TextureLoader.routingDiagnostics.length, 0);
  let threw = null;
  Promise.resolve(GS.LoadModule(NAME)).catch((e) => { threw = String((e && e.stack) || e); });
  const deadline = Date.now() + ${LOAD_TIMEOUT_MS};
  while (Date.now() < deadline) {
    if (threw) return { error: 'LoadModule threw: ' + threw };
    if (attempt(() => GS.module && GS.module !== previous && GS.loadingModule === false
        && GS.module.readyToProcessEvents === true && !!GS.module.area, false)) break;
    await sleep(500);
  }
  if (threw) return { error: 'LoadModule threw: ' + threw };
  if (!attempt(() => GS.module && GS.module !== previous && GS.loadingModule === false
      && GS.module.readyToProcessEvents === true && !!GS.module.area, false)) {
    return { error: 'module did not settle before timeout' };
  }
  await sleep(${SETTLE_MS});

  const creatures = [];
  const area = GS.module.area;
  const list = Array.isArray(area.creatures) ? area.creatures : [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const equipment = {};
    const equipmentTags = {};
    const eq = attempt(() => c.equipment, {}) || {};
    for (const slot of Object.keys(eq)) {
      const item = eq[slot];
      if (!item) continue;
      // Items built from a UTC's Equip_ItemList carry only EquippedRes; a full
      // UTI template carries TemplateResRef. Take whichever is non-empty.
      const res = attempt(() => item.equippedRes, '') || attempt(() => item.getTemplateResRef(), '') || attempt(() => item.templateResRef, '');
      equipment[slot] = String(res || '').toLowerCase();
      // Saved modules (and retail saves) store equipped items as full structs
      // with no resref at all, so the tag is the only identity left to compare.
      equipmentTags[slot] = String(attempt(() => item.getTag(), attempt(() => item.tag, '')) || '').toLowerCase();
    }
    creatures.push({
      areaIndex: i,
      template: String(attempt(() => c.getTemplateResRef(), '') || '').toLowerCase(),
      tag: attempt(() => c.getTag(), null),
      appearance: num(attempt(() => c.appearance, null)),
      race: num(attempt(() => c.race, null)),
      subrace: num(attempt(() => c.subrace, null)),
      gender: num(attempt(() => c.gender, null)),
      portraitId: num(attempt(() => c.portraitId, null)),
      soundSetFile: num(attempt(() => c.soundSetFile, null)),
      factionId: num(attempt(() => c.factionId, null)),
      bodyVariation: num(attempt(() => c.bodyVariation, null)),
      textureVar: num(attempt(() => c.textureVar, null)),
      goodEvil: num(attempt(() => c.goodEvil, null)),
      challengeRating: num(attempt(() => c.challengeRating, null)),
      naturalAC: num(attempt(() => c.naturalAC, null)),
      str: num(attempt(() => c.str, null)), dex: num(attempt(() => c.dex, null)),
      con: num(attempt(() => c.con, null)), int: num(attempt(() => c.int, null)),
      wis: num(attempt(() => c.wis, null)), cha: num(attempt(() => c.cha, null)),
      hitPoints: num(attempt(() => c.hitPoints, null)),
      currentHitPoints: num(attempt(() => c.currentHitPoints, null)),
      maxHitPoints: num(attempt(() => c.maxHitPoints, null)),
      forcePoints: num(attempt(() => c.forcePoints, null)),
      maxForcePoints: num(attempt(() => c.maxForcePoints, null)),
      fortbonus: num(attempt(() => c.fortbonus, null)),
      refbonus: num(attempt(() => c.refbonus, null)),
      willbonus: num(attempt(() => c.willbonus, null)),
      isHologram: !!attempt(() => c.isHologram, false),
      plot: !!attempt(() => c.plot, false),
      min1HP: !!attempt(() => c.min1HP, false),
      classes: (attempt(() => c.classes, []) || []).map((k) => ({
        id: num(attempt(() => k.id, null)),
        level: num(attempt(() => k.level, null)),
        powers: (attempt(() => k.spells, []) || []).map((s) => num(attempt(() => s.id, null))).sort((a, b) => a - b),
      })),
      feats: (attempt(() => c.feats, []) || []).map((f) => num(attempt(() => f.id, null))).sort((a, b) => a - b),
      skills: (attempt(() => c.skills, []) || []).map((s) => num(attempt(() => s.rank, null))),
      equipment,
      equipmentTags,
      // Runtime-derived values, reported for context; retail has no template equivalent.
      runtime: {
        maxHP: num(attempt(() => c.getMaxHP(), null)),
        ac: num(attempt(() => c.getAC(), null)),
      },
    });
  }

  const textures = [];
  const diags = attempt(() => K.TextureLoader.routingDiagnostics, []) || [];
  for (let i = diagBefore; i < diags.length; i++) {
    const d = diags[i];
    textures.push({
      requestedResref: d.requestedResref, resolvedResref: d.resolvedResref || null,
      semantic: d.semantic, activeModule: d.activeModule || null,
      status: d.status, selectedSource: d.selectedSource,
      searchedSources: Array.from(d.searchedSources || []),
      fallback: d.fallback || null, diagnosticCode: d.diagnosticCode || null,
      ownerModelName: d.ownerModelName || null, ownerObjectTag: d.ownerObjectTag || null,
    });
  }

  // Audio: the area's music/ambience ids and every placed sound object, with
  // which of its files the emitter actually decoded (AudioEmitter.buffers).
  const audioProps = attempt(() => area.audio, {}) || {};
  const audio = {
    area: {
      MusicDay: num(attempt(() => audioProps.music.day, null)),
      MusicNight: num(attempt(() => audioProps.music.night, null)),
      MusicBattle: num(attempt(() => audioProps.music.battle, null)),
      MusicDelay: num(attempt(() => audioProps.music.delay, null)),
      AmbientSndDay: num(attempt(() => audioProps.ambient.day, null)),
      AmbientSndNight: num(attempt(() => audioProps.ambient.night, null)),
      AmbientSndDayVol: num(attempt(() => audioProps.ambient.dayVolume, null)),
      AmbientSndNitVol: num(attempt(() => audioProps.ambient.nightVolume, null)),
      EnvAudio: num(attempt(() => audioProps.environmentAudio, null)),
    },
    sounds: (attempt(() => area.sounds, []) || []).map((snd, i) => {
      const emitter = attempt(() => snd.audioEmitter, null);
      const buffers = emitter && emitter.buffers ? Array.from(emitter.buffers.keys()).map((k) => String(k).toLowerCase()) : null;
      return {
        areaIndex: i,
        template: String(attempt(() => snd.templateResRef, '') || attempt(() => snd.getTemplateResRef(), '') || '').toLowerCase(),
        tag: attempt(() => snd.tag, null),
        active: !!attempt(() => snd.active, false), continuous: !!attempt(() => snd.continuous, false),
        looping: !!attempt(() => snd.looping, false), positional: !!attempt(() => snd.positional, false),
        random: !!attempt(() => snd.random, false), randomPosition: !!attempt(() => snd.randomPosition, false),
        interval: num(attempt(() => snd.interval, null)), intervalVariation: num(attempt(() => snd.intervalVariation, null)),
        volume: num(attempt(() => snd.volume, null)), volumeVariation: num(attempt(() => snd.volumeVariation, null)),
        maxDistance: num(attempt(() => snd.maxDistance, null)), minDistance: num(attempt(() => snd.minDistance, null)),
        priority: num(attempt(() => snd.priority, null)), times: num(attempt(() => snd.times, null)),
        // AudioEmitter has no public play-style field. Keep that absence
        // explicit rather than reading a nonexistent runtime property; the
        // observable UTS-equivalent settings above remain the evidence.
        playStyle: null,
        playStyleAvailable: false,
        sounds: (attempt(() => snd.soundResRefs, []) || []).map((n) => String(n).toLowerCase()),
        decoded: buffers,
      };
    }),
  };

  // Placeables may intentionally use creature MDLs as static props. Capture
  // the object/model state without changing model animation ownership.
  const modelPresentation = (attempt(() => area.placeables, []) || []).map((placeable, i) => {
    const model = attempt(() => placeable.model, null);
    const manager = attempt(() => model && model.animationManager, null);
    const currentAnimation = attempt(() => manager && manager.currentAnimation && manager.currentAnimation.name, null);
    const requestedAnimation = attempt(() => {
      const state = placeable.animStateInfo && placeable.animStateInfo.currentAnimState;
      const animation = state == null || typeof placeable.animationConstantToAnimation !== 'function'
        ? null : placeable.animationConstantToAnimation(state);
      return animation && animation.name ? animation.name : null;
    }, null);
    const modelName = attempt(() => model && model.name, null);
    return {
      areaIndex: i,
      template: String(attempt(() => placeable.templateResRef, '') || attempt(() => placeable.getTemplateResRef(), '') || '').toLowerCase(),
      objectType: 'placeable',
      modelKind: attempt(() => model && model.constructor && model.constructor.name, null),
      modelPresent: model !== null,
      modelStatus: model === null ? 'missing' : (manager === null ? 'unresolved' : 'loaded'),
      modelName: modelName == null ? null : String(modelName).toLowerCase(),
      requestedAnimation: requestedAnimation == null ? null : String(requestedAnimation).toLowerCase(),
      currentAnimation: currentAnimation == null ? null : String(currentAnimation).toLowerCase(),
      animationApplied: requestedAnimation != null && currentAnimation != null
        && String(requestedAnimation).toLowerCase() === String(currentAnimation).toLowerCase(),
    };
  });

  return {
    audio,
    // The bounded MedCom trace is driven after the static snapshot so no
    // interaction can contaminate creature, texture, audio or model baselines.
    behaviorChain: {
      coverage: 'missing-evidence',
      interactionId: null,
      eventDispatchLocated: false,
      actionQueueLocated: false,
      resultStateLocated: false,
      reason: 'No bounded interaction driver was supplied to this engine capture',
    },
    loadedFromSave,
    playerName: String(attempt(() => {
      const party = K.PartyManager && K.PartyManager.party;
      const player = Array.isArray(party) ? party[0] : null;
      return player && player.getName ? player.getName() : '';
    }, '') || ''),
    partySize: num(attempt(() => {
      const party = K.PartyManager && K.PartyManager.party;
      return Array.isArray(party) ? party.length : null;
    }, null)),
    module: String(GS.module.filename || '').toLowerCase(),
    creatures, textures, modelPresentation,
    diagnosticsBufferFull: diags.length >= 10000,
  };
})()`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let service = null;
  let url = args.url;
  if (!url) {
    service = await startAssetService();
    url = service.url;
  }
  const harness = new VrHarness({ port: args.port, observeServingBundle: true });
  const log = (line) => console.log(line);
  try {
    await harness.launch(url);
    harness.beginTrustedCapture();
    await bootstrapFreshNewGame(harness, log);
    log(`loading ${args.module}...`);
    const snapshot = await harness.evaluate(buildSnapshotSource(args.module), { timeoutMs: LOAD_TIMEOUT_MS + 60_000 });
    snapshot.bootstrap = 'new-game-ui';
    const loadedState = assertModuleLoadResult({ state: snapshot, error: snapshot && snapshot.error }, args.module);
    if (normalizeModuleName(args.module, 'Requested module') === '101PER') {
      snapshot.behaviorChain = await captureMedcomBehaviorChain(harness);
    }
    const servingBundle = await identifyServingBundle(harness);

    // Which build was measured: tools/build-stamp.js writes dist/.build-stamp.
    const dist = path.join(__dirname, '..', '..', 'dist');
    let buildStamp = null;
    try { buildStamp = new Date(Number(fs.readFileSync(path.join(dist, '.build-stamp'), 'utf8').trim())).toISOString(); } catch { /* optional */ }
    let bundleMtime = null;
    try { bundleMtime = fs.statSync(path.join(dist, 'KotOR.js')).mtime.toISOString(); } catch { /* optional */ }

    if (args.canonical) assertCanonicalEngineState(loadedState);

    const engineCommit = args.url ? null : (() => {
      try {
        return require('child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: path.join(__dirname, '..', '..'),
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        return null;
      }
    })();

    if (args.url) {
      buildStamp = null;
      bundleMtime = null;
    }
    const out = createSnapshotArtifact(snapshot, { externalUrl: Boolean(args.url), buildStamp, bundleMtime });
    if (args.canonical) out.engineIdentity = createEngineIdentity(loadedState, {
      engineCommit, bundleMtime, servingBundleSha256: servingBundle.sha256,
    });
    out.servingBundle = servingBundle;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${args.module.toLowerCase()}.engine.json`);
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    log(`${out.module}: ${out.creatures.length} creatures, ${out.textures.length} texture decisions -> ${path.relative(process.cwd(), file)}`);
  } finally {
    await harness.close();
    if (service) service.stop();
  }
}

if (require.main === module) {
  main().catch((error) => { console.error(error); process.exit(1); });
}

module.exports = {
  assertCanonicalEngineState,
  assertModuleLoadResult,
  assertRequestedModuleIdentity,
  buildSnapshotSource,
  createEngineIdentity,
  bootstrapFreshNewGame,
  awaitBootReadyForNewGame,
  identifyServingBundle,
  createSnapshotArtifact,
  buildMedcomBehaviorChain,
  createMedcomReplyChooser,
  captureMedcomBehaviorChain,
  selectMedbayRouteDoors,
  parseArgs,
};
