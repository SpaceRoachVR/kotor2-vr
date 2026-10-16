import { describe, expect, test, jest } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));
import { meetsUseLimits } from '@/engine/rules/ItemUseLimits';
import { InventoryManager } from '@/managers/InventoryManager';

const L = (property: number, subType: number) => ({ property, subType });
const w = (goodEvil: number) => ({ goodEvil });

describe('meetsUseLimits', () => {
  test('no limits passes', () => expect(meetsUseLimits([], w(50))).toBe(true));
  test('light side', () => {
    expect(meetsUseLimits([L(43, 2)], w(80))).toBe(true);
    expect(meetsUseLimits([L(43, 2)], w(50))).toBe(false);
  });
  test('dark side', () => expect(meetsUseLimits([L(43, 3)], w(10))).toBe(true));
  test('name crystal dark (dark or neutral)', () => {
    expect(meetsUseLimits([L(43, 3), L(43, 1)], w(50))).toBe(true);
    expect(meetsUseLimits([L(43, 3), L(43, 1)], w(80))).toBe(false);
  });
  test('any match across installed parts passes', () => {
    expect(meetsUseLimits([L(43, 3), L(43, 1), L(43, 2)], w(80))).toBe(true);
  });
  test('100% light', () => {
    expect(meetsUseLimits([L(43, 5)], w(99))).toBe(false);
    expect(meetsUseLimits([L(43, 5)], w(100))).toBe(true);
  });
  test('100% dark', () => {
    expect(meetsUseLimits([L(43, 4)], w(0))).toBe(true);
    expect(meetsUseLimits([L(43, 4)], w(1))).toBe(false);
  });
  test('All passes', () => expect(meetsUseLimits([L(43, 0)], w(50))).toBe(true));
  test('other limitation types ignored', () => expect(meetsUseLimits([L(45, 2)], w(50))).toBe(true));
});

describe('InventoryManager.isItemUsableBy', () => {
  const item = {
    baseItem: { droidOrHuman: 0 },
    getEffectiveProperties: () => [{ propertyName: 43, subType: 2 }],
  } as any;
  const creature = (g: number) => ({ getGoodEvil: () => g, getRace: () => 6 }) as any;
  test('alignment limit from effective properties', () => {
    expect(InventoryManager.isItemUsableBy(item, creature(80))).toBe(true);
    expect(InventoryManager.isItemUsableBy(item, creature(20))).toBe(false);
  });
});
