import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import { resolveVRTeleportAim } from '@/vr/runtime/VRTeleportAimResolver';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

/** A controller at `height` aiming `pitch` radians below the horizon, facing +Y. */
function aimingPose(height: number, pitchBelowHorizon: number): XRWorldPose {
  // Default ray forward is -Z; rotate it onto +Y, then pitch it down.
  const orientation = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(Math.PI / 2 - pitchBelowHorizon, 0, 0, 'XYZ'));
  return {
    position: new THREE.Vector3(0, 0, height),
    orientation,
    trackingState: 'tracked',
  } as unknown as XRWorldPose;
}

const feet = new THREE.Vector3(0, 0, 0);

describe('resolveVRTeleportAim', () => {
  test('a ray aimed down lands on the floor plane, not at a fixed distance', () => {
    // The old blink always travelled exactly maxDistanceMetres, so the player
    // could not choose how far to go. Aiming steeply must land nearer.
    const steep = resolveVRTeleportAim({
      rayPose: aimingPose(1.2, Math.PI / 3), feet, maxDistanceMetres: 8,
    });
    const shallow = resolveVRTeleportAim({
      rayPose: aimingPose(1.2, Math.PI / 8), feet, maxDistanceMetres: 8,
    });

    expect(steep?.point.z).toBeCloseTo(0, 6);
    expect(steep!.distanceMetres).toBeLessThan(shallow!.distanceMetres);
  });

  test('range is measured across the ground, not along the ray', () => {
    // Otherwise the controller's height eats into the player's reach, and a
    // teleport aimed at 4 m of floor refuses at 4 m of ray.
    const aim = resolveVRTeleportAim({
      rayPose: aimingPose(1.5, Math.PI / 4), feet, maxDistanceMetres: 4,
    });

    expect(aim?.withinRange).toBe(true);
    expect(aim!.distanceMetres).toBeCloseTo(1.5, 5);
  });

  test('an out-of-range aim is pulled in along its own bearing, not dropped', () => {
    // A marker that vanishes past the limit leaves the player guessing where
    // the limit is; one that sticks at maximum range shows it.
    const aim = resolveVRTeleportAim({
      rayPose: aimingPose(1.5, Math.PI / 20), feet, maxDistanceMetres: 4,
    });

    expect(aim).not.toBeNull();
    expect(aim!.withinRange).toBe(false);
    expect(aim!.distanceMetres).toBeCloseTo(4, 6);
    // Bearing preserved: still straight ahead along +Y.
    expect(aim!.point.x).toBeCloseTo(0, 6);
    expect(aim!.point.y).toBeCloseTo(4, 6);
  });

  test('a ray at or above the horizon reaches no floor', () => {
    expect(resolveVRTeleportAim({
      rayPose: aimingPose(1.5, 0), feet, maxDistanceMetres: 4,
    })).toBeNull();
    expect(resolveVRTeleportAim({
      rayPose: aimingPose(1.5, -Math.PI / 6), feet, maxDistanceMetres: 4,
    })).toBeNull();
  });

  test('the floor plane follows the player up and down stairs', () => {
    // Feet define the plane, so standing on a raised platform aims at that
    // platform's height rather than at the level's origin.
    const raised = new THREE.Vector3(0, 0, 3);
    const aim = resolveVRTeleportAim({
      rayPose: {
        position: new THREE.Vector3(0, 0, 4.2),
        orientation: aimingPose(0, Math.PI / 4).orientation,
        trackingState: 'tracked',
      } as unknown as XRWorldPose,
      feet: raised,
      maxDistanceMetres: 8,
    });

    expect(aim?.point.z).toBeCloseTo(3, 5);
    expect(aim!.distanceMetres).toBeCloseTo(1.2, 5);
  });

  test('rejects a nonsense range rather than aiming somewhere arbitrary', () => {
    expect(() => resolveVRTeleportAim({
      rayPose: aimingPose(1.5, Math.PI / 4), feet, maxDistanceMetres: 0,
    })).toThrow(RangeError);
  });
});
