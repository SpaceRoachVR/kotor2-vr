import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { GameEffectType } from '@/enums/effects/GameEffectType';
import { SkillType } from '@/enums/nwscript/SkillType';
import { resolveEffectiveSkillRank } from '@/engine/interaction/SkillEffectRules';
import { resolveSecurityUnlock } from '@/engine/interaction/ObjectLockRules';

/**
 * `getSkillLevel` returned the raw rank and never consulted effects, so
 * `EffectSkillIncrease` / `EffectSkillDecrease` were inert engine-wide. The
 * security tunneler was the visible casualty: `ActionUnlockObject` attaches the
 * ThievesTools bonus as a temporary EffectSkillIncrease on SECURITY, then
 * `attemptUnlock` resolved the check through `getSkillLevel` and never saw it.
 *
 * Reported from a headset session: using a tunneler on the High Security
 * Cylinder produced the same failure as not using one, and the module's own
 * OnFailToOpen tutorial bark fired telling the player to use a tunneler.
 */
function skillEffect(type: number, skillId: number, amount: number) {
  const intList = [skillId, amount];
  return { type, getInt: (offset: number) => intList[offset] };
}

describe('resolveEffectiveSkillRank', () => {
  test('returns the base rank when there are no effects', () => {
    expect(resolveEffectiveSkillRank(6, [], SkillType.SECURITY)).toBe(6);
  });

  test.each([
    ['null', null],
    ['undefined', undefined],
  ])('returns the base rank when the effect list is %s', (_name, effects) => {
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(6);
  });

  test('adds a skill increase for the matching skill', () => {
    const effects = [skillEffect(GameEffectType.EffectSkillIncrease, SkillType.SECURITY, 8)];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(14);
  });

  test('subtracts a skill decrease for the matching skill', () => {
    const effects = [skillEffect(GameEffectType.EffectSkillDecrease, SkillType.SECURITY, 4)];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(2);
  });

  test('accumulates several effects on the same skill', () => {
    const effects = [
      skillEffect(GameEffectType.EffectSkillIncrease, SkillType.SECURITY, 8),
      skillEffect(GameEffectType.EffectSkillIncrease, SkillType.SECURITY, 2),
      skillEffect(GameEffectType.EffectSkillDecrease, SkillType.SECURITY, 3),
    ];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(13);
  });

  test('ignores an effect targeting a different skill', () => {
    const effects = [skillEffect(GameEffectType.EffectSkillIncrease, SkillType.DEMOLITIONS, 8)];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(6);
  });

  test('ignores an effect that is not a skill effect', () => {
    const effects = [skillEffect(GameEffectType.EffectDamage, SkillType.SECURITY, 8)];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(6);
  });

  // A decrease may cancel a skill but never invert it: a negative rank would
  // flow into resolveSecurityUnlock's total and silently harden every lock.
  test('clamps at zero rather than going negative', () => {
    const effects = [skillEffect(GameEffectType.EffectSkillDecrease, SkillType.SECURITY, 99)];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(0);
  });

  // A malformed effect out of a save must not make every later check NaN.
  test.each([
    ['an absent amount', undefined],
    ['a NaN amount', Number.NaN],
  ])('ignores %s instead of poisoning the total', (_name, amount) => {
    const effects = [
      skillEffect(GameEffectType.EffectSkillIncrease, SkillType.SECURITY, amount as number),
    ];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(6);
  });

  test('survives a malformed entry in the effect list', () => {
    const effects = [
      null as never,
      {} as never,
      skillEffect(GameEffectType.EffectSkillIncrease, SkillType.SECURITY, 8),
    ];
    expect(resolveEffectiveSkillRank(6, effects, SkillType.SECURITY)).toBe(14);
  });
});

/**
 * The authored thresholds this fix exists to make reachable. T3-M4 ships
 * Security 6 and Intelligence 16 (+3), and outside combat the check takes 20,
 * so an unaided attempt totals 29 — short of both locks the module places in
 * front of the player, each of which is authored around a tunneler.
 */
describe('the security tunneler against the authored Peragus locks', () => {
  const T3M4 = { locked: true, lockable: false, keyRequired: false, intelligence: 16 };
  const rollD20 = () => 20;

  function attempt(securitySkill: number, openLockDC: number) {
    return resolveSecurityUnlock(
      { ...T3M4, securitySkill, inCombat: false, openLockDC },
      rollD20,
    );
  }

  test('an unaided attempt totals 29', () => {
    const result = attempt(6, 33);
    expect(result.attempted).toBe(true);
    expect(result.attempted && result.total).toBe(29);
  });

  test.each([
    ['combat-training Metal Box', 33],
    ['High Security Cylinder', 36],
  ])('fails the %s without a tunneler, exactly as authored', (_name, dc) => {
    expect(attempt(6, dc).unlocked).toBe(false);
  });

  // With the bonus actually reaching the roll, the same attempt clears the lock.
  test.each([
    ['combat-training Metal Box', 33, 8],
    ['High Security Cylinder', 36, 12],
  ])('opens the %s once the tunneler bonus reaches the roll', (_name, dc, bonus) => {
    const effects = [
      skillEffect(GameEffectType.EffectSkillIncrease, SkillType.SECURITY, bonus),
    ];
    const effective = resolveEffectiveSkillRank(6, effects, SkillType.SECURITY);
    expect(attempt(effective, dc).unlocked).toBe(true);
  });
});

/**
 * The delegation itself. `ModuleCreature` cannot be imported here — its module
 * graph reaches GameState and the managers barrel — so this pins the call
 * rather than re-deriving the arithmetic.
 */
describe('ModuleCreature.getSkillLevel', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/module/ModuleCreature.ts'),
    'utf8',
  );

  test('resolves through the effect-aware rule rather than the raw rank', () => {
    const body = source.slice(source.search(/getSkillLevel\(value: number\)\s*\{/));
    const method = body.slice(0, body.indexOf('\n  }'));
    expect(method).toContain('resolveEffectiveSkillRank');
    expect(method).toContain('this.effects');
  });

  test('imports the rule', () => {
    expect(source).toMatch(
      /import\s*\{\s*resolveEffectiveSkillRank\s*\}\s*from\s*"@\/engine\/interaction\/SkillEffectRules"/,
    );
  });
});
