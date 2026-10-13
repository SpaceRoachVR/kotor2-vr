import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";

/**
 * Where one attack of a combat round comes from.
 * - `main-hand` / `off-hand`: the weapon in that hand.
 * - `second-blade`: a double-bladed weapon's second blade, rolled as the
 *   off-hand attack with the weapon in the main hand.
 * - `additional`: Flurry / Rapid Shot's extra main-hand attack.
 * - `speed`: Knight/Master Speed's extra attacks per round.
 * - `natural`: a simple creature's claw or bite.
 * - `unarmed`: no weapon at all.
 */
export type CombatAttackSource =
  | 'main-hand'
  | 'off-hand'
  | 'second-blade'
  | 'additional'
  | 'speed'
  | 'natural'
  | 'unarmed';

export interface CombatPlannedAttack<W> {
  readonly source: CombatAttackSource;
  readonly weapon: W | undefined;
  readonly slot: ModuleCreatureArmorSlot;
}

export interface CombatAttackPlanInput<W> {
  /** The appearance's simple model type (claws), as `isSimpleCreature()`. */
  readonly simple: boolean;
  readonly rightHand: W | undefined;
  readonly leftHand: W | undefined;
  /** CLAW1, CLAW2, CLAW3 in that order. */
  readonly claws: readonly (W | undefined)[];
  readonly rightHandDoubleBladed: boolean;
  /** Flurry / Rapid Shot this round. */
  readonly additionalAttacks: number;
  /**
   * Knight Speed (+1) and Master Speed (+2) attacks per round, from the feat
   * text. Nothing grants them yet: the rule is still to be restored, and when
   * it is, its count goes here. The plan already places them after every
   * other attack of the round.
   */
  readonly speedAttacks: number;
  /** The round's attack list holds this many results; later attacks never roll. */
  readonly maxAttacks: number;
}

/**
 * The attacks one creature makes in one combat round, in the order the round
 * rolls them. A pure description of what `CombatRound.calculateAttackDamage`
 * has always rolled: it lets the round resolve them all at once, as the
 * engine does by default, or one at a time.
 */
export function buildCombatAttackPlan<W>(input: Readonly<CombatAttackPlanInput<W>>): CombatPlannedAttack<W>[] {
  const plan: CombatPlannedAttack<W>[] = [];
  const add = (source: CombatAttackSource, weapon: W | undefined, slot: ModuleCreatureArmorSlot) => {
    plan.push(Object.freeze({ source, weapon, slot }));
  };
  const right = input.rightHand;
  const left = input.leftHand;

  if (!input.simple) {
    if (!right && !left) add('unarmed', undefined, ModuleCreatureArmorSlot.RIGHTHAND);
    if (right) add('main-hand', right, ModuleCreatureArmorSlot.RIGHTHAND);
    if (left) add('off-hand', left, ModuleCreatureArmorSlot.LEFTHAND);
    else if (right && input.rightHandDoubleBladed) add('second-blade', right, ModuleCreatureArmorSlot.LEFTHAND);
    for (let i = 0; i < count(input.additionalAttacks); i++) {
      if (right) add('additional', right, ModuleCreatureArmorSlot.RIGHTHAND);
    }
    for (let i = 0; i < count(input.speedAttacks); i++) {
      if (right) add('speed', right, ModuleCreatureArmorSlot.RIGHTHAND);
      else if (!left) add('speed', undefined, ModuleCreatureArmorSlot.RIGHTHAND);
    }
  } else {
    const clawSlots = [ModuleCreatureArmorSlot.CLAW1, ModuleCreatureArmorSlot.CLAW2, ModuleCreatureArmorSlot.CLAW3];
    input.claws.slice(0, 3).forEach((claw, i) => {
      if (claw) add('natural', claw, clawSlots[i]);
    });
    // "Simple" is the model type, not a statement that the creature fights
    // with claws: one with no claw fights with whatever it holds.
    if (plan.length == 0) {
      if (right) add('main-hand', right, ModuleCreatureArmorSlot.RIGHTHAND);
      if (left) add('off-hand', left, ModuleCreatureArmorSlot.LEFTHAND);
      if (plan.length == 0) add('unarmed', undefined, ModuleCreatureArmorSlot.RIGHTHAND);
    }
  }

  return plan.slice(0, Math.max(0, Math.floor(input.maxAttacks)));
}

/**
 * Which hand makes an attack: a separate off-hand weapon needs the off hand;
 * everything else, a double-bladed weapon's second blade included, is the
 * weapon hand's.
 */
export type CombatAttackHand = 'main' | 'off';

export function combatAttackHand(source: CombatAttackSource): CombatAttackHand {
  return source === 'off-hand' ? 'off' : 'main';
}

/** The first attack of the plan not yet rolled that `hand` makes, or -1. */
export function selectHeldCombatAttack<W>(
  plan: readonly CombatPlannedAttack<W>[],
  spent: readonly boolean[],
  hand: CombatAttackHand,
): number {
  for (let i = 0; i < plan.length; i++) {
    if (spent[i]) continue;
    if (combatAttackHand(plan[i].source) === hand) return i;
  }
  return -1;
}

/** How many attacks of the plan `hand` still has to make. */
export function countHeldCombatAttacks<W>(
  plan: readonly CombatPlannedAttack<W>[],
  spent: readonly boolean[],
  hand: CombatAttackHand,
): number {
  let left = 0;
  for (let i = 0; i < plan.length; i++) {
    if (!spent[i] && combatAttackHand(plan[i].source) === hand) left++;
  }
  return left;
}

function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
