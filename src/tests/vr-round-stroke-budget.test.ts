import { describe, expect, test } from '@jest/globals';
import {
  NO_VR_ROUND_ATTACK_PIPS,
  VR_HELD_SWING_WINDOW_MILLISECONDS,
  normalizeVRRoundAttackPips,
  resolveVRRoundStroke,
} from '@/vr/runtime/VRRoundStrokeBudget';

const stroke = (over: Partial<Parameters<typeof resolveVRRoundStroke>[0]> = {}) => resolveVRRoundStroke({
  hand: 'main', heldAttacks: 0, ownRoundRemainingMs: null, openingAgeMs: null, ...over,
});

describe('T-B: every attack of a round needs its own stroke', () => {
  test('a stroke inside the round spends an attack the round still holds', () => {
    expect(stroke({ heldAttacks: 1, ownRoundRemainingMs: 2500 })).toBe('spend');
    // ...however late in the round it comes.
    expect(stroke({ heldAttacks: 1, ownRoundRemainingMs: 100 })).toBe('spend');
    expect(stroke({ hand: 'off', heldAttacks: 1, ownRoundRemainingMs: 2500 })).toBe('spend');
  });

  test('a brisk return to guard can never buy more than the round allows', () => {
    // Hilt's trace: slash, hold 350 ms, return in 400-450 ms. The round began
    // with the slash, so the return lands ~0.7-0.9 s in: nothing left, absorbed.
    for (const msIntoRound of [400, 450, 700, 900, 1400]) {
      expect(stroke({ ownRoundRemainingMs: 3000 - msIntoRound })).toBe('absorb');
    }
    // The engine has the opening attack but has not begun the round yet.
    expect(stroke({ openingAgeMs: 450 })).toBe('absorb');
  });

  test('a stroke in the last stretch of the round is held for the next opening, as before', () => {
    expect(stroke({ ownRoundRemainingMs: VR_HELD_SWING_WINDOW_MILLISECONDS })).toBe('pass');
    expect(stroke({ ownRoundRemainingMs: 400 })).toBe('pass');
    expect(stroke({ openingAgeMs: 2000 })).toBe('pass');
  });

  test('with no round of its own running, the stroke opens one (or is held), as before', () => {
    expect(stroke()).toBe('pass');
  });

  test('the off hand never opens a round and is never held for the next', () => {
    expect(stroke({ hand: 'off' })).toBe('absorb');
    expect(stroke({ hand: 'off', ownRoundRemainingMs: 300 })).toBe('absorb');
  });
});

describe('hilt pips', () => {
  test('counts are whole, non-negative and capped', () => {
    expect(normalizeVRRoundAttackPips({ main: 1, off: 1 })).toEqual({ main: 1, off: 1 });
    expect(normalizeVRRoundAttackPips({ main: 2.7, off: -1 })).toEqual({ main: 2, off: 0 });
    expect(normalizeVRRoundAttackPips({ main: 9 })).toEqual({ main: 4, off: 0 });
    expect(normalizeVRRoundAttackPips(null)).toBe(NO_VR_ROUND_ATTACK_PIPS);
  });
});
