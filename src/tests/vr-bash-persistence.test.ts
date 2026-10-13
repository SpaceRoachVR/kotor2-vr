import { describe, expect, test } from '@jest/globals';
import {
  VR_BASH_LEAVE_DISTANCE_METRES,
  shouldDispatchVRBashStroke,
  shouldKeepVRBashArmed,
} from '@/vr/runtime/VRBashPersistence';

/**
 * Allen, 2026-10-13 (headset round 18, "Bash persists"): once Bash is picked
 * on a door or container, every swing or shot at it bashes until it breaks,
 * or the player leaves or retargets. Before this, the first attack left the
 * player's combat flag up, and every later swing was refused as "already
 * bashing" until that flag dropped some ten seconds later, so he re-picked
 * Bash for every attempt and the Plasma Torch seemed to do nothing.
 */
describe('Bash persists once picked', () => {
  const armed = { targetFound: true, targetLocked: true, sameArea: true, distanceMetres: 1.3 };

  test('stays armed while the target stands locked within reach of the player', () => {
    expect(shouldKeepVRBashArmed(armed)).toBe(true);
  });

  test('disarms once the target breaks or opens', () => {
    expect(shouldKeepVRBashArmed({ ...armed, targetLocked: false })).toBe(false);
    expect(shouldKeepVRBashArmed({ ...armed, targetFound: false })).toBe(false);
  });

  test('disarms when the player leaves', () => {
    expect(shouldKeepVRBashArmed({ ...armed, sameArea: false })).toBe(false);
    expect(shouldKeepVRBashArmed({ ...armed, distanceMetres: VR_BASH_LEAVE_DISTANCE_METRES + 0.1 })).toBe(false);
    expect(shouldKeepVRBashArmed({ ...armed, distanceMetres: VR_BASH_LEAVE_DISTANCE_METRES - 0.1 })).toBe(true);
    expect(shouldKeepVRBashArmed({ ...armed, distanceMetres: Number.NaN })).toBe(false);
  });

  test('every stroke bashes, unless an attack on the target is already waiting', () => {
    // The previous attack resolved but the combat flag is still up: this was
    // the refused case.
    expect(shouldDispatchVRBashStroke({ attackWaitingOnTarget: false })).toBe(true);
    // One stroke is one attack: a second stroke never stacks a second attack
    // behind one that has not run yet.
    expect(shouldDispatchVRBashStroke({ attackWaitingOnTarget: true })).toBe(false);
  });
});
