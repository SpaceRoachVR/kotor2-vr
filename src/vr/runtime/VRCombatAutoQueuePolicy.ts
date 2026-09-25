export interface VRCombatAutoQueuePolicyInput {
  readonly isControlledActor: boolean;
  readonly embodiedVRInputActive: boolean;
  /**
   * A script has commanded this actor to attack something (NWScript
   * ActionAttack, e.g. 105PER's a_bash_console making the PC destroy the
   * Turbolift Console) and that target is still standing. An authored
   * command is not a player swing, so it keeps its own queue filled.
   */
  readonly scriptedAttackPending?: boolean;
}

/**
 * The desktop loop fills a controlled actor's empty combat queue automatically.
 * Embodied VR must leave that queue empty until an eligible physical input
 * explicitly asks the authored combat pipeline to add its next action.
 */
export function shouldAutoQueueControlledBasicAttack(
  input: Readonly<VRCombatAutoQueuePolicyInput>,
): boolean {
  if (!input || typeof input !== 'object') {
    throw new TypeError('A combat auto-queue policy input is required.');
  }
  if (typeof input.isControlledActor !== 'boolean' || typeof input.embodiedVRInputActive !== 'boolean') {
    throw new TypeError('Combat auto-queue policy values must be boolean.');
  }
  if (input.scriptedAttackPending !== undefined && typeof input.scriptedAttackPending !== 'boolean') {
    throw new TypeError('Combat auto-queue policy values must be boolean.');
  }
  if (input.scriptedAttackPending === true) return true;
  return input.isControlledActor && !input.embodiedVRInputActive;
}
