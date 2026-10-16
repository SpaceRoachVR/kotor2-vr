import { describe, expect, test } from '@jest/globals';
import { itemDeflectionBonus, type DeflectionPropertyInput } from '@/combat/itemDeflectionBonus';

const increase = (rowValue: number | undefined, useable = true, costValue = rowValue ?? 0): DeflectionPropertyInput =>
  ({ propertyName: 55, useable, rowValue, costValue });
const decrease = (rowValue: number | undefined, useable = true, costValue = Math.abs(rowValue ?? 0)): DeflectionPropertyInput =>
  ({ propertyName: 56, useable, rowValue, costValue });

describe('itemDeflectionBonus', () => {
  test('no deflection properties gives 0', () => {
    expect(itemDeflectionBonus([])).toBe(0);
    expect(itemDeflectionBonus([{ propertyName: 38, useable: true, rowValue: 3, costValue: 3 }])).toBe(0);
  });

  test('Jenruax (+5) and a Pure Kunda lens (+2) add up', () => {
    expect(itemDeflectionBonus([increase(5), increase(2)])).toBe(7);
  });

  test('a decrease (iprp_neg10cost value "-2") subtracts', () => {
    // Fencing Emitter: 56, CostTable 21, CostValue 2 -> value -2.
    expect(itemDeflectionBonus([increase(5), decrease(-2)])).toBe(3);
  });

  test('the decrease sign does not depend on the table storing it negative', () => {
    expect(itemDeflectionBonus([decrease(2)])).toBe(-2);
  });

  test('a property gated off by isUseable (K1 UpgradeType leftover) is ignored', () => {
    // Every stock saber carries 55 / +5 tagged with K1 UpgradeType 6.
    expect(itemDeflectionBonus([increase(5, false), increase(1)])).toBe(1);
  });

  test('a missing cost-table row falls back to CostValue', () => {
    expect(itemDeflectionBonus([increase(undefined, true, 4), decrease(undefined, true, 3)])).toBe(1);
  });
});
