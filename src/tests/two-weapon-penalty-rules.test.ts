import { describe, expect, test } from '@jest/globals';
import { resolveTwoWeaponPenalty } from '@/combat/TwoWeaponRules';
import { CombatFeatType } from '@/enums/combat/CombatFeatType';

// The totals the feat descriptions in TSL's dialog.tlk state (critic run 4).
const penalties = (feats: number[], balancedOffHand = false) => {
  const hasFeat = (feat: number) => feats.includes(feat);
  return [
    resolveTwoWeaponPenalty({ offHand: false, balancedOffHand, hasFeat }),
    resolveTwoWeaponPenalty({ offHand: true, balancedOffHand, hasFeat }),
  ];
};

describe('two-weapon penalties follow the retail feat text', () => {
  test('no feat: -6 main, -10 off', () => {
    expect(penalties([])).toEqual([6, 10]);
  });
  test('Two-Weapon Fighting -6/-6, balanced -4/-6', () => {
    expect(penalties([CombatFeatType.TWO_WEAPON_FIGHTING])).toEqual([6, 6]);
    expect(penalties([CombatFeatType.TWO_WEAPON_FIGHTING], true)).toEqual([4, 6]);
  });
  test('Improved -4/-4, balanced -2/-4', () => {
    const feats = [CombatFeatType.TWO_WEAPON_FIGHTING, CombatFeatType.TWO_WEAPON_ADVANCED];
    expect(penalties(feats)).toEqual([4, 4]);
    expect(penalties(feats, true)).toEqual([2, 4]);
  });
  test('Master -2/-2, balanced 0/-2', () => {
    const feats = [CombatFeatType.TWO_WEAPON_FIGHTING, CombatFeatType.TWO_WEAPON_ADVANCED, CombatFeatType.TWO_WEAPON_MASTERY];
    expect(penalties(feats)).toEqual([2, 2]);
    expect(penalties(feats, true)).toEqual([0, 2]);
  });
  test('Superior I-III: -1/-2, 0/-2, 0/-1; balanced turns the main hand into a bonus', () => {
    const base = [CombatFeatType.TWO_WEAPON_FIGHTING, CombatFeatType.TWO_WEAPON_ADVANCED, CombatFeatType.TWO_WEAPON_MASTERY];
    expect(penalties([...base, CombatFeatType.SUPER_WEAPON_FOCUS_2_WEAPON_I])).toEqual([1, 2]);
    expect(penalties([...base, CombatFeatType.SUPER_WEAPON_FOCUS_2_WEAPON_I], true)).toEqual([-1, 2]);
    expect(penalties([...base, CombatFeatType.SUPER_WEAPON_FOCUS_2_WEAPON_II], true)).toEqual([-2, 2]);
    expect(penalties([...base, CombatFeatType.SUPER_WEAPON_FOCUS_2_WEAPON_III])).toEqual([0, 1]);
  });
});
