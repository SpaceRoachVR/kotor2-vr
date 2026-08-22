export interface ObjectLockState {
  locked: boolean;
  lockable: boolean;
  keyRequired: boolean;
}

export interface SecurityUnlockAttempt extends ObjectLockState {
  readonly securitySkill: number;
  readonly wisdom: number;
  readonly openLockDC: number;
}

export interface ObjectBashState {
  readonly plot: boolean;
  readonly min1HP: boolean;
  readonly notBlastable: boolean;
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
 * Rolls an authored Security attempt. Security must use a genuine d20 rather
 * than treating all out-of-combat attempts as an automatic 20.
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
  const total = roll + (attempt.wisdom / 2) + attempt.securitySkill;
  return { attempted: true, unlocked: total >= attempt.openLockDC, roll, total };
}

/** Plot, Min1HP, and NotBlastable objects never expose the generic Bash route. */
export function canBashObject(state: ObjectBashState): boolean {
  return !state.plot && !state.min1HP && !state.notBlastable;
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
    wisdom: attempt.wisdom,
    openLockDC: attempt.openLockDC,
  })) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`Security unlock ${name} must be finite`);
    }
  }
}
