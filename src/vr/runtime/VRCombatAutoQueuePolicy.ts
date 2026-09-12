export interface VRCombatAutoQueuePolicyInput {
  readonly isControlledActor: boolean;
  readonly embodiedVRInputActive: boolean;
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
  return input.isControlledActor && !input.embodiedVRInputActive;
}
