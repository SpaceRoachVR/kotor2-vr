import { expect, test } from '@jest/globals';
import {
  VRAttackStance,
  VRAttackStanceController,
  VRCombatRoundSnapshot,
} from '@/vr/runtime/VRAttackStanceController';

const FLURRY: VRAttackStance = { featId: 17, label: 'Flurry' };
const POWER_ATTACK: VRAttackStance = { featId: 22, label: 'Power Attack' };

function round(timerMilliseconds: number, roundStarted = true): VRCombatRoundSnapshot {
  return { roundStarted, timerMilliseconds };
}

const IDLE: VRCombatRoundSnapshot = { roundStarted: false, timerMilliseconds: 0 };

test('selecting outside a round applies at once', () => {
  // There is no round to wait for, and making the player wait for one would
  // read as the control being broken.
  const stance = new VRAttackStanceController();

  stance.select(FLURRY, IDLE);

  expect(stance.getState()).toEqual({ active: FLURRY, pending: undefined });
  expect(stance.hasPending()).toBe(false);
});

test('selecting with no round information at all applies at once', () => {
  const stance = new VRAttackStanceController();

  stance.select(FLURRY, null);

  expect(stance.getState().active).toBe(FLURRY);
});

test('selecting mid-round queues for the next round and does not change this one', () => {
  const stance = new VRAttackStanceController();
  stance.select(FLURRY, IDLE);
  stance.observeRound(round(0));
  stance.observeRound(round(1500));

  stance.select(POWER_ATTACK, round(1500));

  // The round in progress still attacks as Flurry.
  expect(stance.getState()).toEqual({ active: FLURRY, pending: POWER_ATTACK });

  stance.observeRound(round(2900));
  expect(stance.getState().active).toBe(FLURRY);

  // Round turns over: the timer resets, which is the boundary.
  stance.observeRound(round(0));
  expect(stance.getState()).toEqual({ active: POWER_ATTACK, pending: undefined });
});

test('a queued return to the plain attack is distinct from an empty queue', () => {
  // null is a real selection here; undefined is "nothing waiting".
  const stance = new VRAttackStanceController();
  stance.select(FLURRY, IDLE);
  stance.observeRound(round(0));
  stance.observeRound(round(1200));

  stance.select(null, round(1200));

  expect(stance.hasPending()).toBe(true);
  expect(stance.getState()).toEqual({ active: FLURRY, pending: null });

  stance.observeRound(round(0));
  expect(stance.getState()).toEqual({ active: null, pending: undefined });
});

test('re-selecting the active stance cancels a queued change rather than stacking one', () => {
  const stance = new VRAttackStanceController();
  stance.select(FLURRY, IDLE);
  stance.observeRound(round(0));
  stance.observeRound(round(900));
  stance.select(POWER_ATTACK, round(900));

  // The player has changed their mind back to where they already are.
  stance.select(FLURRY, round(1100));

  expect(stance.hasPending()).toBe(false);
  stance.observeRound(round(0));
  expect(stance.getState().active).toBe(FLURRY);
});

test('leaving combat promotes anything queued, since there is no round left to wait for', () => {
  const stance = new VRAttackStanceController();
  stance.observeRound(round(0));
  stance.observeRound(round(1000));
  stance.select(FLURRY, round(1000));

  stance.observeRound(IDLE);

  expect(stance.getState()).toEqual({ active: FLURRY, pending: undefined });
});

test('a round starting is itself a boundary for a stance queued before it', () => {
  const stance = new VRAttackStanceController();
  stance.observeRound(round(0));
  stance.observeRound(round(2000));
  stance.select(FLURRY, round(2000));
  stance.observeRound(IDLE);
  stance.select(POWER_ATTACK, IDLE);

  // New engagement begins.
  stance.observeRound(round(0));

  expect(stance.getState().active).toBe(POWER_ATTACK);
});

test('a monotonically rising timer never promotes mid-round', () => {
  const stance = new VRAttackStanceController();
  stance.observeRound(round(0));
  stance.select(FLURRY, round(0));

  for (const elapsed of [200, 700, 1400, 2100, 2999]) {
    stance.observeRound(round(elapsed));
    expect(stance.getState().active).toBeNull();
  }

  expect(stance.hasPending()).toBe(true);
});

test('a non-finite timer is treated as the start of a round rather than trusted', () => {
  const stance = new VRAttackStanceController();
  stance.observeRound(round(1000));
  stance.select(FLURRY, round(1000));

  stance.observeRound({ roundStarted: true, timerMilliseconds: Number.NaN });

  // NaN compares false against everything, so it must not be read as a
  // backwards step; the round simply continues.
  expect(stance.getState().active).toBeNull();
  expect(stance.hasPending()).toBe(true);
});

test('reset drops the stance and the queue', () => {
  // A weapon swap must not carry a melee stance into a blaster: attack modes
  // are filtered by getEquippedWeaponType().
  const stance = new VRAttackStanceController();
  stance.select(FLURRY, IDLE);
  stance.observeRound(round(0));
  stance.observeRound(round(500));
  stance.select(POWER_ATTACK, round(500));

  stance.reset();

  expect(stance.getState()).toEqual({ active: null, pending: undefined });
});
