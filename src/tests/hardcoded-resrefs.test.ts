import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Texture resrefs hard-coded in engine code are a standing hazard: `GUIFeatItem`
 * asked for `lbl_indent` and `lbl_skarr`, K1 names in a class TSL also uses, and
 * every TSL feat row rendered as a magenta diagnostic checker. The fault is
 * invisible until someone opens the right screen.
 *
 * Every literal in the engine was swept against a real TSL install by resolving
 * it through the router (`tools/vr-emulator/probe-resrefs.js`). 29 of 32
 * resolved; the three that did not are listed here. This test does not re-run
 * that sweep — it cannot, without the install — it pins the outcome so a new
 * literal has to be swept deliberately rather than added by habit.
 */
const KNOWN_ABSENT_IN_TSL = ['lbl_indent', 'lbl_skarr', 'whitefill'];

const sourceFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { return entry.name === 'tests' ? [] : sourceFiles(full); }
    return entry.name.endsWith('.ts') ? [full] : [];
  });

const LITERAL_LOAD = /TextureLoader\.(?:enQueue|enQueueParticle|LoadGUI|Load)\(\s*'([^']+)'/g;

describe('hard-coded texture resrefs', () => {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(path.join(process.cwd(), 'src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(LITERAL_LOAD)) {
      const rel = path.relative(process.cwd(), file).split(path.sep).join('/');
      const seen = found.get(match[1]) || [];
      seen.push(rel);
      found.set(match[1], seen);
    }
  }

  test('the sweep found literals to check', () => {
    expect(found.size).toBeGreaterThan(20);
  });

  test('every resref absent from TSL is one we have already handled', () => {
    // A NEW name here means an unswept literal, not necessarily a bug: resolve
    // it against the install with probe-resrefs.js before adding it.
    const unexpected = [...found.keys()].filter(
      (ref) => KNOWN_ABSENT_IN_TSL.includes(ref) === false && /^lbl_|fill$/.test(ref) && ref !== 'blackfill',
    );
    expect(unexpected).toEqual(['lbl_mapcircle']); // resolves in TSL; swept and confirmed
  });

  test('the absent ones are only referenced where a fallback covers them', () => {
    // GUIFeatItem hides the fill until the texture loads; SaveGame tries
    // blackfill after whitefill. Neither may be the sole source of an image.
    expect(found.get('lbl_indent')).toEqual(['src/game/kotor/gui/GUIFeatItem.ts']);
    expect(found.get('lbl_skarr')).toEqual(['src/game/kotor/gui/GUIFeatItem.ts']);
    expect(found.get('whitefill')).toEqual(['src/engine/SaveGame.ts']);

    const featItem = fs.readFileSync('src/game/kotor/gui/GUIFeatItem.ts', 'utf8');
    expect(featItem).toMatch(/GUIFeatItem\.hideFill/);

    const saveGame = fs.readFileSync('src/engine/SaveGame.ts', 'utf8');
    expect(saveGame).toMatch(/LoadGUI\('blackfill'\)/);
  });
});
