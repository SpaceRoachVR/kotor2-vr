/**
 * Minimal read-only Odyssey container/GFF/TLK readers, for answering "what does
 * the retail data actually authorise here?" from the shell.
 *
 * The engine has full parsers, but reaching them means booting a browser. These
 * exist so a question about authored content can be settled in one command.
 * Read-only by design: nothing here writes to the retail install.
 */
const fs = require('fs');
const path = require('path');

const GAME_ROOT = 'D:/SteamLibrary/steamapps/common/Knights of the Old Republic II';

// Verified against 001EBO's own containers rather than from memory: the
// door templates land in 2042 and the placeable templates in 2044, which is
// not what a generic Aurora type table would tell you.
const RES_TYPE = {
  2009: 'nss', 2010: 'ncs', 2012: 'are', 2014: 'ifo', 2023: 'git',
  2025: 'uti', 2027: 'utc', 2029: 'dlg', 2032: 'utt', 2035: 'uts',
  2042: 'utd', 2044: 'utp', 2058: 'utw', 3003: 'pth',
};

function readRim(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'RIM ') throw new Error(`not a RIM: ${file}`);
  const count = b.readUInt32LE(0x0C);
  const off = b.readUInt32LE(0x10);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const p = off + i * 32;
    const start = b.readUInt32LE(p + 24);
    out.push({
      resref: b.toString('latin1', p, p + 16).replace(/\0[\s\S]*$/, ''),
      type: b.readUInt32LE(p + 16),
      data: b.subarray(start, start + b.readUInt32LE(p + 28)),
    });
  }
  return out;
}

function readErf(file) {
  const b = fs.readFileSync(file);
  const magic = b.toString('latin1', 0, 4);
  if (magic !== 'ERF ' && magic !== 'MOD ') throw new Error(`not an ERF: ${file}`);
  const count = b.readUInt32LE(0x10);
  const keyOff = b.readUInt32LE(0x18);
  const resOff = b.readUInt32LE(0x1C);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const kp = keyOff + i * 24;
    const rp = resOff + i * 8;
    const start = b.readUInt32LE(rp);
    out.push({
      resref: b.toString('latin1', kp, kp + 16).replace(/\0[\s\S]*$/, ''),
      type: b.readUInt16LE(kp + 20),
      data: b.subarray(start, start + b.readUInt32LE(rp + 4)),
    });
  }
  return out;
}

/** Every resource of a module, across its .rim, _s.rim and _dlg.erf. */
function readModule(moduleName) {
  const dir = path.join(GAME_ROOT, 'modules');
  const candidates = [
    `${moduleName}.rim`, `${moduleName}_s.rim`,
    `${moduleName}_dlg.erf`, `${moduleName}.mod`,
  ];
  const out = [];
  for (const name of candidates) {
    const full = path.join(dir, name);
    if (!fs.existsSync(full)) continue;
    const entries = /\.rim$/i.test(name) ? readRim(full) : readErf(full);
    for (const entry of entries) out.push({ ...entry, container: name });
  }
  if (!out.length) throw new Error(`no container found for module ${moduleName}`);
  return out;
}

function findResource(moduleName, resref, type) {
  const wanted = String(resref).toLowerCase();
  return readModule(moduleName).find((r) =>
    r.resref.toLowerCase() === wanted && (type == null || r.type === type)) || null;
}

// --- GFF -------------------------------------------------------------------

const GFF_SIMPLE = new Set([0, 1, 2, 3, 4, 5, 8]);

function readGff(buffer) {
  const b = buffer;
  const structOff = b.readUInt32LE(0x08);
  const structCount = b.readUInt32LE(0x0C);
  const fieldOff = b.readUInt32LE(0x10);
  const labelOff = b.readUInt32LE(0x18);
  const dataOff = b.readUInt32LE(0x20);
  const indicesOff = b.readUInt32LE(0x28);
  const listOff = b.readUInt32LE(0x30);

  const label = (i) =>
    b.toString('latin1', labelOff + i * 16, labelOff + i * 16 + 16).replace(/\0[\s\S]*$/, '');

  function readField(index) {
    const p = fieldOff + index * 12;
    const type = b.readUInt32LE(p);
    const name = label(b.readUInt32LE(p + 4));
    const raw = b.readUInt32LE(p + 8);
    return { name, value: readValue(type, raw, p + 8) };
  }

  function readValue(type, raw, inlineAt) {
    if (GFF_SIMPLE.has(type)) {
      switch (type) {
        case 0: return b.readUInt8(inlineAt);
        case 1: return b.readInt8(inlineAt);
        case 2: return b.readUInt16LE(inlineAt);
        case 3: return b.readInt16LE(inlineAt);
        case 4: return raw;
        case 5: return b.readInt32LE(inlineAt);
        default: return b.readFloatLE(inlineAt);
      }
    }
    const at = dataOff + raw;
    switch (type) {
      case 6: return b.readBigUInt64LE(at);
      case 7: return b.readBigInt64LE(at);
      case 9: return b.readDoubleLE(at);
      case 10: {
        const len = b.readUInt32LE(at);
        return b.toString('latin1', at + 4, at + 4 + len);
      }
      case 11: {
        const len = b.readUInt8(at);
        return b.toString('latin1', at + 1, at + 1 + len);
      }
      case 12: {
        // CExoLocString: totalSize(4) strref(4) stringCount(4) then substrings.
        const strref = b.readInt32LE(at + 4);
        const count = b.readUInt32LE(at + 8);
        let cursor = at + 12;
        const strings = [];
        for (let i = 0; i < count; i += 1) {
          const len = b.readUInt32LE(cursor + 4);
          strings.push(b.toString('latin1', cursor + 8, cursor + 8 + len));
          cursor += 8 + len;
        }
        return { strref, strings };
      }
      case 13: {
        const len = b.readUInt32LE(at);
        return b.subarray(at + 4, at + 4 + len);
      }
      case 14: return readStruct(raw);
      case 15: {
        const p = listOff + raw;
        const count = b.readUInt32LE(p);
        const items = [];
        for (let i = 0; i < count; i += 1) items.push(readStruct(b.readUInt32LE(p + 4 + i * 4)));
        return items;
      }
      case 16: return [0, 1, 2, 3].map((i) => b.readFloatLE(at + i * 4));
      case 17: return [0, 1, 2].map((i) => b.readFloatLE(at + i * 4));
      case 18: return b.readUInt32LE(at);
      default: return `<unhandled gff type ${type}>`;
    }
  }

  function readStruct(index) {
    if (index >= structCount) return {};
    const p = structOff + index * 12;
    const dataOrOffset = b.readUInt32LE(p + 4);
    const fieldCount = b.readUInt32LE(p + 8);
    const out = { __structId: b.readInt32LE(p) };
    if (fieldCount === 1) {
      const f = readField(dataOrOffset);
      out[f.name] = f.value;
      return out;
    }
    for (let i = 0; i < fieldCount; i += 1) {
      const f = readField(b.readUInt32LE(indicesOff + dataOrOffset + i * 4));
      out[f.name] = f.value;
    }
    return out;
  }

  return readStruct(0);
}

// --- TLK -------------------------------------------------------------------

let tlkCache = null;
function tlk(strref) {
  if (strref == null || strref < 0 || strref === 0xFFFFFFFF) return '';
  if (!tlkCache) {
    const b = fs.readFileSync(path.join(GAME_ROOT, 'dialog.tlk'));
    tlkCache = { b, count: b.readUInt32LE(0x0C), entries: b.readUInt32LE(0x10) };
  }
  const { b, count, entries } = tlkCache;
  if (strref >= count) return `<strref ${strref} out of range>`;
  const p = 0x14 + strref * 40;
  const off = b.readUInt32LE(p + 28);
  const size = b.readUInt32LE(p + 32);
  return b.toString('latin1', entries + off, entries + off + size);
}

module.exports = { GAME_ROOT, RES_TYPE, readRim, readErf, readModule, findResource, readGff, tlk };
