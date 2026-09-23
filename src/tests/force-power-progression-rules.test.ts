import { describe, expect, test } from '@jest/globals';
import {
  calculateForcePointCost,
  getAlignmentCostAdjustment,
  isForcePowerAlignmentAllowed,
  FORCE_FORM_POTENCY_ID,
  FORCE_FORM_MASTERY_ID,
} from '@/talents/forcePowerCostRules';
import {
  classifyVRForcePower,
  FORCE_POWER_USER_TYPES,
} from '@/vr/runtime/VRForcePowerClassification';
import {
  listLevelUpPowers,
  parsePowerPrerequisites,
  readPowerMinimumLevel,
} from '@/game/kotor/menu/LevelUpRules';

describe('forcePowerCostRules', () => {
  describe('getAlignmentCostAdjustment', () => {
    test('universal powers have 0 penalty and 0 discount at any alignment', () => {
      expect(getAlignmentCostAdjustment('-', 0)).toEqual({ penaltyPercent: 0, discountPercent: 0 });
      expect(getAlignmentCostAdjustment('-', 50)).toEqual({ penaltyPercent: 0, discountPercent: 0 });
      expect(getAlignmentCostAdjustment('-', 100)).toEqual({ penaltyPercent: 0, discountPercent: 0 });
    });

    test('light side power scaling matches retail KotOR 1 & 2 table', () => {
      // Full Light
      expect(getAlignmentCostAdjustment('G', 100)).toEqual({ penaltyPercent: 0, discountPercent: 50 });
      // Light shifts
      expect(getAlignmentCostAdjustment('G', 90)).toEqual({ penaltyPercent: 0, discountPercent: 30 });
      expect(getAlignmentCostAdjustment('G', 80)).toEqual({ penaltyPercent: 0, discountPercent: 20 });
      expect(getAlignmentCostAdjustment('G', 70)).toEqual({ penaltyPercent: 0, discountPercent: 15 });
      expect(getAlignmentCostAdjustment('G', 60)).toEqual({ penaltyPercent: 0, discountPercent: 10 });
      // Neutral
      expect(getAlignmentCostAdjustment('G', 50)).toEqual({ penaltyPercent: 0, discountPercent: 0 });
      // Dark shifts (penalties)
      expect(getAlignmentCostAdjustment('G', 40)).toEqual({ penaltyPercent: 25, discountPercent: 0 });
      expect(getAlignmentCostAdjustment('G', 20)).toEqual({ penaltyPercent: 50, discountPercent: 0 });
      // Full Dark (Mastery)
      expect(getAlignmentCostAdjustment('G', 0)).toEqual({ penaltyPercent: 75, discountPercent: 0 });
    });

    test('dark side power scaling matches retail KotOR 1 & 2 table', () => {
      // Full Dark
      expect(getAlignmentCostAdjustment('E', 0)).toEqual({ penaltyPercent: 0, discountPercent: 50 });
      // Dark shifts
      expect(getAlignmentCostAdjustment('E', 15)).toEqual({ penaltyPercent: 0, discountPercent: 30 });
      expect(getAlignmentCostAdjustment('E', 25)).toEqual({ penaltyPercent: 0, discountPercent: 20 });
      expect(getAlignmentCostAdjustment('E', 35)).toEqual({ penaltyPercent: 0, discountPercent: 15 });
      expect(getAlignmentCostAdjustment('E', 45)).toEqual({ penaltyPercent: 0, discountPercent: 10 });
      // Neutral
      expect(getAlignmentCostAdjustment('E', 50)).toEqual({ penaltyPercent: 0, discountPercent: 0 });
      // Light shifts (penalties)
      expect(getAlignmentCostAdjustment('E', 70)).toEqual({ penaltyPercent: 25, discountPercent: 0 });
      expect(getAlignmentCostAdjustment('E', 90)).toEqual({ penaltyPercent: 50, discountPercent: 0 });
      // Full Light (Mastery)
      expect(getAlignmentCostAdjustment('E', 100)).toEqual({ penaltyPercent: 75, discountPercent: 0 });
    });
  });

  describe('calculateForcePointCost', () => {
    test('neutral universal power costs base FP', () => {
      expect(calculateForcePointCost({ baseForcePoints: 25, powerAlignment: '-', casterAlignment: 50 })).toBe(25);
      expect(calculateForcePointCost({ baseForcePoints: 25, powerAlignment: '-', casterAlignment: 0 })).toBe(25);
      expect(calculateForcePointCost({ baseForcePoints: 25, powerAlignment: '-', casterAlignment: 100 })).toBe(25);
    });

    test('light side Heal (base 30) for Dark Mastery without CHA mitigation costs 52 FP (retail canon)', () => {
      // 30 + floor(30 * 0.75) = 30 + 22 = 52
      const cost = calculateForcePointCost({
        baseForcePoints: 30,
        powerAlignment: 'G',
        casterAlignment: 0,
        charismaModifier: 0,
      });
      expect(cost).toBe(52);
    });

    test('light side Heal (base 30) for Dark Mastery with CHA +5 modifier costs 45 FP (TSL CHA mitigation canon)', () => {
      // Penalty: 75% - 5*5% = 50% penalty -> 30 + floor(30 * 0.50) = 45
      const cost = calculateForcePointCost({
        baseForcePoints: 30,
        powerAlignment: 'G',
        casterAlignment: 0,
        charismaModifier: 5,
      });
      expect(cost).toBe(45);
    });

    test('light side Heal (base 30) for Light Mastery costs 15 FP (-50% discount)', () => {
      const cost = calculateForcePointCost({
        baseForcePoints: 30,
        powerAlignment: 'G',
        casterAlignment: 100,
      });
      expect(cost).toBe(15);
    });

    test('Force Potency or Force Mastery adds +20% cost', () => {
      const normalCost = calculateForcePointCost({
        baseForcePoints: 20,
        powerAlignment: '-',
        casterAlignment: 50,
      });
      expect(normalCost).toBe(20);

      const potencyCost = calculateForcePointCost({
        baseForcePoints: 20,
        powerAlignment: '-',
        casterAlignment: 50,
        activeForms: [FORCE_FORM_POTENCY_ID],
      });
      // 20 + floor(20 * 0.2) = 24
      expect(potencyCost).toBe(24);

      const masteryCost = calculateForcePointCost({
        baseForcePoints: 20,
        powerAlignment: '-',
        casterAlignment: 50,
        activeForms: [FORCE_FORM_MASTERY_ID],
      });
      expect(masteryCost).toBe(24);
    });

    test('handles zero or invalid base FP gracefully', () => {
      expect(calculateForcePointCost({ baseForcePoints: 0, casterAlignment: 50 })).toBe(0);
      expect(calculateForcePointCost({ baseForcePoints: -1, casterAlignment: 50 })).toBe(0);
    });
  });

  describe('isForcePowerAlignmentAllowed', () => {
    test('Inspire Followers requires alignment >= 60', () => {
      expect(isForcePowerAlignmentAllowed(167, 70)).toBe(true);
      expect(isForcePowerAlignmentAllowed(167, 60)).toBe(true);
      expect(isForcePowerAlignmentAllowed(167, 59)).toBe(false);
      expect(isForcePowerAlignmentAllowed(167, 20)).toBe(false);
    });

    test('Crush Opposition requires alignment <= 40', () => {
      expect(isForcePowerAlignmentAllowed(144, 20)).toBe(true);
      expect(isForcePowerAlignmentAllowed(144, 40)).toBe(true);
      expect(isForcePowerAlignmentAllowed(144, 41)).toBe(false);
      expect(isForcePowerAlignmentAllowed(144, 80)).toBe(false);
    });

    test('Force Enlightenment requires alignment >= 40', () => {
      expect(isForcePowerAlignmentAllowed(180, 50)).toBe(true);
      expect(isForcePowerAlignmentAllowed(180, 40)).toBe(true);
      expect(isForcePowerAlignmentAllowed(180, 39)).toBe(false);
    });

    test('Force Crush requires alignment <= 40', () => {
      expect(isForcePowerAlignmentAllowed(177, 20)).toBe(true);
      expect(isForcePowerAlignmentAllowed(177, 40)).toBe(true);
      expect(isForcePowerAlignmentAllowed(177, 41)).toBe(false);
    });
  });
});

describe('VRForcePowerClassification', () => {
  test('counts usertype 1 (Spells) and usertype 6 (Forms) as Force powers', () => {
    expect(FORCE_POWER_USER_TYPES).toEqual([1, 6]);
    expect(classifyVRForcePower({ userType: 1, label: 'FORCE_POWER_HEAL' })).toBe(true);
    expect(classifyVRForcePower({ userType: 6, label: 'FORM_SABER_I_SHII_CHO' })).toBe(true);
    expect(classifyVRForcePower({ userType: 6, label: 'FORM_FORCE_II_POTENCY' })).toBe(true);
  });

  test('does not classify items (4) or special abilities (2) as Force powers', () => {
    expect(classifyVRForcePower({ userType: 4, label: 'DROID_ITEM_CHARGE_ARM' })).toBe(false);
    expect(classifyVRForcePower({ userType: 2, label: 'SPECIAL_ABILITY_RAGE' })).toBe(false);
  });

  test('returns undefined for non-spell objects or feats', () => {
    expect(classifyVRForcePower(null)).toBeUndefined();
    expect(classifyVRForcePower({})).toBeUndefined();
    expect(classifyVRForcePower({ featId: 10 })).toBeUndefined();
  });
});

describe('LevelUpRules multi-tier prerequisites and alignment filtering', () => {
  const mockSpells = [
    { __index: 10, usertype: '1', label: 'HEAL', consular: '1', prerequisites: '****' },
    { __index: 28, usertype: '1', label: 'IMPROVED_HEAL', consular: '12', prerequisites: '10' },
    { __index: 134, usertype: '1', label: 'MASTER_HEAL', consular: '18', prerequisites: '10_28' },
    { __index: 167, usertype: '1', label: 'INSPIRE_FOLLOWERS_I', jedimaster: '1', consular: '1', prerequisites: '****' },
    { __index: 179, usertype: '1', label: 'BATTLE_PRECOGNITION', consular: '1', prerequisites: '****' },
  ];

  test('parsePowerPrerequisites handles underscore-separated strings', () => {
    expect(parsePowerPrerequisites('10_28')).toEqual([10, 28]);
    expect(parsePowerPrerequisites('49')).toEqual([49]);
    expect(parsePowerPrerequisites('****')).toEqual([]);
    expect(parsePowerPrerequisites(null)).toEqual([]);
  });

  test('enforces multi-tier prerequisite chains', () => {
    // Has 10, character level 18 -> Improved Heal (28) is selectable, Master Heal (134) unavailable until 28 is known
    const list = listLevelUpPowers({
      rows: mockSpells,
      classColumn: 'consular',
      characterLevel: 18,
      isKnown: (id) => id === 10,
    });
    const entry28 = list.find((e) => e.id === 28);
    const entry134 = list.find((e) => e.id === 134);
    expect(entry28?.state).toBe('selectable');
    expect(entry134?.state).toBe('unavailable');

    // Has both 10 and 28 -> Master Heal (134) becomes selectable
    const listAdvanced = listLevelUpPowers({
      rows: mockSpells,
      classColumn: 'consular',
      characterLevel: 18,
      isKnown: (id) => id === 10 || id === 28,
    });
    const entry134Advanced = listAdvanced.find((e) => e.id === 134);
    expect(entry134Advanced?.state).toBe('selectable');
  });

  test('filters out Inspire Followers when alignment is below 60', () => {
    const listDark = listLevelUpPowers({
      rows: mockSpells,
      classColumn: 'consular',
      characterLevel: 15,
      isKnown: () => false,
      alignment: 30, // Dark side
    });
    expect(listDark.find((e) => e.id === 167)?.state).toBe('unavailable');

    const listLight = listLevelUpPowers({
      rows: mockSpells,
      classColumn: 'consular',
      characterLevel: 15,
      isKnown: () => false,
      alignment: 80, // Light side
    });
    expect(listLight.find((e) => e.id === 167)?.state).toBe('selectable');
  });

  test('filters out Battle Precognition for female Exile', () => {
    const listFemale = listLevelUpPowers({
      rows: mockSpells,
      classColumn: 'consular',
      characterLevel: 5,
      isKnown: () => false,
      gender: 1, // female
    });
    expect(listFemale.find((e) => e.id === 179)?.state).toBe('unavailable');

    const listMale = listLevelUpPowers({
      rows: mockSpells,
      classColumn: 'consular',
      characterLevel: 5,
      isKnown: () => false,
      gender: 0, // male
    });
    expect(listMale.find((e) => e.id === 179)?.state).toBe('selectable');
  });
});
