import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { scriptedDamageComponents } from '@/effects/scriptedDamageComponents';
import { calculateDamageAmount } from '@/effects/calculateDamageAmount';
import { DamageType } from '@/enums/combat/DamageType';

/** Fill an EffectDamage-shaped int list the way the routine does. */
function intListFor(amount: number, damageType: number): number[] {
  const list = new Array(21).fill(-1);
  for (const [slot, value] of scriptedDamageComponents(amount, damageType)) list[slot] = value;
  return list;
}

describe('scriptedDamageComponents', () => {
  test('a fire hit from tr_steamdam lands once, in the fire slot', () => {
    // EffectDamage(d3(1) + 1, 256, 0): 256 is DAMAGE_TYPE_FIRE, slot 8.
    expect(scriptedDamageComponents(3, 256)).toEqual([[8, 3]]);
    expect(calculateDamageAmount(intListFor(3, 256))).toBe(3);
  });

  test.each([
    [1, 0],   // BLUDGEONING
    [2, 1],   // PIERCING
    [4, 2],   // SLASHING
    [8, 3],   // UNIVERSAL
    [4096, 12], // ENERGY, the last typed slot
  ])('maps flag %i to slot %i and sums to the amount once', (flag, slot) => {
    expect(scriptedDamageComponents(5, flag)).toEqual([[slot, 5]]);
    expect(calculateDamageAmount(intListFor(5, flag))).toBe(5);
  });

  test('an untyped, combined or out-of-range type falls back to the physical slot alone', () => {
    expect(scriptedDamageComponents(7, 0)).toEqual([[DamageType.PHYSICAL, 7]]);
    expect(scriptedDamageComponents(7, 3)).toEqual([[DamageType.PHYSICAL, 7]]);
    expect(scriptedDamageComponents(7, 1 << 20)).toEqual([[DamageType.PHYSICAL, 7]]);
    expect(calculateDamageAmount(intListFor(7, 3))).toBe(7);
  });

  test('rejects non-finite input', () => {
    expect(() => scriptedDamageComponents(Number.NaN, 256)).toThrow(TypeError);
    expect(() => scriptedDamageComponents(3, Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });

  test('the EffectDamage routine no longer writes slot 14 beside the typed slot', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'nwscript', 'NWScriptDefK1.ts'), 'utf8');
    const start = source.indexOf('name: "EffectDamage"');
    const body = source.slice(start, source.indexOf('name: "EffectAbilityIncrease"', start));
    expect(body).toContain('scriptedDamageComponents(args[0], args[1])');
    expect(body).not.toContain('effect.setInt(14, args[0])');
  });
});
