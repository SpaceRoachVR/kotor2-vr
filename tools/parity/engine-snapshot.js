/**
 * Engine side of the parity check: what our build actually loaded.
 *
 * Boots the browser build the same way `vr:sweep` does (EULA, first save to
 * establish a party), warps into one module, lets it settle, and dumps the
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
const { bootEngine } = require('../vr-emulator/module-sweep');

const OUT_DIR = path.join(__dirname, 'out');
const LOAD_TIMEOUT_MS = 300_000;
const SETTLE_MS = 8_000;

function parseArgs(argv) {
  const args = { module: null, url: null, port: 9447 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--module') args.module = argv[++i];
    else if (argv[i] === '--url') args.url = argv[++i];
    else if (argv[i] === '--port') args.port = Number(argv[++i]);
  }
  if (!args.module) throw new Error('usage: node tools/parity/engine-snapshot.js --module 101PER [--url <url>]');
  return args;
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
  if (!attempt(() => GS.module !== previous && !!GS.module.area, false)) return { error: 'module did not settle' };
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
        sounds: (attempt(() => snd.soundResRefs, []) || []).map((n) => String(n).toLowerCase()),
        decoded: buffers,
      };
    }),
  };

  return {
    audio,
    loadedFromSave,
    module: String(GS.module.filename || '').toLowerCase(),
    creatures, textures,
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
    await bootEngine(harness, log, true);
    log(`loading ${args.module}...`);
    const snapshot = await harness.evaluate(buildSnapshotSource(args.module), { timeoutMs: LOAD_TIMEOUT_MS + 60_000 });
    if (!snapshot || snapshot.error) throw new Error(snapshot ? snapshot.error : 'empty snapshot');

    // Which build was measured: tools/build-stamp.js writes dist/.build-stamp.
    const dist = path.join(__dirname, '..', '..', 'dist');
    let buildStamp = null;
    try { buildStamp = new Date(Number(fs.readFileSync(path.join(dist, '.build-stamp'), 'utf8').trim())).toISOString(); } catch { /* optional */ }
    let bundleMtime = null;
    try { bundleMtime = fs.statSync(path.join(dist, 'KotOR.js')).mtime.toISOString(); } catch { /* optional */ }

    const out = {
      schema: 'kotor2-vr/parity-engine@1',
      capturedAt: new Date().toISOString(),
      buildStamp,
      bundleMtime,
      ...snapshot,
    };
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

module.exports = { buildSnapshotSource, parseArgs };
