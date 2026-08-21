import { describe, expect, test } from '@jest/globals';
import { canAttemptSecurityUnlock } from '@/engine/interaction/ObjectLockRules';

describe('canAttemptSecurityUnlock', () => {
  test.each([
    ['authored lockable lock', { locked: true, lockable: true, keyRequired: false }],
    // The real 001EBO "Low Security Door": Locked=1, Lockable=0, KeyRequired=0,
    // OpenLockDC=21. Lockable means "can be re-locked" in Odyssey, not "can be
    // picked", so it must not veto a Security attempt.
    ['Low Security Door with Lockable=0', { locked: true, lockable: false, keyRequired: false }],
  ])('allows security for a %s', (_name, lockState) => {
    expect(canAttemptSecurityUnlock(lockState)).toBe(true);
  });

  test.each([
    ['unlocked object', { locked: false, lockable: true, keyRequired: false }],
    ['unlocked and not lockable', { locked: false, lockable: false, keyRequired: false }],
    // Key-required locks stay reserved for their authored unlock path — this is
    // what keeps the Blast Doors and the Footlocker refused.
    ['key-required lock', { locked: true, lockable: true, keyRequired: true }],
    ['key-required and not lockable', { locked: true, lockable: false, keyRequired: true }],
  ])('rejects a %s', (_name, lockState) => {
    expect(canAttemptSecurityUnlock(lockState)).toBe(false);
  });
});
