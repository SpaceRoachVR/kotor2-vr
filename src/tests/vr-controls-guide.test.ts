import { describe, expect, test } from '@jest/globals';
import { describeVRControls } from '@/vr/runtime/VRControlsGuide';

// Round 14: "There should be a VR controls guide available from the comfort menu".
describe('the controls guide', () => {
  const flat = (hand: 'left' | 'right') => describeVRControls(hand)
    .flatMap((section) => section.lines.map(([input, effect]) => `${section.title}: ${input} = ${effect}`));

  test('right-handed: the wheel on left X, moving on the left stick, shooting on the right trigger', () => {
    const lines = flat('right');
    expect(lines).toContain('Left hand: X = Action wheel (inventory, map, party, save, settings)');
    expect(lines).toContain('Left hand: Stick = Move');
    expect(lines).toContain('Right hand: Trigger = Select, talk, shoot');
  });

  test('left-handed: moving swaps to the right stick and the weapon to the left trigger', () => {
    const lines = flat('left');
    expect(lines).toContain('Right hand: Stick = Move');
    expect(lines).toContain('Left hand (weapon): Trigger = Select, talk, shoot');
  });

  test('every guide covers the gestures', () => {
    for (const hand of ['left', 'right'] as const) {
      expect(flat(hand).some((l) => l.includes('neck'))).toBe(true);
      expect(flat(hand).some((l) => l.includes('Swing'))).toBe(true);
    }
  });
});
