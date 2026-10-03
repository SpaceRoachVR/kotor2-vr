import { describe, expect, test } from '@jest/globals';
import { alignmentCostBand, calculateForcePointCost, getAlignmentCostAdjustment } from '@/talents/forcePowerCostRules';

// Critic run 12: the TSL chart (Force Power Cost Adjustment). 41-60 is
// neutral; light powers are 10/15/20/30/50 % cheaper at 61-70/71-80/81-90/
// 91-99/100 and 25/25/50/50/75 % dearer at 31-40/21-30/11-20/1-10/0; dark
// powers mirror it.
describe('Force power cost bands', () => {
  const light = (a: number) => calculateForcePointCost({ baseForcePoints: 15, powerAlignment: 'G', casterAlignment: a });
  const dark = (a: number) => calculateForcePointCost({ baseForcePoints: 20, powerAlignment: 'E', casterAlignment: a });

  test('every band edge', () => {
    expect([0, 1, 10, 11, 20, 21, 30, 31, 40, 41, 60, 61, 70, 71, 80, 81, 90, 91, 99, 100].map((a) => alignmentCostBand(a).band))
      .toEqual([5, 4, 4, 3, 3, 2, 2, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5]);
  });

  test('a light power for the alignments the engine got wrong', () => {
    expect(light(45)).toBe(15);
    expect(light(60)).toBe(15);
    expect(light(61)).toBe(14);
    expect(light(70)).toBe(14);
    expect(light(90)).toBe(12);
    expect(light(100)).toBe(8);
    expect(light(40)).toBe(18);
  });

  test('a dark power mirrors it', () => {
    expect(dark(45)).toBe(20);
    expect(dark(60)).toBe(20);
    expect(dark(61)).toBe(25);
    expect(dark(80)).toBe(25);
    expect(dark(81)).toBe(30);
    expect(dark(100)).toBe(35);
    expect(dark(40)).toBe(18);
  });

  test('universal powers never change', () => {
    expect(getAlignmentCostAdjustment('-', 0)).toEqual({ penaltyPercent: 0, discountPercent: 0 });
  });
});
