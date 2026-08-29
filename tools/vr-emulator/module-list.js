/**
 * Enumerates the campaign's modules from a retail install, and applies the
 * driver's selection flags.
 *
 * A retail TSL `modules/` directory holds three files per module — `NAME.rim`
 * (static area data), `NAME_s.rim` (scripts) and `NAME_dlg.erf` (dialogue).
 * Only the base `.rim` names a module, so the campaign is 82 modules, not the
 * 246 files on disk. Counting files instead of modules overstates the game by
 * three times, which is worth being careful about when the module count is the
 * denominator for every coverage claim the sweep makes.
 *
 * `.mod` files are honoured too: a module-level mod (TSLRCM installs some this
 * way) replaces the retail `.rim` under the same base name, and the engine
 * prefers it. Either extension contributes the same single module name.
 */
const fs = require('fs');
const path = require('path');

/** Files that exist per module but do not name one. */
const SUFFIX_PATTERN = /_(s|dlg|loc)$/i;

/**
 * Reads the module names out of a retail install.
 *
 * @param {string} gameRoot path to the KOTOR II install directory
 * @returns {string[]} unique uppercase module names, sorted
 */
function listGameModules(gameRoot) {
  const modulesDir = path.join(gameRoot, 'modules');
  let entries;
  try {
    entries = fs.readdirSync(modulesDir);
  } catch (error) {
    throw new Error(
      `Could not read ${modulesDir}: ${error.message}. Pass --game <retail-dir> if the ` +
      `install is not where the asset service expects it.`
    );
  }

  const names = new Set();
  for (const entry of entries) {
    const extension = path.extname(entry).toLowerCase();
    if (extension !== '.rim' && extension !== '.mod' && extension !== '.erf') continue;
    const base = path.basename(entry, path.extname(entry));
    // `_dlg.erf` and `_s.rim` are companions of a module, not modules. A bare
    // `.erf` that is not a companion is not a module either, so it is dropped.
    if (SUFFIX_PATTERN.test(base)) {
      if (extension === '.erf' || extension === '.rim') {
        names.add(base.replace(SUFFIX_PATTERN, '').toUpperCase());
      }
      continue;
    }
    if (extension === '.erf') continue;
    names.add(base.toUpperCase());
  }
  return Array.from(names).sort();
}

/**
 * Applies `--modules`, `--skip`, `--start` and `--limit` to a module list.
 *
 * Order is deliberate: an explicit `--modules` list wins outright and keeps the
 * caller's order, because "sweep exactly these three, in this order" is what a
 * person does when re-checking a fix. Everything else narrows the full list
 * while preserving its sort, so an interrupted sweep can be resumed with
 * `--start` and produce the same sequence it would have produced anyway.
 */
function selectModules(all, options = {}) {
  const { only = null, skip = [], start = null, limit = null } = options;
  const known = new Set(all.map((m) => m.toUpperCase()));

  if (only && only.length) {
    const wanted = only.map((m) => m.toUpperCase());
    const missing = wanted.filter((m) => !known.has(m));
    if (missing.length) {
      throw new Error(`Unknown module(s): ${missing.join(', ')}`);
    }
    return wanted;
  }

  let selected = all.slice();
  if (start) {
    const target = start.toUpperCase();
    const index = selected.indexOf(target);
    if (index < 0) throw new Error(`Unknown --start module: ${start}`);
    selected = selected.slice(index);
  }
  if (skip.length) {
    const excluded = new Set(skip.map((m) => m.toUpperCase()));
    selected = selected.filter((m) => !excluded.has(m));
  }
  if (limit != null) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('--limit must be a positive integer');
    }
    selected = selected.slice(0, limit);
  }
  return selected;
}

module.exports = { listGameModules, selectModules, SUFFIX_PATTERN };
