import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import { VRSpike } from '@/vr/VRSpike';
import { LocomotionController } from '@/vr/runtime/LocomotionController';
import { XRCoordinateConverter } from '@/vr/runtime/XRCoordinateConverter';

/**
 * Recenter has to be right by construction rather than by feel: a wrong
 * recenter is a comfort hazard, and it is the one control the roadmap deferred
 * specifically because it could not be checked without a device. These tests
 * assert its two invariants directly.
 */
function xrHeadPose(x: number, y: number, z: number): DOMPointReadOnly {
  return { x, y, z, w: 1 } as unknown as DOMPointReadOnly;
}

/** Rebuild the rig rotation exactly as `syncRig` does for the next frame. */
function rebuildRig(facing: number, yawOffset: number, turnYaw: number): THREE.Object3D {
  const rig = new THREE.Object3D();
  XRCoordinateConverter.applyXRToGameBasis(rig);
  rig.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), facing + Math.PI / 2 + yawOffset + turnYaw);
  return rig;
}

/** XR-space yaw, i.e. about the XR up axis (Y), as a headset reports it. */
function xrYaw(radians: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
}

function applyRecenter(headPosition: DOMPointReadOnly, headWorld: THREE.Quaternion): void {
  (VRSpike as any).applyRecenter(headPosition, headWorld);
}

function currentState(): { yawOffset: number; originOffset: THREE.Vector3 } {
  return {
    yawOffset: VRSpike.yawOffset,
    originOffset: (VRSpike as any).turnOriginOffset.clone(),
  };
}

describe('VRSpike recenter', () => {
  const facing = 0.7;
  const turnYaw = 0;
  let originalYawOffset: number;

  beforeEach(() => {
    originalYawOffset = VRSpike.yawOffset;
    VRSpike.yawOffset = 0;
    (VRSpike as any).turnOriginOffset.set(0, 0, 0);
  });

  afterEach(() => {
    VRSpike.yawOffset = originalYawOffset;
    (VRSpike as any).turnOriginOffset.set(0, 0, 0);
    (VRSpike as any).rig = null;
  });

  function recenterFrom(headLocal: THREE.Vector3, headYawRadians: number): {
    rigAfter: THREE.Object3D;
    headWorldAfter: THREE.Vector3;
    headFacingAfter: number;
    rigFacingAfter: number;
  } {
    const rig = rebuildRig(facing, VRSpike.yawOffset, turnYaw);
    (VRSpike as any).rig = rig;
    const xrHeadOrientation = xrYaw(headYawRadians);
    const headWorldOrientation = rig.quaternion.clone().multiply(xrHeadOrientation);

    applyRecenter(xrHeadPose(headLocal.x, headLocal.y, headLocal.z), headWorldOrientation);

    // What the next frame will build.
    const rigAfter = rebuildRig(facing, VRSpike.yawOffset, turnYaw);
    const originOffset = (VRSpike as any).turnOriginOffset as THREE.Vector3;
    const headWorldAfter = headLocal.clone()
      .applyQuaternion(rigAfter.quaternion)
      .add(originOffset);
    return {
      rigAfter,
      headWorldAfter,
      headFacingAfter: LocomotionController.worldOrientationToCreatureFacing(
        rigAfter.quaternion.clone().multiply(xrHeadOrientation)
      ),
      rigFacingAfter: LocomotionController.worldOrientationToCreatureFacing(rigAfter.quaternion),
    };
  }

  test('puts the physical forward onto the natural game forward', () => {
    const result = recenterFrom(new THREE.Vector3(0.4, 1.6, -0.25), THREE.MathUtils.degToRad(37));

    // Rotating the rig turns the head with it, so the head can never be aligned
    // to the rig's *current* forward. The reachable target is the bearing with
    // the recenter offset removed — `facing + 90 degrees + turnYaw`.
    const naturalForward = LocomotionController.worldOrientationToCreatureFacing(
      rebuildRig(facing, 0, turnYaw).quaternion
    );
    expect(result.headFacingAfter).toBeCloseTo(naturalForward, 6);
  });

  test('preserves deliberate in-game turning', () => {
    const appliedTurn = THREE.MathUtils.degToRad(90);
    const rig = rebuildRig(facing, 0, appliedTurn);
    (VRSpike as any).rig = rig;
    const xrHeadOrientation = xrYaw(THREE.MathUtils.degToRad(37));

    applyRecenter(
      xrHeadPose(0.4, 1.6, -0.25),
      rig.quaternion.clone().multiply(xrHeadOrientation)
    );

    const rigAfter = rebuildRig(facing, VRSpike.yawOffset, appliedTurn);
    const headFacingAfter = LocomotionController.worldOrientationToCreatureFacing(
      rigAfter.quaternion.clone().multiply(xrHeadOrientation)
    );
    // Snap/smooth turn lives in turnYaw and is intentional; recenter cancels
    // only the physical offset, so the target still includes the turn.
    const naturalForward = LocomotionController.worldOrientationToCreatureFacing(
      rebuildRig(facing, 0, appliedTurn).quaternion
    );
    expect(headFacingAfter).toBeCloseTo(naturalForward, 6);
  });

  test('puts the head over the rig origin horizontally', () => {
    const result = recenterFrom(new THREE.Vector3(0.4, 1.6, -0.25), THREE.MathUtils.degToRad(37));

    // The rig base is the avatar position; the offset is measured from it.
    expect(result.headWorldAfter.x).toBeCloseTo(0, 6);
    expect(result.headWorldAfter.y).toBeCloseTo(0, 6);
  });

  test('leaves the rig floor on the world floor', () => {
    recenterFrom(new THREE.Vector3(0.4, 1.6, -0.25), THREE.MathUtils.degToRad(37));

    // Vertical placement comes from the headset's own local-floor tracking;
    // moving the rig in Z would break the fixed canonical eye height.
    expect((VRSpike as any).turnOriginOffset.z).toBe(0);
  });

  test('does not drift when applied repeatedly from the same pose', () => {
    const headLocal = new THREE.Vector3(0.4, 1.6, -0.25);
    const headYaw = THREE.MathUtils.degToRad(37);

    recenterFrom(headLocal, headYaw);
    const first = currentState();
    // Recentring does not move the player physically, so the headset still
    // reports the same XR pose. Pressing again must therefore be a no-op —
    // that is what makes repeated presses safe.
    recenterFrom(headLocal, headYaw);
    const second = currentState();

    expect(second.yawOffset).toBeCloseTo(first.yawOffset, 6);
    expect(second.originOffset.x).toBeCloseTo(first.originOffset.x, 6);
    expect(second.originOffset.y).toBeCloseTo(first.originOffset.y, 6);
  });

  test('ignores a degenerate straight-up pose instead of throwing', () => {
    const rig = rebuildRig(facing, 0, turnYaw);
    (VRSpike as any).rig = rig;
    // Pitched fully up: the forward vector has no horizontal component, and the
    // facing conversion throws rather than inventing one.
    const straightUp = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), Math.PI / 2
    );
    const headWorldOrientation = rig.quaternion.clone().multiply(straightUp);

    expect(() => applyRecenter(xrHeadPose(0.4, 1.6, -0.25), headWorldOrientation)).not.toThrow();
    expect(VRSpike.yawOffset).toBe(0);
    expect((VRSpike as any).turnOriginOffset.lengthSq()).toBe(0);
  });

  test('does nothing without a rig', () => {
    (VRSpike as any).rig = null;

    expect(() => applyRecenter(xrHeadPose(0, 1.6, 0), new THREE.Quaternion())).not.toThrow();
    expect(VRSpike.yawOffset).toBe(0);
  });
});
