import { describe, expect, test } from '@jest/globals';
import { ModuleCreatureArmorSlot } from '@/enums/module/ModuleCreatureArmorSlot';
import { buildCombatAttackPlan, selectHeldCombatAttack, countHeldCombatAttacks } from '@/combat/CombatAttackPlan';

const SABER = { name: 'saber' };
const SHORT = { name: 'short' };
const DOUBLE = { name: 'double' };
const CLAW = { name: 'claw' };

const base = {
  simple: false,
  rightHand: undefined as unknown,
  leftHand: undefined as unknown,
  claws: [] as unknown[],
  rightHandDoubleBladed: false,
  additionalAttacks: 0,
  speedAttacks: 0,
  maxAttacks: 5,
};

const shape = (plan: ReturnType<typeof buildCombatAttackPlan>) =>
  plan.map((attack) => `${attack.source}:${(attack.weapon as any)?.name ?? '-'}:${attack.slot}`);

describe('the round attack plan keeps the engine order', () => {
  test('unarmed is one attack with no weapon', () => {
    expect(shape(buildCombatAttackPlan({ ...base }))).toEqual([`unarmed:-:${ModuleCreatureArmorSlot.RIGHTHAND}`]);
  });

  test('one weapon with Flurry: the main hand, then the extra main-hand attack', () => {
    expect(shape(buildCombatAttackPlan({ ...base, rightHand: SABER, additionalAttacks: 1 }))).toEqual([
      `main-hand:saber:${ModuleCreatureArmorSlot.RIGHTHAND}`,
      `additional:saber:${ModuleCreatureArmorSlot.RIGHTHAND}`,
    ]);
  });

  test('two weapons with Flurry: main, off hand, then the extra', () => {
    expect(shape(buildCombatAttackPlan({ ...base, rightHand: SABER, leftHand: SHORT, additionalAttacks: 1 }))).toEqual([
      `main-hand:saber:${ModuleCreatureArmorSlot.RIGHTHAND}`,
      `off-hand:short:${ModuleCreatureArmorSlot.LEFTHAND}`,
      `additional:saber:${ModuleCreatureArmorSlot.RIGHTHAND}`,
    ]);
  });

  test('a double-bladed weapon rolls its second blade as the off-hand attack', () => {
    expect(shape(buildCombatAttackPlan({ ...base, rightHand: DOUBLE, rightHandDoubleBladed: true }))).toEqual([
      `main-hand:double:${ModuleCreatureArmorSlot.RIGHTHAND}`,
      `second-blade:double:${ModuleCreatureArmorSlot.LEFTHAND}`,
    ]);
  });

  test('an extra attack needs a main-hand weapon', () => {
    expect(shape(buildCombatAttackPlan({ ...base, leftHand: SHORT, additionalAttacks: 1 }))).toEqual([
      `off-hand:short:${ModuleCreatureArmorSlot.LEFTHAND}`,
    ]);
  });

  test('a simple creature rolls its claws, else what it holds, else unarmed', () => {
    expect(shape(buildCombatAttackPlan({ ...base, simple: true, claws: [CLAW, undefined, CLAW] }))).toEqual([
      `natural:claw:${ModuleCreatureArmorSlot.CLAW1}`,
      `natural:claw:${ModuleCreatureArmorSlot.CLAW3}`,
    ]);
    expect(shape(buildCombatAttackPlan({ ...base, simple: true, leftHand: SHORT }))).toEqual([
      `off-hand:short:${ModuleCreatureArmorSlot.LEFTHAND}`,
    ]);
    expect(shape(buildCombatAttackPlan({ ...base, simple: true }))).toEqual([`unarmed:-:${ModuleCreatureArmorSlot.RIGHTHAND}`]);
  });

  test('a simple creature ignores Flurry, as before', () => {
    expect(buildCombatAttackPlan({ ...base, simple: true, rightHand: SABER, additionalAttacks: 1 })).toHaveLength(1);
  });

  test('the Knight/Master Speed hook adds main-hand attacks after the rest, capped by the attack list', () => {
    const plan = buildCombatAttackPlan({ ...base, rightHand: SABER, leftHand: SHORT, additionalAttacks: 1, speedAttacks: 3 });
    expect(plan.map((attack) => attack.source)).toEqual(['main-hand', 'off-hand', 'additional', 'speed', 'speed']);
  });
});

describe('a held attack is spent by the input that can make it', () => {
  const dual = buildCombatAttackPlan({ ...base, rightHand: SABER, leftHand: SHORT, additionalAttacks: 1 });
  const double = buildCombatAttackPlan({ ...base, rightHand: DOUBLE, rightHandDoubleBladed: true, additionalAttacks: 1 });

  test('the main hand skips the off-hand attack of two weapons', () => {
    const spent = [true, false, false];
    expect(selectHeldCombatAttack(dual, spent, 'main')).toBe(2);
    expect(selectHeldCombatAttack(dual, spent, 'off')).toBe(1);
    expect(countHeldCombatAttacks(dual, spent, 'main')).toBe(1);
    expect(countHeldCombatAttacks(dual, spent, 'off')).toBe(1);
  });

  test('the second blade of a double-bladed weapon goes to the weapon hand, in order', () => {
    const spent = [true, false, false];
    expect(selectHeldCombatAttack(double, spent, 'main')).toBe(1);
    expect(selectHeldCombatAttack(double, [true, true, false], 'main')).toBe(2);
    expect(selectHeldCombatAttack(double, spent, 'off')).toBe(-1);
  });

  test('nothing left to spend', () => {
    expect(selectHeldCombatAttack(dual, [true, true, true], 'main')).toBe(-1);
    expect(selectHeldCombatAttack(dual, [true, true, true], 'off')).toBe(-1);
    expect(countHeldCombatAttacks(dual, [true, true, true], 'main')).toBe(0);
  });
});
