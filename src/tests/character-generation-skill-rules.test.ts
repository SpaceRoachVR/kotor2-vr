import { describe, expect, test } from '@jest/globals';
import {
  allocateRecommendedCharGenSkills,
  applyCharGenSkillIncrease,
  resolveCharGenSkillAllocation,
} from '@/game/kotor/menu/CharGenSkillRules';

describe('character-generation skill allocation rules', () => {
  test('a class skill costs one point and reaches level plus three ranks', () => {
    const allocation = resolveCharGenSkillAllocation({
      skillRow: { soldier_class: '1' },
      classSkillColumn: 'soldier_class',
      level: 1,
      currentRank: 3,
      availablePoints: 1,
    });

    expect(allocation).toEqual({
      kind: 'class',
      rankCost: 1,
      maximumRank: 4,
      canIncrease: true,
      reason: undefined,
    });
  });

  test('a cross-class skill costs two points and is capped at half the class cap', () => {
    const allocation = resolveCharGenSkillAllocation({
      skillRow: { soldier_class: '0' },
      classSkillColumn: 'soldier_class',
      level: 1,
      currentRank: 1,
      availablePoints: 2,
    });

    expect(allocation).toEqual({
      kind: 'cross-class',
      rankCost: 2,
      maximumRank: 2,
      canIncrease: true,
      reason: undefined,
    });
  });

  test('refuses a cross-class increase without its full cost', () => {
    const result = applyCharGenSkillIncrease({
      skillRow: { scout_class: '0' },
      classSkillColumn: 'scout_class',
      level: 1,
      currentRank: 0,
      availablePoints: 1,
    });

    expect(result).toMatchObject({
      kind: 'cross-class',
      canIncrease: false,
      reason: 'insufficient-points',
      nextRank: 0,
      remainingPoints: 1,
    });
  });

  test('refuses an increase at the applicable rank cap', () => {
    const result = applyCharGenSkillIncrease({
      skillRow: { scout_class: '0' },
      classSkillColumn: 'scout_class',
      level: 1,
      currentRank: 2,
      availablePoints: 10,
    });

    expect(result).toMatchObject({
      kind: 'cross-class',
      canIncrease: false,
      reason: 'rank-cap',
      nextRank: 2,
      remainingPoints: 10,
    });
  });

  test.each([
    [{ soldier_class: '****' }, 'soldier_class'],
    [{ soldier_class: '2' }, 'soldier_class'],
    [{ soldier_class: '1' }, ''],
    [undefined, 'soldier_class'],
  ])('treats malformed class-skill data as unavailable', (skillRow, classSkillColumn) => {
    const allocation = resolveCharGenSkillAllocation({
      skillRow,
      classSkillColumn,
      level: 1,
      currentRank: 0,
      availablePoints: 10,
    });

    expect(allocation).toMatchObject({
      kind: 'unavailable',
      canIncrease: false,
      reason: 'invalid-table-data',
    });
  });
});

describe('recommended character-generation skill allocation', () => {
  const skillRows = [
    { scout_class: '1' },
    { scout_class: '0' },
  ];

  test('charges the cross-class cost before assigning a rank', () => {
    const result = allocateRecommendedCharGenSkills({
      skillRows,
      classSkillColumn: 'scout_class',
      level: 1,
      ranks: [0, 0],
      availablePoints: 3,
      recommendedOrder: [1, 0],
    });

    expect(result).toEqual({ ranks: [1, 1], remainingPoints: 0 });
  });

  test('stops when a recommended rank is capped or unaffordable', () => {
    const result = allocateRecommendedCharGenSkills({
      skillRows,
      classSkillColumn: 'scout_class',
      level: 1,
      ranks: [4, 2],
      availablePoints: 1,
      recommendedOrder: [0, 1],
    });

    expect(result).toEqual({ ranks: [4, 2], remainingPoints: 1 });
  });

  test('does not spin or spend points for invalid recommendation rows', () => {
    const result = allocateRecommendedCharGenSkills({
      skillRows,
      classSkillColumn: 'scout_class',
      level: 1,
      ranks: [0, 0],
      availablePoints: 5,
      recommendedOrder: [-1, 99, Number.NaN],
    });

    expect(result).toEqual({ ranks: [0, 0], remainingPoints: 5 });
  });
});
