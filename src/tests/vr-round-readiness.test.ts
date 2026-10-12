import { describe, expect, test } from '@jest/globals';
import {
  resolveVRRoundOpen,
  resolveVRRoundReadiness,
  VRRoundReadinessLatch,
} from '@/vr/runtime/VRCombatTempoGate';

const idleRound = { roundStarted: false, roundPaused: false, playerActionCommitted: false, scheduledActionCount: 0 };

describe('VR round readiness (critic run 4)', () => {
  test('the round is open only when nothing holds it, whatever the aim', () => {
    expect(resolveVRRoundOpen(idleRound)).toBe(true);
    expect(resolveVRRoundOpen({ ...idleRound, roundStarted: true })).toBe(false);
    expect(resolveVRRoundOpen({ ...idleRound, roundPaused: true })).toBe(false);
    expect(resolveVRRoundOpen({ ...idleRound, playerActionCommitted: true })).toBe(false);
    expect(resolveVRRoundOpen({ ...idleRound, scheduledActionCount: 1 })).toBe(false);
    expect(resolveVRRoundOpen(null)).toBe(false);
  });

  test('out of combat the ring is hidden even with a hostile aimed at', () => {
    expect(resolveVRRoundReadiness({ eligible: false, hasTarget: true, inCombat: false, round: null })).toBe(1);
  });

  test('a paused round counts down from its own pause length', () => {
    const round = { roundStarted: true, roundPaused: true, pauseTimer: 750, pauseLength: 1500, timer: 0, roundLength: 3000 };
    expect(resolveVRRoundReadiness({ eligible: false, hasTarget: true, inCombat: true, round })).toBeCloseTo(0.5);
    // Without a recorded length, the round length is the fallback.
    const legacy = { ...round, pauseLength: undefined as number | undefined, pauseTimer: 1500 };
    expect(resolveVRRoundReadiness({ eligible: false, hasTarget: true, inCombat: true, round: legacy })).toBeCloseTo(0.5);
  });

  test('an open round reads ready without a target in reach', () => {
    const round = { roundStarted: false, roundPaused: false, pauseTimer: 0, timer: 0, roundLength: 3000 };
    expect(resolveVRRoundReadiness({ eligible: false, hasTarget: false, inCombat: true, roundOpen: true, round })).toBe(1);
  });

  test('the latch keeps the ring from running backwards within one wait', () => {
    const latch = new VRRoundReadinessLatch();
    expect(latch.apply(0.6, false, true)).toBe(0.6);
    // A duel partner's half pause switches clocks and would step back.
    expect(latch.apply(0.3, false, true)).toBe(0.6);
    expect(latch.apply(0.8, false, true)).toBe(0.8);
    // The round opens: the next wait starts from empty.
    expect(latch.apply(1, true, true)).toBe(1);
    expect(latch.apply(0.1, false, true)).toBe(0.1);
    // Leaving combat resets it too.
    latch.apply(0.9, false, true);
    expect(latch.apply(1, false, false)).toBe(1);
    expect(latch.apply(0.2, false, true)).toBe(0.2);
  });

  test('a new action in the round, or a new leader, starts the ring again (critic run 5)', () => {
    const latch = new VRRoundReadinessLatch();
    const attack = {}, medpac = {}, exile = {}, atton = {};
    expect(latch.apply(0.95, false, true, exile, attack)).toBe(0.95);
    // The medpac was scheduled into the busy round and now owns it.
    expect(latch.apply(0.1, false, true, exile, medpac)).toBe(0.1);
    expect(latch.apply(0.4, false, true, exile, medpac)).toBe(0.4);
    // Switching leader mid-round does not carry the old mark.
    expect(latch.apply(0.2, false, true, atton, medpac)).toBe(0.2);
  });
});
