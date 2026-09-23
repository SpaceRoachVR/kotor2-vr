import { describe, expect, test } from '@jest/globals';
import {
  NO_AUTO_BALANCE,
  resolveAttackAbilityModifier,
  resolveAttackRoll,
  resolveAutoBalanceBonuses,
  resolveAutoBalancedMaxVitality,
  strengthAddsToDamage,
} from '@/combat/TSLCombatRules';

/**
 * Rows from StrategyWiki's "Star Wars Knights of the Old Republic II: The Sith
 * Lords/Autobalance" tables: main level, level bonus, vitality multiplier,
 * damage multiplier, attack bonus, defense bonus, saves bonus.
 *
 * Round 9: "check on attack and HP values for the mining droids on Peragus …
 * The enemies in the game need to have correct stat values." The Damaged Mining
 * Droids carry MultiplierSet 2, and nothing in the engine read it.
 */
type Row = [main: number, level: number, vitality: number, damage: number, attack: number, defense: number, saves: number];

const TABLES: Record<number, Row[]> = {
  1: [
    [1, -1, 1, 1, 0, 0, 0], [2, 0, 1, 1, 1, 1, 1], [3, 1, 1, 1, 2, 1, 2], [4, 2, 2, 1, 3, 2, 3],
    [5, 2, 2, 1, 4, 3, 4], [6, 3, 3, 1, 5, 3, 4], [7, 4, 4, 1, 6, 4, 5], [8, 5, 4, 1, 7, 4, 6],
    [9, 5, 5, 1, 8, 5, 7], [10, 6, 6, 1, 8, 6, 8], [11, 7, 6, 1, 9, 6, 8], [12, 8, 7, 1, 10, 7, 9],
    [13, 8, 8, 1, 11, 7, 10], [17, 11, 10, 2, 15, 10, 13], [20, 14, 12, 2, 17, 12, 16], [21, 14, 13, 2, 18, 12, 16],
    [25, 17, 15, 2, 22, 15, 20], [30, 21, 19, 2, 26, 18, 24], [40, 29, 25, 3, 35, 24, 32], [50, 36, 32, 4, 44, 30, 40],
  ],
  2: [
    [1, -1, 1, 1, 0, 0, 0], [2, 0, 1, 1, 1, 1, 1], [3, 1, 1, 1, 2, 2, 2], [4, 2, 2, 1, 3, 2, 3],
    [5, 2, 2, 1, 4, 3, 4], [6, 3, 3, 1, 5, 4, 5], [7, 4, 4, 1, 6, 4, 6], [8, 5, 4, 1, 7, 5, 7],
    [9, 5, 5, 1, 8, 6, 8], [10, 6, 6, 1, 8, 6, 8], [11, 7, 6, 1, 9, 7, 9], [12, 8, 7, 1, 10, 8, 10],
    [13, 8, 8, 2, 11, 9, 11], [17, 11, 10, 2, 15, 11, 15], [20, 14, 12, 2, 17, 13, 17], [21, 14, 13, 2, 18, 14, 18],
    [25, 17, 15, 3, 22, 17, 22], [30, 21, 19, 3, 26, 20, 26], [40, 29, 25, 4, 35, 27, 35], [50, 36, 32, 5, 44, 34, 44],
  ],
  3: [
    [1, -1, 1, 1, 0, 0, 1], [2, 0, 1, 1, 1, 1, 2], [3, 1, 1, 1, 2, 2, 3], [4, 2, 2, 1, 3, 3, 4],
    [5, 2, 2, 1, 4, 4, 5], [6, 3, 3, 1, 5, 4, 6], [7, 4, 4, 1, 6, 5, 7], [8, 5, 4, 1, 7, 6, 8],
    [9, 5, 5, 1, 8, 7, 9], [10, 6, 6, 1, 9, 8, 10], [11, 7, 6, 2, 10, 8, 11], [12, 8, 7, 2, 11, 9, 12],
    [13, 8, 8, 2, 12, 10, 13], [17, 11, 10, 2, 16, 13, 17], [20, 14, 12, 3, 18, 16, 20], [21, 14, 13, 3, 19, 16, 21],
    [25, 17, 15, 3, 23, 20, 25], [30, 21, 19, 4, 28, 24, 30], [40, 29, 25, 5, 37, 32, 40], [50, 36, 32, 6, 47, 40, 50],
  ],
  4: [
    [1, -1, 1, 1, 1, 0, 1], [2, 0, 1, 1, 2, 1, 2], [3, 1, 1, 1, 3, 2, 3], [4, 2, 2, 1, 4, 3, 4],
    [5, 2, 3, 1, 5, 4, 5], [6, 3, 3, 1, 6, 5, 6], [7, 4, 4, 1, 7, 6, 7], [8, 5, 5, 1, 8, 7, 8],
    [9, 5, 5, 2, 9, 8, 9], [10, 6, 6, 2, 10, 8, 10], [11, 7, 7, 2, 11, 9, 11], [12, 8, 7, 2, 12, 10, 12],
    [13, 8, 8, 2, 13, 11, 13], [17, 11, 11, 3, 17, 15, 17], [20, 14, 13, 3, 20, 17, 20], [21, 14, 14, 3, 21, 18, 21],
    [25, 17, 17, 4, 25, 22, 25], [30, 21, 20, 4, 30, 26, 30], [40, 29, 27, 6, 40, 35, 40], [50, 36, 34, 7, 50, 44, 50],
  ],
  5: [
    [1, -1, 1, 1, 1, 1, 1], [2, 0, 1, 1, 2, 2, 2], [3, 1, 1, 1, 3, 3, 3], [4, 2, 2, 1, 4, 4, 4],
    [5, 2, 3, 1, 5, 5, 5], [6, 3, 4, 1, 6, 6, 6], [7, 4, 5, 2, 7, 7, 7], [8, 5, 5, 2, 8, 8, 8],
    [9, 5, 6, 2, 9, 9, 9], [10, 6, 7, 2, 11, 10, 10], [11, 7, 8, 2, 12, 11, 11], [12, 8, 9, 2, 13, 12, 12],
    [13, 8, 9, 3, 14, 13, 13], [17, 11, 13, 3, 18, 17, 17], [20, 14, 15, 4, 22, 20, 20], [21, 14, 16, 4, 23, 21, 22],
    [25, 17, 19, 5, 27, 25, 26], [30, 21, 23, 6, 33, 30, 31], [40, 29, 31, 7, 44, 40, 41], [50, 36, 39, 9, 55, 50, 52],
  ],
};

describe('resolveAutoBalanceBonuses matches the published tables', () => {
  for (const set of [1, 2, 3, 4, 5]) {
    test.each(TABLES[set])(`Set ${set} at main level %i`, (main, level, vitality, damage, attack, defense, saves) => {
      expect(resolveAutoBalanceBonuses(set, main)).toEqual({
        levelBonus: level,
        vitalityMultiplier: vitality,
        damageMultiplier: damage,
        attackBonus: attack,
        defenseBonus: defense,
        saveBonus: saves,
      });
    });
  }

  test('set 0 and unknown sets do not autobalance', () => {
    expect(resolveAutoBalanceBonuses(0, 20)).toBe(NO_AUTO_BALANCE);
    expect(resolveAutoBalanceBonuses(6, 20)).toBe(NO_AUTO_BALANCE);
  });
});

describe('resolveAutoBalancedMaxVitality', () => {
  // Damaged Mining Droid (g_assassindrd002): base vitality 9, Expert Droid 1,
  // Constitution 8, Set 2.
  const droid = { baseVitality: 9, set: 2, classLevel: 1, constitutionModifier: -1, toughness: 0 };

  test('at main level 1 the droid keeps its base 9', () => {
    expect(resolveAutoBalancedMaxVitality({ ...droid, mainLevel: 1 })).toBe(9);
  });

  test('at main level 5 it doubles, less a point per level for its low Constitution', () => {
    // multiplier 2, level 1 + 2 = 3 → 18 - 3
    expect(resolveAutoBalancedMaxVitality({ ...droid, mainLevel: 5 })).toBe(15);
  });

  test('a creature outside the sets is not rebalanced', () => {
    expect(resolveAutoBalancedMaxVitality({ ...droid, set: 0, mainLevel: 10 })).toBeNull();
  });
});

describe('resolveAttackRoll', () => {
  const base = { attackBonus: 0, defense: 12, threatRangeMin: 20, threatNatural: 20 };

  test('meets defense to hit', () => {
    expect(resolveAttackRoll({ ...base, natural: 12 }).hit).toBe(true);
    expect(resolveAttackRoll({ ...base, natural: 11 }).hit).toBe(false);
  });

  test('a natural 1 misses and a natural 20 hits whatever the totals', () => {
    expect(resolveAttackRoll({ ...base, natural: 1, attackBonus: 50 }).hit).toBe(false);
    expect(resolveAttackRoll({ ...base, natural: 20, attackBonus: -50 }).hit).toBe(true);
  });

  test('a threat becomes a critical only if the threat roll also meets defense', () => {
    expect(resolveAttackRoll({ ...base, natural: 20, threatNatural: 12 })).toMatchObject({ threat: true, critical: true });
    expect(resolveAttackRoll({ ...base, natural: 20, threatNatural: 11 })).toMatchObject({ threat: true, critical: false });
  });

  test('the threat roll has no automatic hit', () => {
    expect(resolveAttackRoll({ ...base, natural: 20, attackBonus: -30, threatNatural: 20 }).critical).toBe(false);
  });

  test('the threat range reads the natural roll, not the total', () => {
    // The engine used to test the total: +2 made a natural 18 a "critical"
    // and a natural 20 not one.
    expect(resolveAttackRoll({ ...base, attackBonus: 2, natural: 18 }).threat).toBe(false);
    expect(resolveAttackRoll({ ...base, attackBonus: 2, natural: 20 }).threat).toBe(true);
    expect(resolveAttackRoll({ ...base, threatRangeMin: 19, natural: 19 }).threat).toBe(true);
  });

  test('a miss never threatens', () => {
    expect(resolveAttackRoll({ ...base, threatRangeMin: 15, natural: 16, defense: 40 }).threat).toBe(false);
  });
});

describe('ability modifiers for attacks and damage', () => {
  const mods = { strengthModifier: 1, dexterityModifier: 3, finesseMelee: false, finesseLightsaber: false };

  test('ranged attacks use Dexterity, melee Strength', () => {
    expect(resolveAttackAbilityModifier({ ...mods, ranged: true, lightsaber: false })).toBe(3);
    expect(resolveAttackAbilityModifier({ ...mods, ranged: false, lightsaber: false })).toBe(1);
  });

  test('Finesse feats let a higher Dexterity stand in', () => {
    expect(resolveAttackAbilityModifier({ ...mods, ranged: false, lightsaber: false, finesseMelee: true })).toBe(3);
    expect(resolveAttackAbilityModifier({ ...mods, ranged: false, lightsaber: true, finesseLightsaber: true })).toBe(3);
    expect(resolveAttackAbilityModifier({ ...mods, ranged: false, lightsaber: false, finesseLightsaber: true })).toBe(1);
  });

  test('Strength adds to melee and off-hand blaster pistol damage only', () => {
    expect(strengthAddsToDamage({ ranged: false, offHandBlasterPistol: false })).toBe(true);
    expect(strengthAddsToDamage({ ranged: true, offHandBlasterPistol: false })).toBe(false);
    expect(strengthAddsToDamage({ ranged: true, offHandBlasterPistol: true })).toBe(true);
  });
});
