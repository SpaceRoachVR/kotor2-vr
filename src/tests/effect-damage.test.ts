import { describe, expect, test } from '@jest/globals';
import { calculateDamageAmount } from '@/effects/calculateDamageAmount';
import { DamageType } from '@/enums/combat/DamageType';

describe('EffectDamage damage totals', () => {
  test('sums every positive damage-type component', () => {
    const components = new Array<number>(21).fill(-1);
    components[DamageType.BLUDGEONING] = 7;
    components[DamageType.FIRE] = 4;
    components[DamageType.BASE] = 3;
    components[DamageType.PHYSICAL] = 2;

    expect(calculateDamageAmount(components)).toBe(16);
  });

  test('ignores unset and non-positive component slots', () => {
    const components = new Array<number>(21).fill(-1);
    components[DamageType.PIERCING] = 5;
    components[DamageType.COLD] = 0;
    components[DamageType.ION] = -10;

    expect(calculateDamageAmount(components)).toBe(5);
  });

  test('preserves the engine minimum and maximum damage bounds', () => {
    expect(calculateDamageAmount(new Array<number>(21).fill(-1))).toBe(1);

    const components = new Array<number>(21).fill(-1);
    components[DamageType.UNIVERSAL] = 9_000;
    components[DamageType.ENERGY] = 4_000;
    expect(calculateDamageAmount(components)).toBe(10_000);
  });

  test('ignores non-finite values and non-damage metadata slots', () => {
    const components = new Array<number>(21).fill(-1);
    components[DamageType.ACID] = Number.NaN;
    components[DamageType.SONIC] = Number.POSITIVE_INFINITY;
    components[17] = 50_000;

    expect(calculateDamageAmount(components)).toBe(1);
  });
});
