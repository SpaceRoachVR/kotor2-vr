import { describe, expect, test } from '@jest/globals';
import { COLOUR_SLOT } from '@/game/tsl/crafting/UpgradeRules';
import type { SlotView, UpgradePart } from '@/game/tsl/crafting/UpgradeSession';
import { partsAfterStaging, useLimitsAfterStaging, wearerCanUseAfterStaging } from '@/game/tsl/crafting/UpgradeUseLimits';
import { alignmentLimitsOf } from '@/engine/rules/ItemUseLimits';

/**
 * Final review finding 2: an equipped saber's wearer must still meet the
 * saber's alignment use limits once the staged parts are in, or Assemble
 * refuses (a light-side wearer cannot fit a Qixoni crystal into the saber in
 * their hand).
 */

const CRYSTAL = 0;
const part = (resref: string, type = CRYSTAL): UpgradePart => ({ resref, row: 1, type, level: 1, name: resref });
const QIXONI = part('u_l_crys_21x');
const SOLARI = part('u_l_crys_20x');
const PLAIN = part('u_l_crys_01');
const BLUE = part('u_l_colo_01', COLOUR_SLOT);

const prop = (propertyName: number, subType: number, useable = true) => ({ propertyName, subType, isUseable: () => useable });
const PROPS: Record<string, ReturnType<typeof prop>[]> = {
  u_l_crys_21x: [prop(43, 3)],
  u_l_crys_20x: [prop(43, 2)],
  u_l_crys_01: [prop(1, 0)],
  u_l_colo_01: [prop(43, 3)],
};
const propertiesOf = (p: UpgradePart) => PROPS[p.resref];

const LIGHT = { goodEvil: 90 };
const DARK = { goodEvil: 10 };

function slots(...views: Partial<SlotView>[]): SlotView[] {
  return views.map((v, index) => ({ index, type: CRYSTAL, open: true, ...v }));
}

describe('partsAfterStaging', () => {
  test('staged over installed, staged removal drops the part, the colour slot is left out', () => {
    const parts = partsAfterStaging(slots(
      { type: COLOUR_SLOT, installed: BLUE },
      { installed: PLAIN, staged: QIXONI },
      { installed: SOLARI, staged: null },
      { installed: PLAIN },
      {},
    ));
    expect(parts.map((p) => p.resref)).toEqual(['u_l_crys_21x', 'u_l_crys_01']);
  });
});

describe('wearerCanUseAfterStaging', () => {
  test('a light wearer with a staged Qixoni (43/3) is refused', () => {
    expect(wearerCanUseAfterStaging(LIGHT, [], slots({ staged: QIXONI }), propertiesOf)).toBe(false);
  });

  test('the same wearer staging a Solari passes', () => {
    expect(wearerCanUseAfterStaging(LIGHT, [], slots({ staged: SOLARI }), propertiesOf)).toBe(true);
  });

  test('a dark wearer may fit the Qixoni', () => {
    expect(wearerCanUseAfterStaging(DARK, [], slots({ staged: QIXONI }), propertiesOf)).toBe(true);
  });

  test('an unworn saber is not checked', () => {
    expect(wearerCanUseAfterStaging(undefined, [], slots({ staged: QIXONI }), propertiesOf)).toBe(true);
  });

  test('a staged removal of an off-alignment crystal makes a refused set pass', () => {
    expect(wearerCanUseAfterStaging(LIGHT, [], slots({ installed: QIXONI }, { staged: PLAIN }), propertiesOf)).toBe(false);
    expect(wearerCanUseAfterStaging(LIGHT, [], slots({ installed: QIXONI, staged: null }, { staged: PLAIN }), propertiesOf)).toBe(true);
  });

  test("the item's own unusable properties do not count; its usable ones do", () => {
    expect(wearerCanUseAfterStaging(LIGHT, [prop(43, 3, false)], slots({ staged: PLAIN }), propertiesOf)).toBe(true);
    expect(wearerCanUseAfterStaging(LIGHT, [prop(43, 3, true)], slots({ staged: PLAIN }), propertiesOf)).toBe(false);
  });

  test('a colour crystal never adds limits', () => {
    expect(useLimitsAfterStaging([], slots({ type: COLOUR_SLOT, staged: BLUE }), propertiesOf)).toEqual([]);
  });
});

describe('alignmentLimitsOf', () => {
  test('keeps usable property 43 entries; installed parts skip the isUseable gate', () => {
    const props = [prop(43, 2), prop(43, 3, false), prop(1, 0)];
    expect(alignmentLimitsOf(props)).toEqual([{ property: 43, subType: 2 }]);
    expect(alignmentLimitsOf(props, true)).toEqual([{ property: 43, subType: 2 }, { property: 43, subType: 3 }]);
    expect(alignmentLimitsOf(undefined)).toEqual([]);
  });
});
