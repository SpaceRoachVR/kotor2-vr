import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

// CombatRound reaches three's ESM examples and the NWScript VM at import time.
// None of that is on the attack path, so stub just enough to load it.
jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/three/odyssey', () => ({ OdysseyModel3D: class {}, OdysseyObject3D: class {} }));
jest.mock('@/nwscript/NWScriptInstance', () => ({ NWScriptInstance: class {} }));
jest.mock('@/nwscript/NWScript', () => ({ NWScript: class {} }));
jest.mock('@/loaders', () => ({ MDLLoader: class {} }));
jest.mock('@/odyssey', () => ({ OdysseyModel: class {}, OdysseyModelAnimation: { GetAnimation2DA: (): undefined => undefined }, OdysseyWalkMesh: class {} }));
jest.mock('@/engine/TextSprite3D', () => ({ TextSprite3D: { CreateOnObject: jest.fn() } }));

import { GameState } from '@/GameState';
import { CombatRound } from '@/combat/CombatRound';
import { CombatAttackData } from '@/combat/CombatAttackData';
import { Dice } from '@/utility/Dice';
import { AttackResult } from '@/enums/combat/AttackResult';
import { CombatActionType } from '@/enums/combat/CombatActionType';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';

const CREATURE = ModuleObjectType.ModuleObject | ModuleObjectType.ModuleCreature;

function weapon(name: string, baseItem: number) {
  return {
    name,
    getName: () => name,
    getBaseItemId: () => baseItem,
    getBaseItem: () => ({ weaponWield: 2, weaponSize: 2 }),
    getCriticalThreatRangeMin: () => 18,
    isRangedWeapon: () => false,
  };
}

function creature(name: string, equipment: Record<string, unknown>, attackBonus: (w: any) => number) {
  const c: any = {
    objectType: CREATURE,
    equipment,
    effects: [] as unknown[],
    combatData: {},
    animationState: { index: 0 },
    getName: () => name,
    isSimpleCreature: () => false,
    isDead: () => false,
    hasEffect: () => false,
    getHasFeat: () => false,
    getAttackBonusFor: attackBonus,
    getAC: () => 20,
    weaponPowered: (): void => undefined,
    onAttacked: (): void => undefined,
    onCombatRoundEnd: (): void => undefined,
    removeEffect(effect: unknown) { const i = this.effects.indexOf(effect); if (i >= 0) this.effects.splice(i, 1); },
    model: { odysseyAnimationMap: new Map() },
    playTwoDAAnimation: (): void => undefined,
    getDamageAnimation: (): void => undefined,
    getDodgeAnimation: (): void => undefined,
  };
  c.combatRound = new CombatRound(c);
  return c;
}

/** Dice that return a fixed sequence of naturals, the same in every mode. */
function scriptDice(naturals: number[]) {
  let i = 0;
  jest.spyOn(Dice, 'roll').mockImplementation(() => naturals[i++ % naturals.length]);
}

let lines: string[];

beforeEach(() => {
  lines = [];
  (GameState as any).FeedbackMessageManager = { AddLine: (line: string) => lines.push(line), AddEntry: (): void => undefined };
  // Damage itself is CombatAttackData's business; a fixed number per weapon here.
  jest.spyOn(CombatAttackData.prototype, 'calculateDamage').mockImplementation(function (this: any) {
    this.damage = this.attackWeapon?.name === 'short' ? 7 : 12;
  });
  jest.spyOn(CombatAttackData.prototype, 'getTotalDamage').mockImplementation(function (this: any) { return this.damage ?? 0; });
  jest.spyOn(CombatAttackData.prototype, 'applyDamageEffectToCreature').mockImplementation((): void => undefined);
  jest.spyOn(CombatRound.prototype, 'calculateRoundAnimations').mockImplementation((): void => undefined);
  jest.spyOn(console, 'log').mockImplementation((): void => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  CombatRound.holdsLaterAttacks = null;
});

/** A Flurry round with a main and an off-hand weapon: three attacks. */
function startFlurryRound(hold: boolean) {
  const saber = weapon('saber', 8);
  const short = weapon('short', 10);
  const attacker = creature('Exile', { RIGHTHAND: saber, LEFTHAND: short }, (w) => (w === short ? 1 : 3));
  const target = creature('Sith', { RIGHTHAND: weapon('saber', 8) }, () => 0);
  CombatRound.holdsLaterAttacks = hold ? (owner) => owner === attacker : null;
  const round: CombatRound = attacker.combatRound;
  round.action = {
    actionType: CombatActionType.ATTACK_USE_FEAT,
    featId: 11,
    feat: { id: 11, impactCaster: (): void => undefined, impactTarget: (): void => undefined },
    target,
    animationName: 'g1a1',
    resultsCalculated: false,
  } as any;
  round.beginCombatRound();
  round.calculateAttackDamage(attacker, round.action);
  return { attacker, round };
}

describe('a round that holds its later attacks', () => {
  test('rolls the same attacks, numbers and log lines as one that rolls them all at once', () => {
    // natural, threat roll, natural, threat roll, ...
    scriptDice([19, 4, 7, 2, 20, 15]);
    startFlurryRound(false);
    const allAtOnce = [...lines];

    lines = [];
    scriptDice([19, 4, 7, 2, 20, 15]);
    const { attacker, round } = startFlurryRound(true);
    expect(lines).toEqual(allAtOnce.slice(0, lines.length));
    expect(round.heldAttackCount('main')).toBe(1);
    expect(round.heldAttackCount('off')).toBe(1);
    expect(round.resolveHeldAttack(attacker, 'off')).toBeDefined();
    expect(round.resolveHeldAttack(attacker, 'main')).toBeDefined();
    expect(round.resolveHeldAttack(attacker, 'main')).toBeUndefined();
    expect(lines).toEqual(allAtOnce);
    // Two weapons and Flurry: -4 main (balanced), -10 off, as TwoWeaponRules.
    expect(allAtOnce.filter((l) => l.startsWith('Exile attacks')).map((l) => l.slice(l.lastIndexOf('(')))).toEqual(['(19 - 1 = 18)', '(7 - 9 = -2)', '(20 - 1 = 19)']);
    expect(round.heldAttacksResolved).toBe(2);
  });

  test('the opening attack is the main hand; the off hand waits for the off hand', () => {
    scriptDice([10, 1]);
    const { attacker, round } = startFlurryRound(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Exile attacks Sith : \*(hit|miss)\* : \(10 - 1 = 9\)$/);
    expect(round.heldAttackCount('main')).toBe(1);
    round.resolveHeldAttack(attacker, 'main');
    expect(lines[lines.length - 1]).toMatch(/\(10 - 1 = 9\)$/);
    expect(round.heldAttackCount('main')).toBe(0);
    expect(round.heldAttackCount('off')).toBe(1);
  });

  test('a round result is its best attack, as before', () => {
    scriptDice([1, 1, 20, 1]);
    const { attacker, round } = startFlurryRound(true);
    expect(round.action.attackResult).toBe(AttackResult.MISS);
    round.resolveHeldAttack(attacker, 'off');
    expect(round.action.attackResult).toBe(AttackResult.HIT_SUCCESSFUL);
    expect(round.lastHeldAttackResult).toBe(AttackResult.HIT_SUCCESSFUL);
  });

  test('attacks nobody asked for are lost when the round ends', () => {
    scriptDice([10, 1]);
    const { attacker, round } = startFlurryRound(true);
    round.endCombatRound();
    expect(round.heldAttackCount('main')).toBe(0);
    expect(round.resolveHeldAttack(attacker, 'main')).toBeUndefined();
    expect(lines).toHaveLength(1);
  });

  test('nothing is held once the target is dead', () => {
    scriptDice([10, 1]);
    const { attacker, round } = startFlurryRound(true);
    (round.action.target as any).isDead = () => true;
    expect(round.heldAttackCount('main')).toBe(0);
    expect(round.resolveHeldAttack(attacker, 'off')).toBeUndefined();
  });

  test('only the round owner can roll its held attacks', () => {
    scriptDice([10, 1]);
    const { round } = startFlurryRound(true);
    expect(round.resolveHeldAttack(round.action.target as any, 'main')).toBeUndefined();
  });

  test('without a holding policy every attack rolls at the start, as retail', () => {
    scriptDice([10, 1]);
    const { round } = startFlurryRound(false);
    expect(lines).toHaveLength(3);
    expect(round.heldAttackCount('main')).toBe(0);
    expect(round.heldAttackCount('off')).toBe(0);
  });
});
