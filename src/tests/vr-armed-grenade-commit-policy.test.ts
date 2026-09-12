import { describe, expect, test } from '@jest/globals';
import { resolveVRArmedGrenadeCommitEligibility } from '@/vr/runtime/VRArmedGrenadeCommitPolicy';

describe('resolveVRArmedGrenadeCommitEligibility', () => {
  test('cancels a triggered grenade when its item or target no longer validates', () => {
    expect(resolveVRArmedGrenadeCommitEligibility({
      sourceAvailable: false, targetAvailable: true, tempoEligible: true,
    })).toBe('cancel-invalid');
    expect(resolveVRArmedGrenadeCommitEligibility({
      sourceAvailable: true, targetAvailable: false, tempoEligible: true,
    })).toBe('cancel-invalid');
  });

  test('retains a fully valid grenade only while waiting for the next tempo window', () => {
    expect(resolveVRArmedGrenadeCommitEligibility({
      sourceAvailable: true, targetAvailable: true, tempoEligible: false,
    })).toBe('defer-tempo');
    expect(resolveVRArmedGrenadeCommitEligibility({
      sourceAvailable: true, targetAvailable: true, tempoEligible: true,
    })).toBe('commit');
  });

  test('rejects malformed revalidation input', () => {
    expect(() => resolveVRArmedGrenadeCommitEligibility({
      sourceAvailable: true, targetAvailable: true, tempoEligible: undefined as unknown as boolean,
    })).toThrow(TypeError);
  });
});
