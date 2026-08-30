import { describe, expect, test } from '@jest/globals';
import { DEFAULT_RECENTER_HOLD_MS, VRRecenterHoldGate } from '@/vr/runtime/VRRecenterHoldGate';

describe('VRRecenterHoldGate', () => {
  test('a stray click well short of the threshold never fires', () => {
    // This is the whole point of the gate: Recenter shares the dominant
    // thumbstick with Turn, so a click during a turn must not recentre.
    const gate = new VRRecenterHoldGate(700);

    expect(gate.update(true, 1000)).toBe(false);
    expect(gate.update(true, 1120)).toBe(false);
    expect(gate.update(false, 1140)).toBe(false);
    expect(gate.update(true, 2000)).toBe(false);
    expect(gate.update(true, 2100)).toBe(false);
    expect(gate.update(false, 2150)).toBe(false);
  });

  test('fires once when the hold threshold is crossed', () => {
    const gate = new VRRecenterHoldGate(700);

    expect(gate.update(true, 1000)).toBe(false);
    expect(gate.update(true, 1699)).toBe(false);
    expect(gate.update(true, 1700)).toBe(true);
  });

  test('does not fire again while the button stays held', () => {
    // Recentring every frame would pin the head to the rig origin and fight
    // the player's real movement.
    const gate = new VRRecenterHoldGate(700);
    gate.update(true, 0);
    expect(gate.update(true, 700)).toBe(true);

    expect(gate.update(true, 900)).toBe(false);
    expect(gate.update(true, 5000)).toBe(false);
  });

  test('a fresh press after release can fire again', () => {
    const gate = new VRRecenterHoldGate(700);
    gate.update(true, 0);
    expect(gate.update(true, 700)).toBe(true);
    expect(gate.update(false, 800)).toBe(false);

    gate.update(true, 1000);
    expect(gate.update(true, 1700)).toBe(true);
  });

  test('reset clears an in-progress hold', () => {
    // Session end, tracking loss, and module transition all reset input state;
    // a half-completed hold must not survive into the next session.
    const gate = new VRRecenterHoldGate(700);
    gate.update(true, 0);
    gate.update(true, 600);

    gate.reset();

    expect(gate.update(true, 700)).toBe(false);
    expect(gate.update(true, 1399)).toBe(false);
    expect(gate.update(true, 1400)).toBe(true);
  });

  test('a backwards timestamp rebases instead of wedging the press', () => {
    // A session restart can hand the loop a timestamp earlier than the one that
    // started the press; without rebasing, the hold could never complete.
    const gate = new VRRecenterHoldGate(700);
    gate.update(true, 10000);

    expect(gate.update(true, 20)).toBe(false);

    expect(gate.update(true, 719)).toBe(false);
    expect(gate.update(true, 720)).toBe(true);
  });

  test('reports hold progress for an indicator', () => {
    const gate = new VRRecenterHoldGate(700);
    gate.update(true, 0);

    expect(gate.progress(0)).toBe(0);
    expect(gate.progress(350)).toBeCloseTo(0.5, 6);
    expect(gate.progress(700)).toBe(1);
    gate.update(true, 700);
    expect(gate.progress(1500)).toBe(1);
  });

  test('progress is zero when nothing is held', () => {
    const gate = new VRRecenterHoldGate(700);

    expect(gate.progress(1234)).toBe(0);
  });

  test('a non-finite timestamp is ignored rather than firing', () => {
    const gate = new VRRecenterHoldGate(700);
    gate.update(true, 0);

    expect(gate.update(true, Number.NaN)).toBe(false);
    expect(gate.progress(Number.NaN)).toBe(0);
  });

  test('rejects a non-positive hold', () => {
    expect(() => new VRRecenterHoldGate(0)).toThrow(RangeError);
    expect(() => new VRRecenterHoldGate(-1)).toThrow(RangeError);
    expect(() => new VRRecenterHoldGate(Number.NaN)).toThrow(RangeError);
  });

  test('the default hold rejects a stray click but still feels immediate', () => {
    expect(DEFAULT_RECENTER_HOLD_MS).toBeGreaterThan(300);
    expect(DEFAULT_RECENTER_HOLD_MS).toBeLessThanOrEqual(1000);
  });
});
