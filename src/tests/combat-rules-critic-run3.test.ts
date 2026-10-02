import { describe, expect, test, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/GameState', () => ({ GameState: {} }));
import { resolvePowerAttackDamage } from '@/combat/CombatAttackData';
import { CombatFeatType } from '@/enums/combat/CombatFeatType';

// Critic run 3 (KOTOR fan): Power Attack damage was on for every hit, the
// tiers stacked to +23, and attack/defense effects did nothing.
describe('Power Attack and Power Blast damage', () => {
  test('only the feat the attack uses, at its tier', () => {
    expect(resolvePowerAttackDamage(undefined, false)).toBe(0);
    expect(resolvePowerAttackDamage(CombatFeatType.POWER_ATTACK, false)).toBe(5);
    expect(resolvePowerAttackDamage(CombatFeatType.IMPROVED_POWER_ATTACK, false)).toBe(8);
    expect(resolvePowerAttackDamage(CombatFeatType.MASTER_POWER_ATTACK, false)).toBe(10);
  });
  test('Attack is melee, Blast is ranged', () => {
    expect(resolvePowerAttackDamage(CombatFeatType.POWER_ATTACK, true)).toBe(0);
    expect(resolvePowerAttackDamage(CombatFeatType.POWER_BLAST, true)).toBe(5);
    expect(resolvePowerAttackDamage(CombatFeatType.POWER_BLAST, false)).toBe(0);
  });
});

describe('effects reach attack and defense', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleCreature.ts'), 'utf8');
  test('attack bonus counts EffectAttackIncrease/Decrease', () => {
    const at = src.indexOf('getAttackBonusFor(weapon?: ModuleItem): number {');
    const body = src.slice(at, src.indexOf('\n  }', at));
    expect(body).toContain('GameEffectType.EffectAttackIncrease');
    expect(body).toContain('GameEffectType.EffectAttackDecrease');
  });
  test('defense counts EffectACIncrease/Decrease, other worn items and the armor Dex cap', () => {
    const at = src.indexOf('  getAC(){');
    const body = src.slice(at, src.indexOf('\n  }', at));
    expect(body).toContain('GameEffectType.EffectACIncrease');
    expect(body).toContain("'BELT'");
    expect(body).toContain('getDexBonus');
  });
});
