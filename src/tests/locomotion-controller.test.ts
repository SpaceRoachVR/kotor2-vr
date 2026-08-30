import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  LocomotionController,
  LocomotionControllerConfiguration,
} from '@/vr/runtime/LocomotionController';
import { XRCoordinateConverter } from '@/vr/runtime/XRCoordinateConverter';
import { LocomotionIntent } from '@/vr/runtime/XRTypes';

const CONFIGURATION: LocomotionControllerConfiguration = {
  inputDeadZone: 0.1,
  bodyYawDeadZoneRadians: THREE.MathUtils.degToRad(10),
  maximumBodyFollowRadiansPerSecond: THREE.MathUtils.degToRad(90),
};

function intent(overrides: Partial<LocomotionIntent> = {}): LocomotionIntent {
  return {
    direction: new THREE.Vector2(0, 1),
    magnitude: 1,
    turn: 0,
    mode: 'smooth',
    referenceFrame: 'head',
    ...overrides,
  };
}

function headOrientation(yawRadians: number): THREE.Quaternion {
  const xrYaw = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0),
    yawRadians
  );
  return XRCoordinateConverter.xrOrientationToGame(xrYaw);
}

describe('LocomotionController', () => {
  test('maps forward movement to the tracked head direction', () => {
    const controller = new LocomotionController(CONFIGURATION);

    const forward = controller.resolve(intent(), headOrientation(0), 0, 1 / 72);
    const right = controller.resolve(intent(), headOrientation(-Math.PI / 2), 0, 1 / 72);

    expect(forward.worldDirection.x).toBeCloseTo(0);
    expect(forward.worldDirection.y).toBeCloseTo(1);
    expect(right.worldDirection.x).toBeCloseTo(1);
    expect(right.worldDirection.y).toBeCloseTo(0);
  });

  test('rotates movement and body together from dominant-stick smooth turn', () => {
    const controller = new LocomotionController(CONFIGURATION);

    const resolved = controller.resolve(
      intent({ turn: 1 }),
      headOrientation(0),
      0,
      0.5
    );

    expect(resolved.bodyFacing).toBeCloseTo(Math.PI / 3);
    expect(resolved.worldDirection.x).toBeCloseTo(-Math.sin(Math.PI / 3));
    expect(resolved.worldDirection.y).toBeCloseTo(Math.cos(Math.PI / 3));
  });

  test('turns the creature toward sustained head yaw at a capped comfort rate', () => {
    const controller = new LocomotionController(CONFIGURATION);

    const resolved = controller.resolve(
      intent({ magnitude: 0 }),
      headOrientation(-Math.PI / 2),
      0,
      0.25
    );

    expect(resolved.headFacing).toBeCloseTo(-Math.PI / 2);
    expect(resolved.bodyFacing).toBeCloseTo(THREE.MathUtils.degToRad(-22.5));
  });

  test('does not turn the body for a glance inside the yaw dead zone', () => {
    const controller = new LocomotionController(CONFIGURATION);

    const resolved = controller.resolve(
      intent({ magnitude: 0 }),
      headOrientation(THREE.MathUtils.degToRad(-8)),
      0,
      1
    );

    expect(resolved.bodyFacing).toBeCloseTo(0);
  });

  test('uses the shortest body-follow path across the radians wrap boundary', () => {
    const controller = new LocomotionController(CONFIGURATION);
    const currentFacing = THREE.MathUtils.degToRad(175);

    const resolved = controller.resolve(
      intent({ magnitude: 0 }),
      headOrientation(THREE.MathUtils.degToRad(-160)),
      currentFacing,
      0.1
    );

    expect(resolved.headFacing).toBeCloseTo(THREE.MathUtils.degToRad(-160));
    expect(resolved.bodyFacing).toBeCloseTo(THREE.MathUtils.degToRad(-176));
  });

  test('rejects unsafe configuration and invalid frame deltas', () => {
    expect(() => new LocomotionController({
      ...CONFIGURATION,
      bodyYawDeadZoneRadians: Math.PI,
    })).toThrow('Body yaw dead zone');

    const controller = new LocomotionController(CONFIGURATION);
    expect(() => controller.resolve(intent(), headOrientation(0), 0, -1)).toThrow(
      'delta time'
    );
  });
});
