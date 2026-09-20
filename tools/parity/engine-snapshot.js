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
const { waitForMenu, newGameThroughCharacterCreation } = require('../vr-emulator/playthrough-steps');

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

/**
 * Rejects a state that cannot represent the authored fresh-game 101PER
 * baseline. This deliberately fails closed: an unknown player or party is not
 * interchangeable with the T3-M4 bootstrap state.
 *
 * @param {{ loadedFromSave?: unknown, bootstrap?: unknown, playerName?: unknown, partySize?: unknown }} state
 */
function assertCanonicalEngineState(state) {
  if (!state || typeof state !== 'object') {
    throw new TypeError('Canonical parity capture rejected: engine state is unavailable');
  }
  if (state.loadedFromSave === true) {
    throw new Error('Canonical parity capture rejected: module is save-derived');
  }
  if (state.loadedFromSave !== false) {
    throw new Error('Canonical parity capture rejected: save origin could not be verified');
  }
  if (state.bootstrap !== 'new-game-ui') {
    throw new Error('Canonical parity capture rejected: expected fresh new-game bootstrap');
  }
  if (state.playerName !== 'T3-M4' || state.partySize !== 1) {
    throw new Error('Canonical parity capture rejected: expected fresh T3-M4 single-member party');
  }
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
  return Object.freeze({
    module: normalizeModuleName(state && state.module, 'Loaded module'),
    freshState: true,
    loadedFromSave: false,
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
async function bootstrapFreshNewGame(harness, log) {
  const accepted = await harness.evaluate(`(() => {
    const button = Array.from(document.querySelectorAll('button')).find((candidate) => (candidate.textContent || '').trim() === 'OK');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (accepted) log('EULA accepted for fresh new-game bootstrap');
  await harness.waitFor(`document.querySelector('#vr-spike-button') !== null`, 90_000, 500);
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
  if (!harness || typeof harness.evaluate !== 'function') throw new TypeError('Cannot identify serving build without an authenticated browser harness');
  const identity = await harness.evaluate(`(async () => {
    const url = new URL('KotOR.js', window.location.href).toString();
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('KotOR.js returned ' + response.status);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0) throw new Error('KotOR.js was empty');
    if (!window.crypto || !window.crypto.subtle) throw new Error('Web Crypto digest is unavailable');
    const digest = await window.crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return { url, sha256 };
  })()`);
  if (!identity || typeof identity.url !== 'string' || !/^[a-f0-9]{64}$/i.test(identity.sha256 || '')) {
    throw new Error('Cannot identify serving build from authenticated browser response');
  }
  return Object.freeze({ url: identity.url, sha256: identity.sha256.toLowerCase() });
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
    const modelName = attempt(() => placeable.placeableAppearance && placeable.placeableAppearance.modelname, null);
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
    // A behavior result is valid only when a bounded interaction supplied its
    // source identity plus an action/event/result trace.  This capture has no
    // such driver yet, so it deliberately records the missing probe rather
    // than implying that an idle module state is a successful interaction.
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
  const harness = new VrHarness({ port: args.port });
  const log = (line) => console.log(line);
  try {
    await harness.launch(url);
    const servingBundle = await identifyServingBundle(harness);
    await bootstrapFreshNewGame(harness, log);
    log(`loading ${args.module}...`);
    const snapshot = await harness.evaluate(buildSnapshotSource(args.module), { timeoutMs: LOAD_TIMEOUT_MS + 60_000 });
    snapshot.bootstrap = 'new-game-ui';
    const loadedState = assertModuleLoadResult({ state: snapshot, error: snapshot && snapshot.error }, args.module);

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

    const out = {
      schema: 'kotor2-vr/parity-engine@1',
      capturedAt: new Date().toISOString(),
      buildStamp,
      bundleMtime,
      ...snapshot,
    };
    if (args.url) {
      buildStamp = null;
      bundleMtime = null;
    }
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
  identifyServingBundle,
  parseArgs,
};
