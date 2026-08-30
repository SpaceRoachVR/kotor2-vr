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
  test('takes 20 outside combat rather than rolling, as the shipped game does', () => {
    const rollD20 = jest.fn(() => 1);

    const result = resolveSecurityUnlock({
      locked: true, lockable: false, keyRequired: false,
      securitySkill: 6, intelligence: 16, openLockDC: 21,
    }, rollD20);

    expect(rollD20).not.toHaveBeenCalled();
    // 20 + Intelligence modifier 3 + rank 6 = 29 against DC 21.
    expect(result).toEqual({ attempted: true, unlocked: true, roll: 20, total: 29 });
  });

  test('the authored tunneler thresholds only mean something under take 20', () => {
    const attempt = (openLockDC: number) => resolveSecurityUnlock({
      locked: true, lockable: false, keyRequired: false,
      securitySkill: 6, intelligence: 16, openLockDC,
    }, () => 1);
    // T3-M4 reaches 29: the Low Security Doors open, and the combat-training
    // containers stay shut until a tunneler adds its bonus.
    expect(attempt(21).unlocked).toBe(true);
    expect(attempt(33).unlocked).toBe(false);
    expect(attempt(36).unlocked).toBe(false);
  });

  test('rolls for real while in combat', () => {
    const rollD20 = jest.fn(() => 1);

    const result = resolveSecurityUnlock({
      locked: true,
      lockable: false,
      keyRequired: false,
      securitySkill: 6,
      intelligence: 10,
      openLockDC: 21,
      inCombat: true,
    }, rollD20);

    expect(rollD20).toHaveBeenCalledTimes(1);
    // 1 + Intelligence modifier 0 + rank 6.
    expect(result).toEqual({ attempted: true, unlocked: false, roll: 1, total: 7 });
  });

  test('rejects a Security total exactly equal to the authored OpenLockDC', () => {
    const result = resolveSecurityUnlock({
      locked: true,
      lockable: false,
      keyRequired: false,
      securitySkill: 6,
      intelligence: 10,
      openLockDC: 21,
      inCombat: true,
    }, () => 15);

    expect(result).toEqual({ attempted: true, unlocked: false, roll: 15, total: 21 });
  });

  test('scores Security off Intelligence, as a modifier rather than half the score', () => {
    // The old rule added wisdom/2, so an average actor collected a flat +5 it
    // had not earned -- and collected it from the wrong ability entirely.
    const average = resolveSecurityUnlock({
      locked: true, lockable: false, keyRequired: false,
      securitySkill: 6, intelligence: 10, openLockDC: 21, inCombat: true,
    }, () => 10);
    expect(average.attempted && average.total).toBe(16);

    const clever = resolveSecurityUnlock({
      locked: true, lockable: false, keyRequired: false,
      securitySkill: 6, intelligence: 16, openLockDC: 21, inCombat: true,
    }, () => 10);
    expect(clever.attempted && clever.total).toBe(19);

    const dull = resolveSecurityUnlock({
      locked: true, lockable: false, keyRequired: false,
      securitySkill: 6, intelligence: 8, openLockDC: 21, inCombat: true,
    }, () => 10);
    expect(dull.attempted && dull.total).toBe(15);
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
