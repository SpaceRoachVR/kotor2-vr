import { describe, expect, test } from '@jest/globals';
import { CombatFeatType as F } from '@/enums/combat/CombatFeatType';
import {
  resolveCriticalMultiplierBonus, resolveFeatOnHitSave, resolveFeatSaveDC,
  resolvePowerAttackDamage, resolveThreatRangeMin, resolveThreatRangeMultiplier,
} from '@/combat/CombatFeatRules';

// TSL feat descriptions (dialog.tlk), critic run 5.
describe('stance feats do what their text says', () => {
  test('Critical Strike doubles/triples/quadruples a melee threat range; Sniper Shot a ranged one', () => {
    expect(resolveThreatRangeMultiplier(F.CRITICAL_STRIKE, false)).toBe(2);
    expect(resolveThreatRangeMultiplier(F.IMPROVED_CRITICAL_STRIKE, false)).toBe(3);
    expect(resolveThreatRangeMultiplier(F.MASTER_CRITICAL_STRIKE, false)).toBe(4);
    expect(resolveThreatRangeMultiplier(F.CRITICAL_STRIKE, true)).toBe(1);
    expect(resolveThreatRangeMultiplier(F.SNIPER_SHOT, true)).toBe(2);
    // "if a weapon needs a roll of 20, a critical hit will result on 19 or 20 / 18-20 / 17-20"
    expect(resolveThreatRangeMin(20, 2)).toBe(19);
    expect(resolveThreatRangeMin(20, 3)).toBe(18);
    expect(resolveThreatRangeMin(20, 4)).toBe(17);
    expect(resolveThreatRangeMin(19, 2)).toBe(17);
    expect(resolveThreatRangeMin(20, 1)).toBe(20);
  });

  test('Power Attack/Blast: +3/+7/+12 and +1 critical multiplier, on their own kind of attack', () => {
    expect([F.POWER_ATTACK, F.IMPROVED_POWER_ATTACK, F.MASTER_POWER_ATTACK].map((f) => resolvePowerAttackDamage(f, false))).toEqual([3, 7, 12]);
    expect([F.POWER_BLAST, F.IMPROVED_POWER_BLAST, F.MASTER_POWER_BLAST].map((f) => resolvePowerAttackDamage(f, true))).toEqual([3, 7, 12]);
    expect(resolveCriticalMultiplierBonus(F.POWER_ATTACK, false)).toBe(1);
    expect(resolveCriticalMultiplierBonus(F.POWER_ATTACK, true)).toBe(0);
  });

  test('on-hit saves: stun 6 s vs level + STR (Sniper: INT); knockdown on a critical vs level + 2x STR (Blast: DEX)', () => {
    const stun = resolveFeatOnHitSave(F.CRITICAL_STRIKE, false)!;
    expect(stun).toMatchObject({ effect: 'stun', on: 'hit', seconds: 6, ability: 'STR' });
    expect(resolveFeatOnHitSave(F.SNIPER_SHOT, true)).toMatchObject({ effect: 'stun', ability: 'INT' });
    const knock = resolveFeatOnHitSave(F.POWER_ATTACK, false)!;
    expect(knock).toMatchObject({ effect: 'knockdown', on: 'critical', ability: 'STR', abilityMultiplier: 2 });
    expect(resolveFeatOnHitSave(F.POWER_BLAST, true)).toMatchObject({ ability: 'DEX' });
    expect(resolveFeatSaveDC(stun, 5, 3)).toBe(8);
    expect(resolveFeatSaveDC(knock, 5, 3)).toBe(11);
    expect(resolveFeatOnHitSave(F.FLURRY, false)).toBeNull();
  });
});
