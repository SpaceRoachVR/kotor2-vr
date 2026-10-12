import * as THREE from 'three';
import { expect, test } from '@jest/globals';
import { VRPointerPoseSmoother } from '@/vr/runtime/VRPointerPoseSmoother';
import { XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

function frame(timestamp: number, x = 0, yaw = 0): XRInputFrame {
  const pose: XRWorldPose = { position: new THREE.Vector3(x, 1, 0),
    orientation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked' };
  return { timestamp, head: pose, activeInteractionProfiles: [], hands: {
    right: { hand: 'right', pose, targetRayPose: pose, buttons: {}, axes: [], interactionProfile: null },
  } };
}

test('reduces small alternating position and angular tremor without changing grip or input', () => {
  const smoother = new VRPointerPoseSmoother(), rig = new THREE.Group();
  smoother.smoothFrame(frame(0), rig);
  let positionAmplitude = 0, angularAmplitude = 0;
  for (let i = 1; i <= 60; i++) {
    const input = frame(i * 1000 / 72, (i % 2 ? 1 : -1) * 0.001, (i % 2 ? 1 : -1) * 0.002);
    const output = smoother.smoothFrame(input, rig);
    if (i > 30) {
      positionAmplitude = Math.max(positionAmplitude, Math.abs(output.hands.right!.targetRayPose.position.x));
      angularAmplitude = Math.max(angularAmplitude, output.hands.right!.targetRayPose.orientation.angleTo(new THREE.Quaternion()));
    }
    expect(output.hands.right!.pose).toBe(input.hands.right!.pose);
    expect(output.hands.right!.buttons).toBe(input.hands.right!.buttons);
    expect(input.hands.right!.targetRayPose.position.x).toBe(i % 2 ? 0.001 : -0.001);
  }
  expect(positionAmplitude).toBeLessThan(0.0004);
  expect(angularAmplitude).toBeLessThan(0.0008);
});

test('fast deliberate aiming follows within one 72 Hz frame', () => {
  const smoother = new VRPointerPoseSmoother(), rig = new THREE.Group();
  smoother.smoothFrame(frame(0), rig);
  const target = frame(1000 / 72, 0.025, 0.08);
  const result = smoother.smoothFrame(target, rig).hands.right!.targetRayPose;
  expect(result.position.distanceTo(target.hands.right!.targetRayPose.position)).toBeLessThan(0.001);
  expect(result.orientation.angleTo(target.hands.right!.targetRayPose.orientation)).toBeLessThan(0.003);
});

test('steady filtering depends on elapsed time, rather than frame rate', () => {
  const run = (step: number) => {
    const smoother = new VRPointerPoseSmoother(), rig = new THREE.Group();
    smoother.smoothFrame(frame(0), rig);
    let output = frame(0);
    for (let t = step; t <= 60; t += step) output = smoother.smoothFrame(frame(t, 0.001), rig);
    return output.hands.right!.targetRayPose.position.x;
  };
  expect(run(10)).toBeCloseTo(run(20), 10);
});

test('a repeated sample uses the latest rig transform without filtering avatar movement', () => {
  const smoother = new VRPointerPoseSmoother(), rig = new THREE.Group();
  smoother.smoothFrame(frame(0), rig);
  const first = smoother.smoothFrame(frame(14, 0.001), rig);
  rig.position.x = 10;
  const sameSample = frame(14, 10.001);
  const second = smoother.smoothFrame(sameSample, rig);
  expect(second.hands.right!.targetRayPose.position.x).toBeCloseTo(first.hands.right!.targetRayPose.position.x + 10, 10);
});

test('resets after gaps, discontinuities, tracking loss, and explicit reset', () => {
  const smoother = new VRPointerPoseSmoother(), rig = new THREE.Group();
  smoother.smoothFrame(frame(0), rig);
  expect(smoother.smoothFrame(frame(150, 0.1), rig).hands.right!.targetRayPose.position.x).toBe(0.1);
  expect(smoother.smoothFrame(frame(160, 1), rig).hands.right!.targetRayPose.position.x).toBe(1);
  smoother.smoothFrame({ ...frame(170), hands: {} }, rig);
  expect(smoother.smoothFrame(frame(180, 1.1), rig).hands.right!.targetRayPose.position.x).toBe(1.1);
  smoother.reset();
  expect(smoother.smoothFrame(frame(190, 1.2), rig).hands.right!.targetRayPose.position.x).toBe(1.2);
  expect(smoother.smoothFrame(frame(0, 1.25), rig).hands.right!.targetRayPose.position.x).toBe(1.25);
  expect(() => smoother.smoothFrame(frame(NaN), rig)).toThrow(RangeError);
  const bad = frame(10, Infinity);
  expect(smoother.smoothFrame(bad, rig).hands.right!.targetRayPose).toBe(bad.hands.right!.targetRayPose);
});
