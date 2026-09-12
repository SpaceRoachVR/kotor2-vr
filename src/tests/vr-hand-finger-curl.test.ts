import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  resolveVRHandFingerCurl,
  smoothVRHandFingerCurl,
  VR_HAND_OPEN_CURL,
} from '@/vr/runtime/hands/VRHandFingerCurl';
import type { XRButtonState, XRHandInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

function hand(buttons: Record<string, Partial<XRButtonState>>): XRHandInputFrame {
  const pose: XRWorldPose = {
    position: new THREE.Vector3(), orientation: new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  };
  const full: Record<string, XRButtonState> = {};
  for (const [key, value] of Object.entries(buttons)) {
    full[key] = { pressed: false, touched: false, value: 0, ...value };
  }
  return { hand: 'right', pose, targetRayPose: pose, buttons: full, axes: [], interactionProfile: 'oculus-touch-v3' };
}

describe('resolveVRHandFingerCurl', () => {
  test('trigger closes the index finger and squeeze closes the other three', () => {
    const trigger = resolveVRHandFingerCurl({ hand: hand({ 0: { value: 1, pressed: true } }), holdingItem: false });
    expect(trigger.index).toBe(1);
    expect(trigger.middle).toBeLessThan(0.2);

    const squeeze = resolveVRHandFingerCurl({ hand: hand({ 1: { value: 0.9, pressed: true } }), holdingItem: false });
    expect(squeeze.middle).toBeCloseTo(0.9);
    expect(squeeze.ring).toBeCloseTo(0.9);
    expect(squeeze.pinky).toBeCloseTo(0.9);
    expect(squeeze.index).toBeLessThan(0.2);
  });

  test('a resting finger or thumb curls slightly without a press', () => {
    const resting = resolveVRHandFingerCurl({
      hand: hand({ 0: { touched: true }, 3: { touched: true } }),
      holdingItem: false,
    });
    expect(resting.index).toBeGreaterThan(0.2);
    expect(resting.index).toBeLessThan(0.5);
    expect(resting.thumb).toBeGreaterThan(0.4);
  });

  test('a held item closes the fist but a trigger pull still finishes the index', () => {
    const idle = resolveVRHandFingerCurl({ hand: hand({}), holdingItem: true });
    const firing = resolveVRHandFingerCurl({ hand: hand({ 0: { value: 1, pressed: true } }), holdingItem: true });

    expect(idle.middle).toBeGreaterThan(0.75);
    expect(idle.thumb).toBeGreaterThan(0.6);
    expect(idle.index).toBeLessThan(firing.index);
    expect(firing.index).toBeCloseTo(1);
  });

  test('an untracked or missing controller is a relaxed hand, never NaN', () => {
    const relaxed = resolveVRHandFingerCurl({ hand: null, holdingItem: false });
    for (const value of Object.values(relaxed)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeLessThan(0.2);
    }
    const corrupt = resolveVRHandFingerCurl({ hand: hand({ 0: { value: Number.NaN } }), holdingItem: false });
    expect(Number.isFinite(corrupt.index)).toBe(true);
  });
});

describe('smoothVRHandFingerCurl', () => {
  test('approaches the target over time and ignores a non-positive delta', () => {
    const target = { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 };
    const step = smoothVRHandFingerCurl(VR_HAND_OPEN_CURL, target, 1 / 90);
    expect(step.index).toBeGreaterThan(0);
    expect(step.index).toBeLessThan(1);

    let current = VR_HAND_OPEN_CURL;
    for (let frame = 0; frame < 45; frame += 1) current = smoothVRHandFingerCurl(current, target, 1 / 90);
    expect(current.index).toBeGreaterThan(0.99);

    expect(smoothVRHandFingerCurl(VR_HAND_OPEN_CURL, target, 0)).toBe(VR_HAND_OPEN_CURL);
  });
});
