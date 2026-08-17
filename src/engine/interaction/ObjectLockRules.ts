export interface ObjectLockState {
  locked: boolean;
  lockable: boolean;
  keyRequired: boolean;
}

/**
 * Security can only operate on locks explicitly authored as lockable and not
 * reserved for a required key or story-controlled unlock path.
 */
export function canAttemptSecurityUnlock(lockState: ObjectLockState): boolean {
  return lockState.locked && lockState.lockable && !lockState.keyRequired;
}
