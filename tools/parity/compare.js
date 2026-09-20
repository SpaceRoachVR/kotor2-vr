/**
 * Diffs an engine snapshot against the retail snapshot for one module and ranks
 * the mismatches by how many objects each one touches — the same blast-radius
 * ordering `vr:sweep` uses, so the report reads as a work queue.
 *
 *   node tools/parity/compare.js --module 101PER
 *
 * Inputs:  tools/parity/out/<module>.engine.json, <module>.retail.json
 * Outputs: tools/parity/out/<module>.parity.json and <module>.parity.md
 *
 * Every finding carries a `confidence`:
 *   - "defect"   the value comes straight from the template and nothing in
 *                retail changes it at spawn, so a difference is ours.
 *   - "variable" retail legitimately changes it at spawn (autobalance, OnSpawn
 *                scripts, item bonuses). Worth a look, not proof of a bug.
 *   - "coverage" we could not measure it (object missing, or never requested).
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, 'out');

const EXACT_FIELDS = [
  'appearance', 'race', 'subrace', 'gender', 'portraitId', 'soundSetFile', 'factionId',
  'bodyVariation', 'textureVar', 'naturalAC',
  'str', 'dex', 'con', 'int', 'wis', 'cha',
  'fortbonus', 'refbonus', 'willbonus', 'isHologram', 'plot', 'min1HP',
];
const VARIABLE_FIELDS = [
  'hitPoints', 'currentHitPoints', 'maxHitPoints', 'forcePoints', 'maxForcePoints',
  'goodEvil', 'challengeRating',
];
const SKILL_NAMES = ['computerUse', 'demolitions', 'stealth', 'awareness',
  'persuade', 'repair', 'security', 'treatInjury'];

// PyKotor EquipmentSlot names -> engine ModuleCreature.equipment keys, matched
// by bit value, not by name. PyKotor 2.3.12 has the arm slots swapped: it calls
// 0x80 RIGHT_ARM, but tsl_nwscript.nss defines INVENTORY_SLOT_LEFTARM = 7
// (1 << 7 = 0x80), which is what ModuleCreatureArmorSlot uses.
const SLOT_MAP = {
  HEAD: 'HEAD', ARMOR: 'ARMOR', GAUNTLET: 'ARMS', RIGHT_HAND: 'RIGHTHAND', LEFT_HAND: 'LEFTHAND',
  RIGHT_ARM: 'LEFTARMBAND', LEFT_ARM: 'RIGHTARMBAND', IMPLANT: 'IMPLANT', BELT: 'BELT',
  CLAW1: 'CLAW1', CLAW2: 'CLAW2', CLAW3: 'CLAW3', HIDE: 'HIDE',
  RIGHT_HAND_2: 'RIGHTHAND2', LEFT_HAND_2: 'LEFTHAND2',
};

// Engine texture sources collapse to retail's lookup layers.
function textureLayer(source) {
  if (!source || source === 'none') return 'none';
  if (source.startsWith('override')) return 'override';
  if (source === 'active-module') return 'module';
  return source;
}

function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-4;
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffSets(retail, engine) {
  const r = new Map(); const e = new Map();
  for (const v of retail || []) r.set(v, (r.get(v) || 0) + 1);
  for (const v of engine || []) e.set(v, (e.get(v) || 0) + 1);
  const missing = []; const extra = [];
  for (const [v, n] of r) for (let i = 0; i < n - (e.get(v) || 0); i++) missing.push(v);
  for (const [v, n] of e) for (let i = 0; i < n - (r.get(v) || 0); i++) extra.push(v);
  return { missing, extra };
}

function evidenceMatchesFinding(record, finding) {
  const resref = String(record.resref || '').toLowerCase();
  const object = String(finding.object || '').toLowerCase();
  return resref.length > 0 && (object === resref || object.startsWith(`${resref}#`));
}

function linkEvidence(finding, evidenceRecords, evidencePath) {
  const matchingRecords = (evidenceRecords || []).filter((record) => evidenceMatchesFinding(record, finding));
  if (matchingRecords.length === 0) return finding;
  const linkedPath = evidencePath || matchingRecords[0].path;
  if (typeof linkedPath !== 'string' || !linkedPath.trim()) return finding;
  return { ...finding, evidenceRefs: [...new Set([...(finding.evidenceRefs || []), linkedPath])] };
}

function loadEvidenceSidecar(module) {
  const sidecarPath = path.join(OUT_DIR, `${module}.evidence.json`);
  if (!fs.existsSync(sidecarPath)) return { records: [], path: null };
  const document = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  if (!document || !Array.isArray(document.records)) {
    throw new TypeError(`Evidence sidecar requires records: ${sidecarPath}`);
  }
  return { records: document.records, path: path.relative(process.cwd(), sidecarPath).replace(/\\/g, '/') };
}

/**
 * Pairs retail GIT creatures with engine area creatures by template, in order.
 * Order within a template is not meaningful (identical droids), and matching on
 * template alone keeps one spawn failure from shifting every pair after it.
 */
function pairCreatures(retail, engine) {
  const pool = new Map();
  for (const c of engine) {
    if (!pool.has(c.template)) pool.set(c.template, []);
    pool.get(c.template).push(c);
  }
  const pairs = []; const unmatchedRetail = [];
  for (const r of retail) {
    const list = pool.get(r.template);
    if (list && list.length) pairs.push([r, list.shift()]);
    else unmatchedRetail.push(r);
  }
  const unmatchedEngine = [...pool.values()].flat();
  return { pairs, unmatchedRetail, unmatchedEngine };
}

function compareCreatures(retailSnap, engineSnap, add) {
  const retail = retailSnap.creatures.filter((c) => c.status === 'ok');
  for (const c of retailSnap.creatures.filter((x) => x.status !== 'ok')) {
    add({ area: 'creature', code: 'retail-template-missing', confidence: 'coverage', object: c.template,
      detail: 'GIT names a template retail cannot resolve' });
  }
  const { pairs, unmatchedRetail, unmatchedEngine } = pairCreatures(retail, engineSnap.creatures);

  for (const r of unmatchedRetail) {
    add({ area: 'creature', code: 'creature-not-spawned', confidence: 'coverage', object: r.template,
      detail: `retail GIT spawns ${r.template} (${r.tag}); the engine area has no creature with that template`,
      note: 'a module loaded from a save legitimately differs if the creature died or left' });
  }
  for (const e of unmatchedEngine) {
    add({ area: 'creature', code: 'creature-not-in-git', confidence: 'coverage', object: e.template || e.tag,
      detail: `engine area holds ${e.template || '(no template)'} (${e.tag}); retail GIT has no such entry`,
      note: 'party members and script-spawned creatures land here by design' });
  }

  // Saved state (HP, equipment changes, deaths) is not a template defect.
  const saved = engineSnap.loadedFromSave === true;
  for (const [r, e] of pairs) {
    const object = `${r.template}#${r.gitIndex}`;
    for (const field of EXACT_FIELDS) {
      if (!same(r[field], e[field])) {
        add({ area: 'creature', code: `stat:${field}`, confidence: 'defect', object, retail: r[field], engine: e[field] });
      }
    }
    for (const field of VARIABLE_FIELDS) {
      if (!same(r[field], e[field])) {
        add({ area: 'creature', code: `stat:${field}`, confidence: 'variable', object, retail: r[field], engine: e[field],
          ...(saved ? { note: 'module loaded from a save; value may be saved state' } : {}) });
      }
    }
    for (let i = 0; i < SKILL_NAMES.length; i++) {
      if (!same(r.skills[i], e.skills[i])) {
        add({ area: 'creature', code: `skill:${SKILL_NAMES[i]}`, confidence: 'defect', object,
          retail: r.skills[i], engine: e.skills[i] === undefined ? null : e.skills[i] });
      }
    }
    const rc = r.classes.map((k) => `${k.id}:${k.level}`);
    const ec = e.classes.map((k) => `${k.id}:${k.level}`);
    if (!same(rc, ec)) add({ area: 'creature', code: 'classes', confidence: 'defect', object, retail: rc, engine: ec });

    const rp = r.classes.flatMap((k) => k.powers);
    const ep = e.classes.flatMap((k) => k.powers);
    const powers = diffSets(rp, ep);
    if (powers.missing.length || powers.extra.length) {
      add({ area: 'creature', code: 'powers', confidence: 'defect', object, retail: powers.missing, engine: powers.extra,
        detail: 'retail = powers the engine lacks; engine = powers retail lacks' });
    }
    const feats = diffSets(r.feats, e.feats);
    if (feats.missing.length || feats.extra.length) {
      add({ area: 'creature', code: 'feats', confidence: 'defect', object, retail: feats.missing, engine: feats.extra,
        detail: 'retail = feats the engine lacks; engine = feats retail lacks' });
    }
    for (const [slot, item] of Object.entries(r.equipment)) {
      const key = SLOT_MAP[slot] || slot;
      const engineHasSlot = Object.prototype.hasOwnProperty.call(e.equipment || {}, key);
      const got = (e.equipment || {})[key] || null;
      if (got === item) continue;
      if (engineHasSlot && !got) {
        // No resref on the engine item (it came from a saved struct): compare tags.
        const retailTag = (r.equipmentTags || {})[slot] || null;
        const engineTag = (e.equipmentTags || {})[key] || null;
        if (retailTag && engineTag && retailTag === engineTag) continue;
        add({ area: 'creature', code: `equipment-tag:${key}`, confidence: retailTag && engineTag ? 'defect' : 'coverage',
          object, retail: retailTag, engine: engineTag, detail: 'engine item has no resref; compared by tag' });
        continue;
      }
      add({ area: 'creature', code: `equipment:${key}`, confidence: saved ? 'variable' : 'defect', object, retail: item, engine: got });
    }
    const retailSlots = new Set(Object.keys(r.equipment).map((s) => SLOT_MAP[s] || s));
    for (const [slot, item] of Object.entries(e.equipment || {})) {
      if (!retailSlots.has(slot)) {
        add({ area: 'creature', code: `equipment:${slot}`, confidence: 'variable', object, retail: null, engine: item,
          note: 'OnSpawn scripts can equip items' });
      }
    }
  }
  return { paired: pairs.length, unmatchedRetail: unmatchedRetail.length, unmatchedEngine: unmatchedEngine.length };
}

function compareTextures(retailSnap, engineSnap, add) {
  const retail = new Map(retailSnap.textures.map((t) => [t.resref, t]));
  const engine = new Map();
  for (const t of engineSnap.textures) {
    const key = String(t.requestedResref || '').toLowerCase();
    if (key && !engine.has(key)) engine.set(key, t);
  }

  let checked = 0;
  for (const [name, e] of engine) {
    const r = retail.get(name);
    if (!r) {
      add({ area: 'texture', code: 'texture-not-in-retail-snapshot', confidence: 'coverage', object: name,
        detail: 'rerun retail_snapshot.py with --textures pointing at the engine snapshot' });
      continue;
    }
    checked++;
    const engineLayer = textureLayer(e.selectedSource);
    const engineMissing = e.status !== 'resolved';
    if (engineMissing && r.retailSource !== 'none') {
      add({ area: 'texture', code: 'texture-missing', confidence: 'defect', object: name,
        retail: r.retailSource, engine: `${e.status}${e.diagnosticCode ? ` (${e.diagnosticCode})` : ''}`,
        detail: `searched ${e.searchedSources.join(', ') || 'nothing'}` });
    } else if (!engineMissing && r.retailSource === 'none') {
      add({ area: 'texture', code: 'texture-resolved-retail-cannot', confidence: 'defect', object: name,
        retail: 'none', engine: `${engineLayer}${e.resolvedResref ? ` as ${e.resolvedResref}` : ''}`,
        note: 'usually an alias; check it is a reviewed one' });
    } else if (!engineMissing && engineLayer !== r.retailSource) {
      add({ area: 'texture', code: 'texture-wrong-layer', confidence: 'defect', object: name,
        retail: r.retailSource, engine: engineLayer,
        detail: `retail holds it in: ${r.locations.map((l) => l.source).join(', ')}` });
    }
    if (e.resolvedResref && e.resolvedResref.toLowerCase() !== name && r.retailSource !== 'none') {
      add({ area: 'texture', code: 'texture-aliased', confidence: 'defect', object: name,
        retail: name, engine: e.resolvedResref, detail: 'retail has the requested name; the engine loaded another' });
    }
  }
  for (const [name, r] of retail) {
    if (r.namedByRetailModels && !engine.has(name)) {
      add({ area: 'texture', code: 'texture-never-requested', confidence: 'coverage', object: name,
        retail: r.retailSource, engine: null,
        note: 'retail module models name it; the engine never asked. Could be an unrendered model or a skipped material slot.' });
    }
  }
  return { checked };
}

const SOUND_FIELDS = ['active', 'continuous', 'looping', 'positional', 'random', 'randomPosition',
  'interval', 'intervalVariation', 'volume', 'volumeVariation', 'maxDistance', 'minDistance', 'priority', 'times'];

function compareAudio(retailSnap, engineSnap, add) {
  const r = retailSnap.audio; const e = engineSnap.audio;
  if (!r || !e) return { skipped: true };
  for (const [label, value] of Object.entries(r.area)) {
    if (!same(value, e.area[label])) {
      add({ area: 'audio', code: `area:${label}`, confidence: engineSnap.loadedFromSave ? 'variable' : 'defect',
        object: retailSnap.module, retail: value, engine: e.area[label] });
    }
  }
  for (const [label, track] of Object.entries(r.tracks || {})) {
    if (track.resource && track.retailSource === 'none') {
      add({ area: 'audio', code: 'retail-track-missing', confidence: 'coverage', object: track.resource,
        detail: `${label} names a file retail cannot resolve` });
    }
  }

  // Pair by template in order, like creatures.
  const pool = new Map();
  for (const s of e.sounds) {
    if (!pool.has(s.template)) pool.set(s.template, []);
    pool.get(s.template).push(s);
  }
  let paired = 0;
  for (const rs of r.sounds.filter((x) => x.status === 'ok')) {
    const list = pool.get(rs.template);
    const es = list && list.shift();
    if (!es) {
      add({ area: 'audio', code: 'sound-not-spawned', confidence: 'coverage', object: rs.template,
        detail: `GIT places sound ${rs.template} (${rs.tag}); the engine area has none` });
      continue;
    }
    paired++;
    const object = `${rs.template}#${rs.gitIndex}`;
    for (const field of SOUND_FIELDS) {
      if (!same(rs[field], es[field])) {
        add({ area: 'audio', code: `sound:${field}`, confidence: 'defect', object, retail: rs[field], engine: es[field] });
      }
    }
    const files = diffSets(rs.sounds, es.sounds);
    if (files.missing.length || files.extra.length) {
      add({ area: 'audio', code: 'sound:files', confidence: 'defect', object, retail: files.missing, engine: files.extra });
    }
    if (Array.isArray(es.decoded)) {
      for (const name of rs.sounds) {
        const retailHas = rs.soundSources[name] && rs.soundSources[name] !== 'none';
        if (retailHas && !es.decoded.includes(name)) {
          add({ area: 'audio', code: 'sound-file-not-decoded', confidence: 'defect', object: name,
            retail: rs.soundSources[name], engine: 'not in emitter buffers',
            note: 'an emitter can decode lazily; confirm with a longer settle before chasing' });
        }
      }
    }
  }
  for (const leftovers of pool.values()) {
    for (const es of leftovers) {
      add({ area: 'audio', code: 'sound-not-in-git', confidence: 'coverage', object: es.template || es.tag,
        detail: 'engine area has a sound object the GIT does not place' });
    }
  }
  return { paired };
}

function rank(findings) {
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.area}|${f.code}|${f.confidence}`;
    if (!groups.has(key)) groups.set(key, { area: f.area, code: f.code, confidence: f.confidence, objects: new Set(), examples: [] });
    const g = groups.get(key);
    g.objects.add(f.object);
    if (g.examples.length < 5) g.examples.push(f);
  }
  const order = { defect: 0, variable: 1, coverage: 2 };
  return [...groups.values()]
    .map((g) => ({ ...g, count: g.objects.size, objects: undefined }))
    .sort((a, b) => order[a.confidence] - order[b.confidence] || b.count - a.count || a.code.localeCompare(b.code));
}

function fmt(v) {
  if (v === undefined) return '';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  return v === null ? '—' : String(v);
}

function toMarkdown(report) {
  const lines = [];
  lines.push(`# Parity: ${report.module.toUpperCase()}`, '');
  lines.push(`Engine captured ${report.engineCapturedAt} (bundle ${report.bundleMtime || 'unknown'}).`, '');
  if (report.loadedFromSave) {
    lines.push('> **Loaded from a save.** This module was in `gameinprogress`, so creature HP, equipment and presence reflect saved state as well as the template. Treat `variable` and `coverage` rows accordingly.', '');
  }
  lines.push(`Creatures paired: ${report.creatures.paired}; retail-only: ${report.creatures.unmatchedRetail}; engine-only: ${report.creatures.unmatchedEngine}. Textures checked: ${report.textures.checked}. Sounds paired: ${report.audio && report.audio.paired !== undefined ? report.audio.paired : 'n/a'}.`, '');
  for (const confidence of ['defect', 'variable', 'coverage']) {
    const groups = report.ranked.filter((g) => g.confidence === confidence);
    lines.push(`## ${confidence} (${groups.length})`, '');
    if (!groups.length) { lines.push('None.', ''); continue; }
    lines.push('| Objects | Area | Code | Example | Retail | Engine |', '|---:|---|---|---|---|---|');
    for (const g of groups) {
      const ex = g.examples[0];
      lines.push(`| ${g.count} | ${g.area} | \`${g.code}\` | ${ex.object} | ${fmt(ex.retail)} | ${fmt(ex.engine)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const i = process.argv.indexOf('--module');
  if (i < 0) throw new Error('usage: node tools/parity/compare.js --module 101PER');
  const mod = process.argv[i + 1].toLowerCase();
  const engine = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${mod}.engine.json`), 'utf8'));
  const retail = JSON.parse(fs.readFileSync(path.join(OUT_DIR, `${mod}.retail.json`), 'utf8'));
  const evidence = loadEvidenceSidecar(mod);

  const findings = [];
  const add = (f) => findings.push(linkEvidence(f, evidence.records, evidence.path));
  const creatures = compareCreatures(retail, engine, add);
  const textures = compareTextures(retail, engine, add);
  const audio = compareAudio(retail, engine, add);
  const report = {
    schema: 'kotor2-vr/parity-report@1',
    module: mod,
    engineCapturedAt: engine.capturedAt,
    bundleMtime: engine.bundleMtime,
    loadedFromSave: engine.loadedFromSave === true,
    creatures, textures, audio,
    ranked: rank(findings),
    findings,
  };
  fs.writeFileSync(path.join(OUT_DIR, `${mod}.parity.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${mod}.parity.md`), toMarkdown(report));
  const counts = { defect: 0, variable: 0, coverage: 0 };
  for (const g of report.ranked) counts[g.confidence] += 1;
  console.log(`${mod}: ${findings.length} findings in ${report.ranked.length} groups ` +
    `(defect ${counts.defect}, variable ${counts.variable}, coverage ${counts.coverage}) -> tools/parity/out/${mod}.parity.md`);
}

if (require.main === module) main();

module.exports = { pairCreatures, diffSets, textureLayer, rank, SLOT_MAP, linkEvidence, loadEvidenceSidecar };
