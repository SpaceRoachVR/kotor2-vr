/**
 * "Bash persists" (Allen, 2026-10-13, headset round 18). Bash is still picked
 * from the world prompt first (round 6), but only once: from then on every
 * swing or shot at that door or container bashes it, until it breaks, the
 * player leaves, or the player picks something else.
 *
 * Retargeting is the caller's business (any other prompt pick, or an attack
 * on another target, disarms); this file holds the two small rules.
 */

/** Walking further than this from the armed object counts as leaving it. */
export const VR_BASH_LEAVE_DISTANCE_METRES = 5;

export interface VRBashArmedState {
  /** The armed object still exists. */
  readonly targetFound: boolean;
  /** Still locked: a bashed-open door or container has nothing left to bash. */
  readonly targetLocked: boolean;
  /** It is in the player's current area. */
  readonly sameArea: boolean;
  /** Player to object, in metres. */
  readonly distanceMetres: number;
}

export function shouldKeepVRBashArmed(state: Readonly<VRBashArmedState>): boolean {
  if (!state || typeof state !== 'object') throw new TypeError('A Bash armed state is required.');
  return state.targetFound === true && state.targetLocked === true && state.sameArea === true &&
    Number.isFinite(state.distanceMetres) && state.distanceMetres <= VR_BASH_LEAVE_DISTANCE_METRES;
}

/**
 * One stroke is one attack. A stroke while an attack on the target is still
 * waiting to run adds nothing; any other stroke bashes, including one made
 * while the previous attack's round is still playing out (it runs next).
 */
export function shouldDispatchVRBashStroke(input: { readonly attackWaitingOnTarget: boolean }): boolean {
  if (!input || typeof input.attackWaitingOnTarget !== 'boolean') {
    throw new TypeError('A Bash stroke input is required.');
  }
  return !input.attackWaitingOnTarget;
}
