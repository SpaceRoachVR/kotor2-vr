import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  isVRWeaponHandOnTarget,
  VR_FORCE_WEAPON_AIM_CONE_DEGREES,
} from '@/vr/runtime/VRForceGestureController';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

/** A ray at the origin whose -Z axis is turned `degrees` about the X axis (down). */
function rayPitchedDown(degrees: number): XRWorldPose {
  return {
    position: new THREE.Vector3(0, 0, 0),
    orientation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-degrees)),
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}

const TARGET = new THREE.Vector3(0, 0, -4);

describe('isVRWeaponHandOnTarget', () => {
  test('the cone is about 30 degrees', () => {
    expect(VR_FORCE_WEAPON_AIM_CONE_DEGREES).toBe(30);
  });

  test('a weapon pointed at the locked target allows the gesture', () => {
    expect(isVRWeaponHandOnTarget(rayPitchedDown(0), TARGET)).toBe(true);
    expect(isVRWeaponHandOnTarget(rayPitchedDown(25), TARGET)).toBe(true);
  });

  test('a sword pointed at the floor refuses it (F14)', () => {
    expect(isVRWeaponHandOnTarget(rayPitchedDown(70), TARGET)).toBe(false);
    expect(isVRWeaponHandOnTarget(rayPitchedDown(35), TARGET)).toBe(false);
  });

  test('a hand turned 90 degrees to the side refuses a push flick (Bolt finding 4)', () => {
    const side: XRWorldPose = {
      ...rayPitchedDown(0),
      orientation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2),
    };
    expect(isVRWeaponHandOnTarget(side, TARGET)).toBe(false);
  });

  test('no target, or no usable ray, refuses rather than guessing', () => {
    expect(isVRWeaponHandOnTarget(rayPitchedDown(0), null)).toBe(false);
    expect(isVRWeaponHandOnTarget(null, TARGET)).toBe(false);
    const broken = { ...rayPitchedDown(0), position: new THREE.Vector3(NaN, 0, 0) };
    expect(isVRWeaponHandOnTarget(broken, TARGET)).toBe(false);
  });
});
