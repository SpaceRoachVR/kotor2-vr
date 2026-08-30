import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A TSL menu that calls `super.menuControlInitializer(true)` skips the K1 base
 * class's initializer body — which is where the base wires its buttons. If the
 * subclass then adds no handlers of its own, every control in that menu is
 * dead, while the same screen works in K1.
 *
 * Reported from the headset three times before the pattern was recognised: the
 * equipment screen, the character-creation Feats step, and the custom panel
 * ("eight buttons and none of them respond").
 *
 * This guards the menus that are reachable in the flows currently enabled. The
 * remaining offenders are catalogued in VR-PLAYTEST-FIX-PLAN.md rather than
 * fixed blind, because some TSL screens differ from their K1 counterparts on
 * purpose and need their own handlers rather than the inherited ones.
 */
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** TSL menus in the character-creation flow, with the helper each must call. */
const GUARDED: ReadonlyArray<readonly [string, string]> = [
  ['CharGenCustomPanel', 'wireCustomPanel'],
  ['CharGenSkills', 'wireSkillControls'],
  ['CharGenFeats', 'wireStepNavigation'],
];

describe('TSL menus that skip the base initializer still wire their controls', () => {
  for (const [menu, helper] of GUARDED) {
    const tsl = read(`src/game/tsl/menu/${menu}.ts`);
    const k1 = read(`src/game/kotor/menu/${menu}.ts`);

    test(`${menu} defines its wiring in a helper the subclass can reach`, () => {
      expect(k1).toMatch(new RegExp(`protected ${helper}\\(\\)`));
    });

    test(`${menu} (TSL) calls that helper`, () => {
      // Only required because it skips the base body; assert that premise too,
      // so this test starts failing rather than passing vacuously if TSL is
      // ever changed to run the base initializer normally.
      expect(tsl).toMatch(/super\.menuControlInitializer\(true\)/);
      expect(tsl).toMatch(new RegExp(`this\\.${helper}\\(\\)`));
    });

    test(`${menu} (K1) still calls it too`, () => {
      expect(k1).toMatch(new RegExp(`this\\.${helper}\\(\\)`));
    });
  }
});

describe('the custom panel wires every button it shows', () => {
  const k1 = read('src/game/kotor/menu/CharGenCustomPanel.ts');

  test.each(['BTN_STEPNAME1', 'BTN_STEPNAME2', 'BTN_STEPNAME3', 'BTN_STEPNAME4',
    'BTN_STEPNAME5', 'BTN_STEPNAME6', 'BTN_BACK', 'BTN_CANCEL'])
    ('%s has a click handler', (button) => {
      expect(k1).toMatch(new RegExp(`${button}\\??\\.addEventListener\\('click'`));
    });
});
