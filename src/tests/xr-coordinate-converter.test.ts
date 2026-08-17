import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { XRCoordinateConverter } from '@/vr/runtime/XRCoordinateConverter';

describe('XRCoordinateConverter', () => {
  test('maps WebXR Y-up positions into KOTOR Z-up world space', () => {
    const converted = XRCoordinateConverter.xrPositionToGame(
      new THREE.Vector3(1, 2, 3)
    );

    expect(converted.x).toBeCloseTo(1);
    expect(converted.y).toBeCloseTo(-3);
    expect(converted.z).toBeCloseTo(2);
  });

  test('round-trips positions without axis or sign drift', () => {
    const gamePosition = new THREE.Vector3(-4.5, 8.25, 1.75);

    const roundTrip = XRCoordinateConverter.xrPositionToGame(
      XRCoordinateConverter.gamePositionToXR(gamePosition)
    );

    expect(roundTrip.distanceTo(gamePosition)).toBeLessThan(1e-10);
  });

  test('maps and round-trips tracked orientations through the shared basis', () => {
    const xrOrientation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.2, -0.7, 0.35, 'YXZ')
    );

    const gameOrientation = XRCoordinateConverter.xrOrientationToGame(xrOrientation);
    const roundTrip = XRCoordinateConverter.gameOrientationToXR(gameOrientation);

    expect(roundTrip.angleTo(xrOrientation)).toBeLessThan(1e-7);
  });

  test('does not mutate caller-owned position or orientation values', () => {
    const position = new THREE.Vector3(1, 2, 3);
    const orientation = new THREE.Quaternion(0.1, 0.2, 0.3, 0.9).normalize();
    const positionBefore = position.clone();
    const orientationBefore = orientation.clone();

    XRCoordinateConverter.xrPositionToGame(position);
    XRCoordinateConverter.xrOrientationToGame(orientation);

    expect(position.equals(positionBefore)).toBe(true);
    expect(orientation.equals(orientationBefore)).toBe(true);
  });
});
