import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { hitsPaddedBox, VR_POINTER_HIT_PADDING } from '@/gui/PointerHitPadding';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * The per-skill +/- buttons had no handlers in either game. K1's CharGenSkills
 * wired exactly three controls — Back, Accept and Recommended — which is
 * precisely the set reported working from the headset while the +/- symbols did
 * nothing.
 */
describe('skill points can be spent by hand', () => {
  const k1 = read('src/game/kotor/menu/CharGenSkills.ts');
  const tsl = read('src/game/tsl/menu/CharGenSkills.ts');

  test.each([
    'COM_PLUS_BTN', 'DEM_PLUS_BTN', 'STE_PLUS_BTN', 'AWA_PLUS_BTN',
    'PER_PLUS_BTN', 'REP_PLUS_BTN', 'SEC_PLUS_BTN', 'TRE_PLUS_BTN',
  ])('%s is driven by the adjust wiring', (button) => {
    expect(k1).toMatch(new RegExp(`plus: '${button}'`));
  });

  test('all eight skills are covered, plus and minus', () => {
    const rows = k1.match(/\{ row: \d, field: '/g) || [];
    expect(rows).toHaveLength(8);
    expect((k1.match(/minus: '[A-Z_]+'/g) || [])).toHaveLength(8);
  });

  test('a cross-class skill costs two points and a class skill one', () => {
    expect(k1).toMatch(/isClassSkill\(row\) \? 1 : 2/);
  });

  test('both games call the adjust wiring', () => {
    expect(k1).toMatch(/this\.wireSkillAdjustControls\(\)/);
    expect(tsl).toMatch(/this\.wireSkillAdjustControls\(\)/);
  });
});

/**
 * The abilities screen's +/- controls are 32x32 GUI units and were reported
 * twice as hard to hit, while the large Back / OK / Recommended buttons on the
 * same screen were fine. That contrast is what identifies this as a size
 * problem rather than a pointer offset — an offset would miss the big buttons
 * too.
 */
describe('hitsPaddedBox', () => {
  // STR_PLUS_BTN, measured live.
  const plus = { min: { x: -37, y: 91 }, max: { x: -5, y: 123 } };

  test('a point inside still hits with no padding', () => {
    expect(hitsPaddedBox(plus, { x: -21, y: 107 }, 0)).toBe(true);
  });

  test('a near miss is rejected without padding and caught with it', () => {
    const nearMiss = { x: -41, y: 107 };
    expect(hitsPaddedBox(plus, nearMiss, 0)).toBe(false);
    expect(hitsPaddedBox(plus, nearMiss, VR_POINTER_HIT_PADDING)).toBe(true);
  });

  test('padding does not bridge the gap to the neighbouring minus button', () => {
    // STR_MINUS_BTN ends at x -59; padded plus starts at -45. A point between
    // them must still belong to neither, or a generous target becomes ambiguous.
    const between = { x: -52, y: 107 };
    expect(hitsPaddedBox(plus, between, VR_POINTER_HIT_PADDING)).toBe(false);
  });

  test('is defensive about missing or non-finite input', () => {
    expect(hitsPaddedBox(undefined, { x: 0, y: 0 }, 8)).toBe(false);
    expect(hitsPaddedBox(plus, undefined, 8)).toBe(false);
    expect(hitsPaddedBox(plus, { x: NaN, y: 107 }, 8)).toBe(false);
  });

  test('negative padding is ignored rather than shrinking the target', () => {
    expect(hitsPaddedBox(plus, { x: -6, y: 107 }, -20)).toBe(true);
  });
});

describe('padding is applied only where it is safe', () => {
  const control = read('src/gui/GUIControl.ts');
  const state = read('src/GameState.ts');

  test('only clickable controls are padded', () => {
    // Labels default to allowClick and overlap the controls they caption:
    // STR_LBL spans all three Strength buttons.
    expect(control).toMatch(/isClickable\(\)\s*\n?\s*\?\s*GUIControl\.pointerHitPadding\s*:\s*0/);
  });

  test('flatscreen keeps the authored hit areas exactly', () => {
    expect(state).toMatch(/VRSpike\.isPresenting \? VR_POINTER_HIT_PADDING : 0/);
  });
});
