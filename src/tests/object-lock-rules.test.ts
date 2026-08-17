import { describe, expect, test } from '@jest/globals';
import { canAttemptSecurityUnlock } from '@/engine/interaction/ObjectLockRules';

describe('canAttemptSecurityUnlock', () => {
  test('allows security only for an authored lockable lock without a required key', () => {
    expect(canAttemptSecurityUnlock({ locked: true, lockable: true, keyRequired: false })).toBe(true);
  });

  test.each([
    { locked: false, lockable: true, keyRequired: false },
    { locked: true, lockable: false, keyRequired: false },
    { locked: true, lockable: true, keyRequired: true },
    { locked: true, lockable: false, keyRequired: true },
  ])('rejects non-security lock state %#', (lockState) => {
    expect(canAttemptSecurityUnlock(lockState)).toBe(false);
  });
});
