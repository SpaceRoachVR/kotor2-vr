import { describe, expect, test } from '@jest/globals';
import { describeVRControls } from '@/vr/runtime/VRControlsGuide';

// Round 14: "There should be a VR controls guide available from the comfort menu".
describe('the controls guide', () => {
  const flat = (hand: 'left' | 'right') => describeVRControls(hand)
    .flatMap((section) => section.lines.map(([input, effect]) => `${section.title}: ${input} = ${effect}`));

  test('right-handed: the wheel on left X, moving on the left stick, shooting on the right trigger', () => {
    const lines = flat('right');
    expect(lines).toContain('Left hand: X, hold = Action wheel: point at a choice with either hand and pull its trigger; let go to close (attacks, Force powers, items, menu, quick save, VR Menu)');
    expect(lines).toContain('Left hand: Stick = Move');
    expect(lines).toContain('Right hand: Trigger = Select; use what you point at; talk; shoot');
  });

  test('left-handed: moving swaps to the right stick and the weapon to the left trigger', () => {
    const lines = flat('left');
    expect(lines).toContain('Right hand: Stick = Move');
    expect(lines).toContain('Left hand (weapon): Trigger = Select; use what you point at; talk; shoot');
  });

  test('every guide covers the gestures', () => {
    for (const hand of ['left', 'right'] as const) {
      expect(flat(hand).some((l) => l.includes('neck'))).toBe(true);
      expect(flat(hand).some((l) => l.includes('Swing'))).toBe(true);
    }
  });
  test('every guide says how to use a Force power, with the right hands (round 15)', () => {
    expect(flat('right')).toContain('Force powers: Cast it = Thrust your open left hand at the ringed target, or pull the right trigger');
    expect(flat('left')).toContain('Force powers: Force Push, if known = Hold the left grip and flick forward');
  });
});
