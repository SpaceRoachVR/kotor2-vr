import { describe, expect, test } from '@jest/globals';
import {
  NO_VR_ROUND_ATTACK_PIPS,
  VR_ROUND_LENGTH_MILLISECONDS,
  VR_SILENT_HOLD_MILLISECONDS,
  normalizeVRRoundAttackPips,
  resolveVRPlayerRoundUntilReadyMs,
  resolveVRRoundStroke,
  shouldTakeOverVRPlayerRound,
} from '@/vr/runtime/VRRoundStrokeBudget';

const stroke = (over: Partial<Parameters<typeof resolveVRRoundStroke>[0]> = {}) => resolveVRRoundStroke({
  hand: 'main', heldAttacks: 0, untilReadyMs: 0, openingPending: false, ...over,
});

describe('player-paced rounds (round 18): the round starts at the stroke', () => {
  test('an idle player\'s stroke attacks at once', () => {
    expect(stroke()).toBe('open');
    expect(stroke({ untilReadyMs: -40 })).toBe('open');
  });

  test('a stroke inside the round spends an attack the round still holds, however late', () => {
    expect(stroke({ heldAttacks: 1, untilReadyMs: 2500 })).toBe('spend');
    expect(stroke({ heldAttacks: 1, untilReadyMs: 100 })).toBe('spend');
    expect(stroke({ hand: 'off', heldAttacks: 1, untilReadyMs: 2500 })).toBe('spend');
  });

  test('with nothing left, a stroke inside the round only whooshes: it is not held across it', () => {
    // Hilt's brisk return (400-450 ms after the slash) and a 1 Hz fighter's
    // next two strokes all fall here.
    for (const msIntoRound of [400, 450, 1000, 2000, 2650]) {
      expect(stroke({ untilReadyMs: VR_ROUND_LENGTH_MILLISECONDS - msIntoRound })).toBe('whoosh');
    }
  });

  test('a stroke just before the next round is ready is held, silently and briefly', () => {
    expect(stroke({ untilReadyMs: VR_SILENT_HOLD_MILLISECONDS })).toBe('hold');
    expect(stroke({ untilReadyMs: 60 })).toBe('hold');
    expect(stroke({ untilReadyMs: VR_SILENT_HOLD_MILLISECONDS + 1 })).toBe('whoosh');
    // Short: never more than about a quarter of a second of waiting.
    expect(VR_SILENT_HOLD_MILLISECONDS).toBeGreaterThanOrEqual(150);
    expect(VR_SILENT_HOLD_MILLISECONDS).toBeLessThanOrEqual(300);
  });

  test('a stroke right after the opening stroke, before the engine begins the round, only whooshes', () => {
    expect(stroke({ openingPending: true })).toBe('whoosh');
    expect(stroke({ openingPending: true, untilReadyMs: 0 })).toBe('whoosh');
  });

  test('the off hand never opens a round and is never held', () => {
    expect(stroke({ hand: 'off' })).toBe('whoosh');
    expect(stroke({ hand: 'off', untilReadyMs: 100 })).toBe('whoosh');
  });
});

describe('the next round is available 3 s after the last one began', () => {
  test('the player\'s own running round decides while it lasts', () => {
    expect(resolveVRPlayerRoundUntilReadyMs({ ownPauseRemainingMs: 1200, sinceOwnRoundBeganMs: 1800 })).toBe(1200);
    expect(resolveVRPlayerRoundUntilReadyMs({ ownPauseRemainingMs: 30, sinceOwnRoundBeganMs: 3010 })).toBe(30);
  });

  test('a round cut short (a duel partner re-began it) still waits for the 3 s', () => {
    expect(resolveVRPlayerRoundUntilReadyMs({ ownPauseRemainingMs: null, sinceOwnRoundBeganMs: 2000 })).toBe(1000);
    expect(resolveVRPlayerRoundUntilReadyMs({ ownPauseRemainingMs: null, sinceOwnRoundBeganMs: 3000 })).toBe(0);
  });

  test('never a round of its own: ready', () => {
    expect(resolveVRPlayerRoundUntilReadyMs({ ownPauseRemainingMs: null, sinceOwnRoundBeganMs: null })).toBe(0);
  });

  test('bad input is ready, not stuck', () => {
    expect(resolveVRPlayerRoundUntilReadyMs({ ownPauseRemainingMs: Number.NaN, sinceOwnRoundBeganMs: Number.NaN })).toBe(0);
  });

  test('a round someone else began (a duel partner) is taken over only once the player\'s 3 s are up', () => {
    expect(shouldTakeOverVRPlayerRound({ roundStarted: true, pausedBySelf: false, untilReadyMs: 0 })).toBe(true);
    expect(shouldTakeOverVRPlayerRound({ roundStarted: true, pausedBySelf: false, untilReadyMs: 500 })).toBe(false);
    // The player's own round runs out on the engine's clock.
    expect(shouldTakeOverVRPlayerRound({ roundStarted: true, pausedBySelf: true, untilReadyMs: 0 })).toBe(false);
    expect(shouldTakeOverVRPlayerRound({ roundStarted: false, pausedBySelf: false, untilReadyMs: 0 })).toBe(false);
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
