import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { VRSpike } from '@/vr/VRSpike';
import { createFloorWalkableQuery, VRWalkmeshQuery } from '@/vr/runtime/VRWallSoftBlock';

/**
 * Round 7: on the Ebon Hawk's exterior walkway the view drifted into the hull
 * and then shook uncontrollably, and both carried on back inside the ship.
 * Reproduced in the emulator with the physical head 1.2 m from the play-space
 * centre: an engine facing change moved the view 1.64 m with no input, and the
 * wall soft-block then flipped the rig 0.26 m back and forth on every frame.
 */

const FEET = new THREE.Vector3(10, 20, 1.8);
/** XR reference space: 1.2 m forward of the play-space centre, 1.1 m up. */
const LOCAL_HEAD = new THREE.Vector3(0, 1.1, -1.2);

let facing = 0;
let floor: VRWalkmeshQuery | null = null;

function headWorld(): THREE.Vector3 {
  const rig = (VRSpike as any).rig as THREE.Object3D;
  return LOCAL_HEAD.clone().applyQuaternion(rig.quaternion).add(rig.position);
}

function sync(): void {
  (VRSpike as any).syncRig(new THREE.PerspectiveCamera());
}

describe('VR rig follows the avatar', () => {
  beforeEach(() => {
    facing = 0.3;
    floor = null;
    (VRSpike as any).rig = new THREE.Group();
    (VRSpike as any).latestLocalHeadPosition = LOCAL_HEAD.clone();
    (VRSpike as any).turnOriginOffset.set(0, 0, 0);
    (VRSpike as any).turnYaw = 0;
    (VRSpike as any).lastRigFacing = null;
    (VRSpike as any).lastRigSyncMs = Number.NEGATIVE_INFINITY;
    (VRSpike as any).rigAnchorPending = true;
    (VRSpike as any).headHeightBaselineMetres = null;
    VRSpike.yawOffset = 0;
    VRSpike.hooks = {
      update: () => undefined,
      getPlayerPosition: () => FEET.clone(),
      getFacing: () => facing,
      getWorldContext: () => ({ module: null, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }),
      getSoftBlockFloor: () => floor,
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    (VRSpike as any).rig = null;
    (VRSpike as any).latestLocalHeadPosition = null;
    (VRSpike as any).turnOriginOffset.set(0, 0, 0);
    VRSpike.hooks = null as any;
  });

  test('the first sync seats the head directly over the avatar', () => {
    sync();
    const head = headWorld();
    expect(head.x).toBeCloseTo(FEET.x);
    expect(head.y).toBeCloseTo(FEET.y);
  });

  test('an engine facing change turns the world about the head instead of swinging the head away', () => {
    sync();
    const before = headWorld();

    facing += 1.5;
    sync();

    const after = headWorld();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeCloseTo(0, 6);
  });

  test('a head past a wall is pushed back to the same place on every frame, not alternately', () => {
    sync();
    // Everything east of x = 10.5 is wall.
    floor = {
      isPointWalkable: (point) => point.x <= 10.5,
      getNearestWalkablePoint: (point) => new THREE.Vector3(Math.min(point.x, 10.5), point.y, point.z),
    };
    (VRSpike as any).turnOriginOffset.set(2, 0, 0);

    const positions: THREE.Vector3[] = [];
    for (let frame = 0; frame < 6; frame++) {
      jest.spyOn(performance, 'now').mockReturnValue(1_000 + frame * 14);
      sync();
      positions.push(((VRSpike as any).rig as THREE.Object3D).position.clone());
    }

    for (const position of positions) expect(position.distanceTo(positions[0])).toBeCloseTo(0, 6);
    expect(headWorld().x).toBeCloseTo(10.5);
  });

  test('syncing again after a gap — a theater cutscene, a movie, a load — re-seats the head over the avatar', () => {
    jest.spyOn(performance, 'now').mockReturnValue(1_000);
    sync();
    (VRSpike as any).turnOriginOffset.set(1.4, -0.9, 0);
    jest.spyOn(performance, 'now').mockReturnValue(1_014);
    sync();
    expect(Math.hypot(headWorld().x - FEET.x, headWorld().y - FEET.y)).toBeGreaterThan(1);

    jest.spyOn(performance, 'now').mockReturnValue(5_000);
    sync();

    expect(headWorld().x).toBeCloseTo(FEET.x);
    expect(headWorld().y).toBeCloseTo(FEET.y);
  });

  test('a module transition re-seats the head over the avatar', () => {
    const module = { id: 'a' };
    VRSpike.hooks!.getWorldContext = () => ({ module, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }) as any;
    (VRSpike as any).worldPromptModuleInitialized = false;
    (VRSpike as any).observeWorldModuleTransition();
    jest.spyOn(performance, 'now').mockReturnValue(1_000);
    sync();
    (VRSpike as any).turnOriginOffset.set(1.4, -0.9, 0);

    const next = { id: 'b' };
    VRSpike.hooks!.getWorldContext = () => ({ module: next, position: null, room: null, roomsVisible: 0, roomsTotal: 0 }) as any;
    expect((VRSpike as any).observeWorldModuleTransition()).toBe(true);
    jest.spyOn(performance, 'now').mockReturnValue(1_014);
    sync();

    expect(headWorld().x).toBeCloseTo(FEET.x);
    expect(headWorld().y).toBeCloseTo(FEET.y);
  });
});

describe('createFloorWalkableQuery', () => {
  const face = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, z: number) => ({
    triangle: new THREE.Triangle(new THREE.Vector3(ax, ay, z), new THREE.Vector3(bx, by, z), new THREE.Vector3(cx, cy, z)),
  });
  const square = (x0: number, y0: number, x1: number, y1: number, z: number) => ({
    walkableFaces: [face(x0, y0, x1, y0, x1, y1, z), face(x0, y0, x1, y1, x0, y1, z)],
  });

  test('a head leaning through a doorway into a linked room is on walkable floor', () => {
    const query = createFloorWalkableQuery([square(0, 0, 4, 4, 0), square(4, 0, 8, 4, 0)], 0)!;
    expect(query.isPointWalkable(new THREE.Vector3(5, 2, 0))).toBe(true);
  });

  test('floor on another level at the same spot does not count', () => {
    // The exterior walkway above the hull at 12 m; the player stands at 0.
    const query = createFloorWalkableQuery([square(0, 0, 4, 4, 0), square(4, 0, 8, 4, 12)], 0)!;
    expect(query.isPointWalkable(new THREE.Vector3(5, 2, 0))).toBe(false);
    const nearest = query.getNearestWalkablePoint(new THREE.Vector3(5, 2, 1.1));
    expect(nearest.x).toBeCloseTo(4);
    expect(nearest.z).toBeCloseTo(0);
  });

  test('no walkmesh means no query', () => {
    expect(createFloorWalkableQuery([null, undefined], 0)).toBeNull();
  });
});
