import { ModuleObjectType } from "@/enums/module/ModuleObjectType";

export interface ObjectLockState {
  locked: boolean;
  lockable: boolean;
  keyRequired: boolean;
}

export interface SecurityUnlockAttempt extends ObjectLockState {
  readonly securitySkill: number;
  /** Raw Intelligence score. The modifier is derived here, not by the caller. */
  readonly intelligence: number;
  readonly openLockDC: number;
}

export interface ObjectBashState {
  readonly plot: boolean;
  readonly min1HP: boolean;
  readonly notBlastable: boolean;
}

export interface ObjectDestructionTarget extends ObjectBashState {
  readonly objectType: number;
}

export type SecurityUnlockResult =
  | { readonly attempted: false; readonly unlocked: false }
  | { readonly attempted: true; readonly unlocked: boolean; readonly roll: number; readonly total: number };

/**
 * Security may attempt any lock that is not reserved for a required key.
 *
 * `lockable` is deliberately NOT consulted. In Aurora/Odyssey that field means
 * "this object can be re-locked", not "this lock can be picked" — pickability
 * is expressed by `Locked` plus `OpenLockDC`. Requiring it here removed
 * Security and security tunnelers from every lock in `001EBO`, including the
 * three doors literally named "Low Security Door", each of which ships
 * `Locked=1, KeyRequired=0, OpenLockDC=21` against an actor with Security 6 —
 * unmistakably authored to be picked, yet offering only Bash.
 *
 * Story-reserved locks remain excluded by `keyRequired`: the Blast Doors
 * (`KeyRequired=1, OpenLockDC=100`) and the Footlocker (`KeyRequired=1`) are
 * still refused, so this widens the rule without opening plot-gated doors.
 */
export function canAttemptSecurityUnlock(lockState: ObjectLockState): boolean {
  return lockState.locked && !lockState.keyRequired;
}

/**
 * The engine's ability modifier, matching `CombatRound.GetMod`. Duplicated
 * rather than imported to keep this rules module free of engine dependencies.
 */
function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Rolls an authored Security attempt. Security must use a genuine d20 rather
 * than treating all out-of-combat attempts as an automatic 20.
 *
 * `d20 + Intelligence modifier + Security rank` against `OpenLockDC`.
 *
 * Two things were wrong before. Security is governed by **Intelligence** in
 * KOTOR, not Wisdom; and the term was `wisdom / 2`, which is half the raw
 * score rather than an ability modifier — so an average actor collected a flat
 * +5 it had not earned and every lock in the game sat five points too easy.
 * `getSkillLevel` returns the raw rank with no modifier folded in, so the
 * modifier genuinely belongs here.
 */
export function resolveSecurityUnlock(
  attempt: SecurityUnlockAttempt,
  rollD20: () => number,
): SecurityUnlockResult {
  validateSecurityAttempt(attempt, rollD20);
  if (!canAttemptSecurityUnlock(attempt) || attempt.securitySkill < 1) {
    return { attempted: false, unlocked: false };
  }

  const roll = rollD20();
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
    throw new RangeError('Security d20 roll must be an integer between 1 and 20');
  }
  const total = roll + abilityModifier(attempt.intelligence) + attempt.securitySkill;
  return { attempted: true, unlocked: total > attempt.openLockDC, roll, total };
}

/** Plot, Min1HP, and NotBlastable objects never expose the generic Bash route. */
export function canBashObject(state: ObjectBashState): boolean {
  return !state.plot && !state.min1HP && !state.notBlastable;
}

/**
 * Planting a mine is an explosives route, not a Bash, and `NotBlastable` is the
 * flag that governs it. `Plot` is deliberately NOT consulted.
 *
 * Gating mine placement on `canBashObject` made `Plot` block explosives too,
 * which sealed the Peragus prologue: `001EBO`'s Engine Room Door ships
 * `Plot=1, NotBlastable=0, HP=1` and its own conversation reads "This door is
 * damaged and cannot be opened with your Security skill, or by bashing it. You
 * can use a mine to open this door." It is the only way to the hyperdrive, and
 * repairing the hyperdrive is what sets `001EBO_HyperDrive`, which is what
 * makes Peragus selectable on the Galaxy Map. With the Bash rule applied, the
 * prologue could not be finished at all.
 *
 * The retail flags settle the rule rather than inference: of the ten door
 * templates in `001EBO`, every locked one carries `NotBlastable=1` except
 * `engine_door` — the single door the game tells the player to blow open. So
 * `NotBlastable` expresses "explosives do nothing here" and `Plot` expresses
 * "attacks cannot destroy this", which are different questions.
 *
 * `Min1HP` is still honoured: an object that cannot be reduced below 1 HP is
 * one the designer marked as surviving damage outright, and trap detonation
 * assigns HP directly.
 */
export function canPlaceMineOnObject(state: ObjectBashState): boolean {
  return !state.notBlastable && !state.min1HP;
}

/** Returns whether an object is one of the world targets that can be bashed or mined. */
export function isObjectDestructionTarget(value: unknown): value is ObjectDestructionTarget {
  if (!value || typeof value !== 'object') return false;
  const target = value as Partial<ObjectDestructionTarget>;
  return typeof target.objectType === 'number' &&
    (target.objectType & (ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable)) !== 0;
}

/**
 * Revalidates the authored destruction rules when a queued Bash action
 * executes. Menu visibility alone is not an authorization boundary because an
 * action can outlive a target-state change or be forged by a script/save.
 */
export function canExecuteObjectDestruction(value: unknown): boolean {
  return isObjectDestructionTarget(value) && canBashObject(value);
}

/**
 * The same revalidation for a queued mine placement, against the explosives
 * rule rather than the Bash rule. See {@link canPlaceMineOnObject}.
 */
export function canExecuteMinePlacement(value: unknown): boolean {
  return isObjectDestructionTarget(value) && canPlaceMineOnObject(value);
}

function validateSecurityAttempt(
  attempt: SecurityUnlockAttempt,
  rollD20: unknown,
): asserts attempt is SecurityUnlockAttempt {
  if (!attempt || typeof attempt !== 'object') {
    throw new TypeError('Security unlock attempt is required');
  }
  if (typeof rollD20 !== 'function') {
    throw new TypeError('Security unlock requires a d20 roll function');
  }
  for (const [name, value] of Object.entries({
    securitySkill: attempt.securitySkill,
    intelligence: attempt.intelligence,
    openLockDC: attempt.openLockDC,
  })) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Security unlock ${name} must be finite`);
    }
  }
}
