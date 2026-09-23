/**
 * Audit progression 2DA tables directly from retail K2 installation.
 * Reads classes.2da, feat.2da, featgain.2da, skills.2da, spells.2da,
 * classpowergain.2da, and acbonus.2da directly from chitin.key / data/2da.bif.
 */
const fs = require('fs');
const path = require('path');

const GAME_ROOT = process.env.KOTOR2_PATH || 'D:/SteamLibrary/steamapps/common/Knights of the Old Republic II';

function loadBifAndKey() {
  const keyPath = path.join(GAME_ROOT, 'chitin.key');
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Cannot find chitin.key at ${keyPath}`);
  }
  const keyBuf = fs.readFileSync(keyPath);
  const bifCount = keyBuf.readUInt32LE(8);
  const keyCount = keyBuf.readUInt32LE(12);
  const offFile = keyBuf.readUInt32LE(16);
  const offKey = keyBuf.readUInt32LE(20);

  const bifPath = path.join(GAME_ROOT, 'data/2da.bif');
  if (!fs.existsSync(bifPath)) {
    throw new Error(`Cannot find 2da.bif at ${bifPath}`);
  }
  const bifBuf = fs.readFileSync(bifPath);
  const vOff = bifBuf.readUInt32LE(16);

  function getResource(resrefName) {
    const target = resrefName.toLowerCase();
    for (let i = 0; i < keyCount; i++) {
      const p = offKey + i * 22;
      const resref = keyBuf.toString('latin1', p, p + 16).replace(/\0[\s\S]*$/, '');
      const resType = keyBuf.readUInt16LE(p + 16);
      const resId = keyBuf.readUInt32LE(p + 18);
      if (resType === 2017 && resref.toLowerCase() === target) {
        const resIdx = resId & 0xFFFFF;
        const bp = vOff + resIdx * 16;
        const offset = bifBuf.readUInt32LE(bp + 4);
        const size = bifBuf.readUInt32LE(bp + 8);
        return bifBuf.subarray(offset, offset + size);
      }
    }
    return null;
  }

  return { getResource };
}

function parse2da(b) {
  if (!b) return null;
  let pos = 9;
  let str = '';
  const cols = ['__rowlabel'];
  while (pos < b.length && b[pos] !== 0) {
    const ch = String.fromCharCode(b[pos++]);
    if (ch === '\t') { cols.push(str); str = ''; }
    else str += ch;
  }
  pos++; // skip null
  const rowCount = b.readUInt32LE(pos); pos += 4;
  const rowIndexes = [];
  for (let i = 0; i < rowCount; i++) {
    let rIndex = '';
    while (pos < b.length && b[pos] !== 9) rIndex += String.fromCharCode(b[pos++]);
    pos++;
    rowIndexes.push(rIndex);
  }
  const cellCount = (cols.length - 1) * rowCount;
  const offsets = [];
  for (let i = 0; i < cellCount; i++) {
    offsets.push(b.readUInt16LE(pos)); pos += 2;
  }
  pos += 2; // skip data size
  const dataOffset = pos;
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const row = { __index: i, __rowlabel: rowIndexes[i] };
    for (let j = 0; j < cols.length - 1; j++) {
      const off = dataOffset + offsets[i * (cols.length - 1) + j];
      let end = off;
      while (end < b.length && b[end] !== 0) end++;
      let token = b.toString('latin1', off, end);
      if (token === '') token = '****';
      row[cols[j + 1]] = token;
    }
    rows.push(row);
  }
  return { cols, rows };
}

function audit() {
  console.log(`[Audit] Checking retail K2 tables at ${GAME_ROOT}...`);
  const { getResource } = loadBifAndKey();

  const tables = ['classes', 'feat', 'featgain', 'skills', 'spells', 'classpowergain', 'acbonus'];
  const parsed = {};
  for (const t of tables) {
    const res = getResource(t);
    if (!res) throw new Error(`Missing 2DA table: ${t}`);
    parsed[t] = parse2da(res);
    console.log(`  [OK] ${t}.2da: ${parsed[t].rows.length} rows, ${parsed[t].cols.length} columns`);
  }

  // 1. Audit classes
  console.log('\n--- 1. Classes Audit (classes.2da) ---');
  const classCodes = ['sol', 'sct', 'scd', 'jgd', 'jcn', 'jsn', 'drc', 'drx', 'tec', 'jwm', 'jma', 'jwa', 'sma', 'sld', 'sas'];
  const classes = parsed.classes.rows;
  console.log(`Found ${classes.length} class rows:`);
  for (const r of classes) {
    console.log(`  Class ${r.__index.toString().padStart(2)}: ${r.label.padEnd(20)} HitDie=${r.hitdie.padStart(2)} ForceDie=${r.forcedie.padStart(2)} SkillBase=${r.skillpointbase} FeatTable=${r.featstable.padEnd(4)} FeatGain=${r.featgain.padEnd(4)} SpellCaster=${r.spellcaster} SpellGain=${r.spellgaintable.padEnd(4)} ST=${r.savingthrowtable.padEnd(16)} AC=${r.armorclasscolumn}`);
  }

  // 2. Audit Skills
  console.log('\n--- 2. Skills Audit (skills.2da) ---');
  const skills = parsed.skills.rows;
  console.log(`Found ${skills.length} skills:`);
  for (const s of skills) {
    const classCols = classCodes.map(c => `${c}:${s[`${c}_class`]}`).join(' ');
    console.log(`  Skill ${s.__index} (${s.label.padEnd(12)}): ${classCols}`);
  }

  // 3. Audit Feat class columns
  console.log('\n--- 3. Feat Class Columns Audit (feat.2da) ---');
  const featCols = parsed.feat.cols;
  for (const code of classCodes) {
    const listCol = `${code}_list`;
    const grantedCol = `${code}_granted`;
    const recomCol = `${code}_recom`;
    const hasList = featCols.includes(listCol) || featCols.includes(`${code}List`);
    const hasGranted = featCols.includes(grantedCol) || featCols.includes(`${code}Granted`);
    const hasRecom = featCols.includes(recomCol) || featCols.includes(`${code}Recom`);
    console.log(`  Class code ${code.toUpperCase()}: list=${hasList}, granted=${hasGranted}, recom=${hasRecom}`);
  }

  // 4. Audit Force Powers
  console.log('\n--- 4. Force Powers Audit (spells.2da) ---');
  const spells = parsed.spells.rows;
  const forceClasses = ['guardian', 'consular', 'sentinel', 'weapmstr', 'jedimaster', 'watchman', 'marauder', 'sithlord', 'assassin'];
  const forceSpells = spells.filter(s => s.usertype === '1' || s.usertype === '6');
  console.log(`Total spells: ${spells.length}, Force powers (usertype 1 or 6): ${forceSpells.length}`);
  for (const fc of forceClasses) {
    const offered = forceSpells.filter(s => s[fc] !== undefined && s[fc] !== '****' && s[fc] !== '-1');
    console.log(`  Class ${fc.padEnd(12)}: learns ${offered.length} powers by level`);
  }

  // 5. Audit Feat Prerequisite Integrity (feat.2da)
  console.log('\n--- 5. Feat Prerequisite Integrity (feat.2da) ---');
  let invalidFeatPrereqs = 0;
  for (const f of parsed.feat.rows) {
    for (const p of ['prereqfeat1', 'prereqfeat2']) {
      const target = f[p];
      if (target && target !== '****' && target !== '-1') {
        const id = parseInt(target, 10);
        if (isNaN(id) || !parsed.feat.rows[id]) {
          console.warn(`  [WARN] Feat ${f.__index} (${f.label}) references invalid ${p}: ${target}`);
          invalidFeatPrereqs++;
        }
      }
    }
  }
  console.log(`  Feat prerequisite links verified: ${invalidFeatPrereqs === 0 ? 'ALL VALID' : `${invalidFeatPrereqs} ERRORS`}`);

  // 6. Audit Spell Prerequisite Integrity & Forms (spells.2da)
  console.log('\n--- 6. Spell Prerequisite Integrity & Forms (spells.2da) ---');
  let invalidSpellPrereqs = 0;
  for (const s of forceSpells) {
    const raw = s.prerequisites;
    if (raw && raw !== '****' && raw !== '') {
      const parts = raw.split('_').map(p => parseInt(p, 10)).filter(p => !isNaN(p) && p >= 0);
      for (const p of parts) {
        if (!parsed.spells.rows[p]) {
          console.warn(`  [WARN] Spell ${s.__index} (${s.label}) references invalid prerequisite: ${p}`);
          invalidSpellPrereqs++;
        }
      }
    }
  }
  console.log(`  Spell prerequisite links verified: ${invalidSpellPrereqs === 0 ? 'ALL VALID' : `${invalidSpellPrereqs} ERRORS`}`);

  const formSpells = spells.filter(s => s.usertype === '6');
  console.log(`  Found ${formSpells.length} Force & Saber Form spells (usertype 6):`);
  for (const form of formSpells) {
    console.log(`    Form ${form.__index}: ${form.label.padEnd(26)} formmask=${form.formmask}`);
  }

  return parsed;
}

if (require.main === module) {
  audit();
}

module.exports = { loadBifAndKey, parse2da, audit };
