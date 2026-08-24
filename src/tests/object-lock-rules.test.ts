import { describe, expect, jest, test } from '@jest/globals';
import {
  canAttemptSecurityUnlock,
  canBashObject,
  canExecuteMinePlacement,
  canPlaceMineOnObject,
  resolveSecurityUnlock,
} from '@/engine/interaction/ObjectLockRules';

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

describe('resolveSecurityUnlock', () => {
  test('uses the supplied real d20 result for the authored Low Security Door', () => {
    const rollD20 = jest.fn(() => 1);

    const result = resolveSecurityUnlock({
      locked: true,
      lockable: false,
      keyRequired: false,
      securitySkill: 6,
      wisdom: 10,
      openLockDC: 21,
    }, rollD20);

    expect(rollD20).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ attempted: true, unlocked: false, roll: 1, total: 12 });
  });

  test('rejects a Security total exactly equal to the authored OpenLockDC', () => {
    const result = resolveSecurityUnlock({
      locked: true,
      lockable: false,
      keyRequired: false,
      securitySkill: 6,
      wisdom: 10,
      openLockDC: 21,
    }, () => 10);

    expect(result).toEqual({ attempted: true, unlocked: false, roll: 10, total: 21 });
  });
});

describe('canBashObject', () => {
  test.each([
    ['ordinary lock', { plot: false, min1HP: false, notBlastable: false }, true],
    ['plot-owned door', { plot: true, min1HP: false, notBlastable: false }, false],
    ['Min1HP door', { plot: false, min1HP: true, notBlastable: false }, false],
    ['NotBlastable door', { plot: false, min1HP: false, notBlastable: true }, false],
  ])('allows Bash for %s only when authored destruction permits it', (_name, state, expected) => {
    expect(canBashObject(state)).toBe(expected);
  });
});

describe('canPlaceMineOnObject', () => {
  test.each([
    ['ordinary lock', { plot: false, min1HP: false, notBlastable: false }, true],
    // 001EBO's Engine Room Door: Plot=1, NotBlastable=0, HP=1. Its own
    // conversation tells the player to use a mine on it, and it is the only
    // route to the hyperdrive that ends the prologue. Plot must not veto this.
    ['plot-owned Engine Room Door', { plot: true, min1HP: false, notBlastable: false }, true],
    // Every other locked door in 001EBO ships NotBlastable=1, which is how the
    // module says "explosives do nothing here".
    ['NotBlastable Blast Door', { plot: true, min1HP: false, notBlastable: true }, false],
    ['Min1HP object', { plot: false, min1HP: true, notBlastable: false }, false],
  ])('allows a mine on %s only when the explosives rule permits it', (_name, state, expected) => {
    expect(canPlaceMineOnObject(state)).toBe(expected);
  });

  test('is a different question from Bash for the same door', () => {
    const engineRoomDoor = { plot: true, min1HP: false, notBlastable: false };
    expect(canBashObject(engineRoomDoor)).toBe(false);
    expect(canPlaceMineOnObject(engineRoomDoor)).toBe(true);
  });
});

describe('canExecuteMinePlacement', () => {
  const door = 1 << 4;

  test('revalidates a queued mine against the target it actually resolved to', () => {
    expect(canExecuteMinePlacement({ objectType: door, plot: true, min1HP: false, notBlastable: false }))
      .toBe(true);
    expect(canExecuteMinePlacement({ objectType: door, plot: false, min1HP: false, notBlastable: true }))
      .toBe(false);
  });

  test('refuses anything that is not a door or placeable', () => {
    expect(canExecuteMinePlacement(null)).toBe(false);
    expect(canExecuteMinePlacement({ objectType: 1, plot: false, min1HP: false, notBlastable: false }))
      .toBe(false);
  });
});
