export interface ObjectLockState {
  locked: boolean;
  lockable: boolean;
  keyRequired: boolean;
}

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
