import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { XRInputFrameBuilder } from '@/vr/runtime/XRInputFrameBuilder';

describe('XRInputFrameBuilder', () => {
  test('converts tracked head and grip poses into KOTOR world space', () => {
    const rig = new THREE.Group();
    rig.position.set(10, 20, 2);
    rig.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    rig.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    rig.updateMatrixWorld(true);

    const gripSpace = {} as XRSpace;
    const referenceSpace = {} as XRReferenceSpace;
    const frame = createFrame(
      createPose([0, 1.6, 0], [0, 0, 0, 1]),
      new Map([[gripSpace, createPose([0.25, 1.2, -0.5], [0, 0, 0, 1])]])
    );
    const source = createInputSource('right', gripSpace, ['oculus-touch-v3']);

    const inputFrame = XRInputFrameBuilder.build(
      1250,
      frame,
      referenceSpace,
      rig,
      [source]
    );

    expect(inputFrame).not.toBeNull();
    expect(inputFrame!.head.position.toArray()).toEqual([10, 20, 3.6]);
    expect(inputFrame!.hands.right!.pose.position.x).toBeCloseTo(9.5);
    expect(inputFrame!.hands.right!.pose.position.y).toBeCloseTo(20.25);
    expect(inputFrame!.hands.right!.pose.position.z).toBeCloseTo(3.2);
    expect(inputFrame!.hands.right!.pose.trackingState).toBe('tracked');
    expect(inputFrame!.hands.right!.interactionProfile).toBe('oculus-touch-v3');
  });

  test('rejects a non-finite XR timestamp at the input boundary', () => {
    const referenceSpace = {} as XRReferenceSpace;
    const frame = createFrame(
      createPose([0, 1.6, 0], [0, 0, 0, 1]),
      new Map()
    );

    expect(() => XRInputFrameBuilder.build(
      Number.NaN,
      frame,
      referenceSpace,
      new THREE.Group(),
      []
    )).toThrow('timestamp must be a finite non-negative number');
  });

  test('keeps the target-ray pose separate from the controller grip pose', () => {
    const rig = new THREE.Group();
    const gripSpace = {} as XRSpace;
    const targetRaySpace = {} as XRSpace;
    const referenceSpace = {} as XRReferenceSpace;
    const frame = createFrame(
      createPose([0, 1.6, 0], [0, 0, 0, 1]),
      new Map([
        [gripSpace, createPose([0.2, 1.2, -0.4], [0, 0, 0, 1])],
        [targetRaySpace, createPose([0.2, 1.25, -0.45], [0, 0.7071068, 0, 0.7071068])],
      ])
    );
    const source = createInputSource(
      'right',
      gripSpace,
      ['oculus-touch-v3'],
      targetRaySpace
    );

    const inputFrame = XRInputFrameBuilder.build(
      1250,
      frame,
      referenceSpace,
      rig,
      [source]
    );

    expect(inputFrame!.hands.right!.pose.position.toArray()).toEqual([0.2, 1.2, -0.4]);
    expect(inputFrame!.hands.right!.targetRayPose.position.toArray()).toEqual([
      0.2,
      1.25,
      -0.45,
    ]);
    expect(inputFrame!.hands.right!.targetRayPose.orientation.y).toBeCloseTo(0.7071068);
  });
});

function createPose(
  position: readonly [number, number, number],
  orientation: readonly [number, number, number, number]
): XRPose {
  return {
    transform: {
      position: { x: position[0], y: position[1], z: position[2], w: 1 },
      orientation: {
        x: orientation[0],
        y: orientation[1],
        z: orientation[2],
        w: orientation[3],
      },
    },
    emulatedPosition: false,
    linearVelocity: null,
    angularVelocity: null,
  } as unknown as XRPose;
}

function createFrame(viewerPose: XRPose, poses: ReadonlyMap<XRSpace, XRPose>): XRFrame {
  return {
    getViewerPose: () => viewerPose,
    getPose: (space: XRSpace) => poses.get(space) ?? null,
  } as unknown as XRFrame;
}

function createInputSource(
  handedness: XRHandedness,
  gripSpace: XRSpace,
  profiles: readonly string[],
  targetRaySpace: XRSpace = gripSpace
): XRInputSource {
  return {
    handedness,
    gripSpace,
    targetRaySpace,
    profiles: [...profiles],
    gamepad: {
      axes: [0, 0, 0, 0],
      buttons: [],
    },
  } as unknown as XRInputSource;
}
