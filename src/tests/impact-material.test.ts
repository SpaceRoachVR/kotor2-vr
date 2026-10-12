import { describe, expect, test } from '@jest/globals';
import { impactResRef, resolveImpactMaterial } from '@/engine/rules/ImpactMaterial';

// weaponsounds.2da picks an impact by struck material (critic run 6).
describe('impact material', () => {
  test('droids and placeables ring as metal; armour, robes and skin differ', () => {
    expect(resolveImpactMaterial({ race: 5 })).toBe('metal');
    expect(resolveImpactMaterial({ isPlaceable: true })).toBe('metal');
    expect(resolveImpactMaterial({ race: 6, armorBaseItemId: 40 })).toBe('armor');
    expect(resolveImpactMaterial({ race: 6, armorBaseItemId: 35 })).toBe('cloth');
    expect(resolveImpactMaterial({ race: 6 })).toBe('leather');
    expect(resolveImpactMaterial({ race: 6, shielded: true })).toBe('forceField');
  });

  test('the weapon row gives the material sound, falling back to leather', () => {
    const row = { metal0: 'cb_ht_blademetal', metal1: '', leather0: 'cb_ht_bladeleth1' };
    expect(impactResRef(row, 'metal', 0)).toBe('cb_ht_blademetal');
    expect(impactResRef(row, 'metal', 1)).toBe('cb_ht_blademetal');
    expect(impactResRef(row, 'stone', 0)).toBe('cb_ht_bladeleth1');
    expect(impactResRef(null, 'metal')).toBe('');
  });
});
