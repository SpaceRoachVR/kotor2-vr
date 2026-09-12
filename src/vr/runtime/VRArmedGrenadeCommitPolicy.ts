export interface VRArmedGrenadeCommitRevalidation {
  readonly sourceAvailable: boolean;
  readonly targetAvailable: boolean;
  readonly tempoEligible: boolean;
}

export type VRArmedGrenadeCommitEligibility = 'commit' | 'defer-tempo' | 'cancel-invalid';

/**
 * Classifies a triggered grenade after its inventory source, locked target,
 * and d20 tempo window have all been checked live.
 *
 * Only a valid grenade awaiting a future tempo window remains armed. A missing
 * source or target is not retryable: retaining it would present an off-hand
 * object the player can no longer legally throw.
 */
export function resolveVRArmedGrenadeCommitEligibility(
  revalidation: Readonly<VRArmedGrenadeCommitRevalidation>,
): VRArmedGrenadeCommitEligibility {
  if (!revalidation || typeof revalidation !== 'object') {
    throw new TypeError('grenade revalidation is required');
  }
  for (const key of ['sourceAvailable', 'targetAvailable', 'tempoEligible'] as const) {
    if (typeof revalidation[key] !== 'boolean') {
      throw new TypeError(`grenade revalidation ${key} must be boolean`);
    }
  }
  if (!revalidation.sourceAvailable || !revalidation.targetAvailable) {
    return 'cancel-invalid';
  }
  return revalidation.tempoEligible ? 'commit' : 'defer-tempo';
}
