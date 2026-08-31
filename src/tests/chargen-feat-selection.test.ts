import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * `CharGenFeats` shipped with `BTN_SELECT` and `BTN_RECOMMENDED` unwired — its
 * own header said so — and the remaining-selections labels were never written
 * to. Feats could only ever be granted automatically by class.
 *
 * These are source-shape assertions for the same reason as
 * `chargen-skills-and-hit-padding.test.ts`: importing the GUI barrel pulls a
 * module chain Jest cannot parse.
 */
describe('feat selection is wired and rule-bound', () => {
  const feats = read('src/game/kotor/menu/CharGenFeats.ts');
  const item = read('src/game/kotor/gui/GUIFeatItem.ts');
  const creature = read('src/module/ModuleCreature.ts');

  test('Select and Recommended both have handlers', () => {
    expect(feats).toMatch(/this\.BTN_SELECT\?\.addEventListener\('click'/);
    expect(feats).toMatch(/this\.BTN_RECOMMENDED\?\.addEventListener\('click'/);
  });

  test('the row reports its feat on click so Select acts on the same one', () => {
    expect(item).toMatch(/highlightFeat/);
  });

  test('selection is gated on the allowance from featgain.2da', () => {
    expect(feats).toMatch(/getRemainingFeatSelections\(\) <= 0\) return false/);
    expect(feats).toMatch(/featGainPoints/);
  });

  test('eligibility reuses the list-building rules rather than new ones', () => {
    expect(feats).toMatch(/mainClass\.isFeatAvailable\(feat\)/);
    expect(feats).toMatch(/mainClass\.getFeatStatus\(feat\)/);
    expect(feats).toMatch(/hasFeatPrerequisites/);
  });

  test('a feat already held cannot be picked again', () => {
    expect(feats).toMatch(/this\.creature\.getHasFeat\(feat\.id\)\) return false/);
  });

  test('picks can be taken back, but class-granted feats cannot', () => {
    // Only ids recorded in selectedFeatIds — i.e. picked here — are removable.
    expect(feats).toMatch(/this\.selectedFeatIds\.has\(feat\.id\)/);
    expect(feats).toMatch(/this\.creature\.removeFeat\(feat\.id\)/);
    expect(creature).toMatch(/removeFeat\(feat: number\|TalentFeat = 0\): boolean/);
  });

  test('a change refreshes the count and the list together', () => {
    expect(feats).toMatch(/afterSelectionChanged/);
    expect(feats).toMatch(/this\.updateRemainingSelections\(\);\s*\n\s*this\.buildFeatList\(\);/);
  });

  test('Recommended stops when the allowance runs out', () => {
    expect(feats).toMatch(/if\(this\.getRemainingFeatSelections\(\) <= 0\) break;/);
  });
});
