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

  test('restricts droids from purchasing droid-restricted skills', () => {
    const stealthRow = { droidcanuse: '0', drc_class: '0' };
    const allocation = resolveCharGenSkillAllocation({
      skillRow: stealthRow,
      classSkillColumn: 'drc_class',
      level: 1,
      currentRank: 0,
      availablePoints: 10,
      isDroid: true,
    });

    expect(allocation).toEqual({
      kind: 'unavailable',
      rankCost: 0,
      maximumRank: 0,
      canIncrease: false,
      reason: 'droid-restricted',
    });
  });

  test('allows class-skill feats to convert cross-class skills to class skills', () => {
    const demoRow = { jcn_class: '0', droidcanuse: '1' };
    // Normally Demolitions is cross-class for Consular
    const normal = resolveCharGenSkillAllocation({
      skillRow: demoRow,
      classSkillColumn: 'jcn_class',
      level: 1,
      currentRank: 0,
      availablePoints: 10,
    });
    expect(normal.kind).toBe('cross-class');
    expect(normal.rankCost).toBe(2);
    expect(normal.maximumRank).toBe(2);

    // With Class Skill: Demolitions feat
    const withFeat = resolveCharGenSkillAllocation({
      skillRow: demoRow,
      classSkillColumn: 'jcn_class',
      level: 1,
      currentRank: 0,
      availablePoints: 10,
      hasClassSkillFeat: true,
    });
    expect(withFeat.kind).toBe('class');
    expect(withFeat.rankCost).toBe(1);
    expect(withFeat.maximumRank).toBe(4);
  });

  test('all 15 class column codes evaluate class vs cross-class correctly', () => {
    const classCodes = ['sol', 'sct', 'scd', 'jgd', 'jcn', 'jsn', 'drc', 'drx', 'tec', 'jwm', 'jma', 'jwa', 'sma', 'sld', 'sas'];
    for (const code of classCodes) {
      const col = `${code}_class`;
      const classAlloc = resolveCharGenSkillAllocation({
        skillRow: { [col]: '1', droidcanuse: '1' },
        classSkillColumn: col,
        level: 1,
        currentRank: 0,
        availablePoints: 5,
      });
      expect(classAlloc.kind).toBe('class');
      expect(classAlloc.rankCost).toBe(1);

      const crossAlloc = resolveCharGenSkillAllocation({
        skillRow: { [col]: '0', droidcanuse: '1' },
        classSkillColumn: col,
        level: 1,
        currentRank: 0,
        availablePoints: 5,
      });
      expect(crossAlloc.kind).toBe('cross-class');
      expect(crossAlloc.rankCost).toBe(2);
    }
  });
});
