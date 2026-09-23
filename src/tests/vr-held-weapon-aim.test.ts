import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { XRControllerAnchorHost, measureHeldItemBarrel } from '@/vr/runtime/XRControllerAnchorHost';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

/**
 * A pistol shaped like the retail Mining Laser as measured in grip space: the
 * barrel runs along model +Y from just behind the grip to 0.30 m in front, and
 * the handle hangs along Z.
 */
function pistol(): THREE.Group {
  const model = new THREE.Group();
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.37, 0.06));
  barrel.position.set(0.01, 0.118, 0.03);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.2));
  handle.position.set(0, 0, -0.04);
  model.add(barrel, handle);
  model.updateMatrixWorld(true);
  return model;
}

function pose(position = new THREE.Vector3(), orientation = new THREE.Quaternion()): XRWorldPose {
  return { position, orientation, linearVelocity: null, angularVelocity: null, trackingState: 'tracked' };
}

const HALF_TURN_FALLBACK = { rotation: new THREE.Euler(Math.PI, 0, 0), scale: 1 };

describe('held weapon aim', () => {
  test('measures the barrel as the longest axis, pointing to its far end', () => {
    const visual = new THREE.Group();
    const barrelMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.37, 0.06));
    barrelMesh.matrixAutoUpdate = false;
    barrelMesh.matrix.makeTranslation(0, -0.118, 0);
    visual.add(barrelMesh);

    const barrel = measureHeldItemBarrel(visual);

    expect(barrel).not.toBeNull();
    expect(barrel!.direction.toArray()).toEqual([0, -1, 0]);
    expect(barrel!.origin.y).toBeCloseTo(-0.303, 3);
  });

  test('has no barrel to aim along on an empty model', () => {
    expect(measureHeldItemBarrel(new THREE.Group())).toBeNull();
  });

  test('a held blaster aims out of the muzzle along the barrel, not along the controller ray', () => {
    const host = new XRControllerAnchorHost(new THREE.Group());
    host.setHeldVisual('right', {
      model: pistol(),
      baseItemClass: 'w_BlstrPstl',
      classFallback: HALF_TURN_FALLBACK,
      aimsAlongBarrel: true,
    });
    // A Touch grip pitched 45 degrees up from the ray, as the emulator reports.
    const grip = pose(
      new THREE.Vector3(1, 2, 3),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 4),
    );

    const aim = host.getAimPose('right', grip);

    expect(aim).not.toBeNull();
    const aimForward = new THREE.Vector3(0, 0, -1).applyQuaternion(aim!.orientation);
    // The half-turn fallback puts the barrel along grip -Y; composed with the
    // grip's pitch that is forward and 45 degrees down.
    const barrelForward = new THREE.Vector3(0, -1, 0).applyQuaternion(grip.orientation);
    expect(aimForward.angleTo(barrelForward)).toBeCloseTo(0, 5);
    expect(aim!.position.distanceTo(grip.position)).toBeGreaterThan(0.25);
    expect(aim!.trackingState).toBe('tracked');
  });

  test('melee weapons and empty hands keep the controller ray', () => {
    const host = new XRControllerAnchorHost(new THREE.Group());
    host.setHeldVisual('right', {
      model: pistol(),
      baseItemClass: 'w_VbroShrt',
      classFallback: HALF_TURN_FALLBACK,
    });
    expect(host.getAimPose('right', pose())).toBeNull();
    expect(host.getAimPose('left', pose())).toBeNull();
  });

  test('an untracked hand has no aim', () => {
    const host = new XRControllerAnchorHost(new THREE.Group());
    host.setHeldVisual('right', {
      model: pistol(),
      baseItemClass: 'w_BlstrPstl',
      classFallback: HALF_TURN_FALLBACK,
      aimsAlongBarrel: true,
    });
    expect(host.getAimPose('right', { ...pose(), trackingState: 'unavailable' })).toBeNull();
  });

  test('dropping the weapon drops its aim', () => {
    const host = new XRControllerAnchorHost(new THREE.Group());
    host.setHeldVisual('right', {
      model: pistol(),
      baseItemClass: 'w_BlstrPstl',
      classFallback: HALF_TURN_FALLBACK,
      aimsAlongBarrel: true,
    });
    host.setHeldVisual('right', null);
    expect(host.getAimPose('right', pose())).toBeNull();
  });
});
