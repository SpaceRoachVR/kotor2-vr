import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import {
  measureVRCombatAim,
  resolveVRCombatAimedTargetId,
  VRCombatAimCandidate,
} from '@/vr/runtime/VRCombatAimResolver';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

/** A tracked ray from `origin` whose -Z axis points at `lookAt`. */
function poseAimedAt(origin: THREE.Vector3, lookAt: THREE.Vector3): XRWorldPose {
  const direction = lookAt.clone().sub(origin).normalize();
  return {
    position: origin,
    orientation: new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, -1),
      direction,
    ),
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}

const ACTOR = new THREE.Vector3(0, 0, 0);
/** Creature origins sit on the floor; the resolver lifts the test sphere itself. */
const droid = (id: number, x: number, y: number): VRCombatAimCandidate => ({
  id,
  position: new THREE.Vector3(x, y, 0),
});
/** The point the resolver actually tests against, for aiming in tests. */
const bodyOf = (candidate: VRCombatAimCandidate): THREE.Vector3 =>
  candidate.position.clone().setZ(candidate.position.z + 0.9);

const EYE = new THREE.Vector3(0, 0, 1.6);

describe('resolveVRCombatAimedTargetId', () => {
  test('resolves a hostile well beyond the 3m interaction range', () => {
    // The regression this exists for: 3m is the interaction reach, 15m is the
    // ranged combat reach, and everything between was unaimable.
    const target = droid(42, 0, 10);
    const id = resolveVRCombatAimedTargetId({
      rayPose: poseAimedAt(EYE, bodyOf(target)),
      actorPosition: ACTOR,
      candidates: [target],
      maxRangeMetres: 15,
    });
    expect(id).toBe(42);
  });

  test('refuses a hostile outside combat range even when aimed straight at it', () => {
    const target = droid(42, 0, 44);
    const id = resolveVRCombatAimedTargetId({
      rayPose: poseAimedAt(EYE, bodyOf(target)),
      actorPosition: ACTOR,
      candidates: [target],
      maxRangeMetres: 15,
    });
    expect(id).toBeNull();
  });

  test('uses the melee range when that is what was passed', () => {
    const target = droid(7, 0, 5);
    const request = {
      rayPose: poseAimedAt(EYE, bodyOf(target)),
      actorPosition: ACTOR,
      candidates: [target],
    };
    expect(resolveVRCombatAimedTargetId({ ...request, maxRangeMetres: 15 })).toBe(7);
    expect(resolveVRCombatAimedTargetId({ ...request, maxRangeMetres: 2 })).toBeNull();
  });

  test('returns the nearest of two hostiles along the same ray', () => {
    // Two identical droids in a line is exactly the case a name plate cannot
    // disambiguate, so the wheel must act on the closer one. The barrel is at
    // body height here so the two really share a bearing: from eye height
    // they sit 3.3 degrees apart and the one under the barrel wins instead.
    const near = droid(1, 0, 6);
    const far = droid(2, 0, 12);
    const id = resolveVRCombatAimedTargetId({
      rayPose: poseAimedAt(new THREE.Vector3(0, 0, 0.9), bodyOf(far)),
      actorPosition: ACTOR,
      candidates: [far, near],
      maxRangeMetres: 15,
    });
    expect(id).toBe(1);
  });

  test('returns null when the ray points away from every hostile', () => {
    const target = droid(42, 0, 10);
    const id = resolveVRCombatAimedTargetId({
      rayPose: poseAimedAt(EYE, new THREE.Vector3(0, -10, 1.6)),
      actorPosition: ACTOR,
      candidates: [target],
      maxRangeMetres: 15,
    });
    expect(id).toBeNull();
  });

  test('aims at the body rather than the feet', () => {
    // A ray held level from eye height never descends to a creature's origin,
    // so testing the floor point alone made a target in the crosshair unaimable.
    const target = droid(42, 0, 10);
    const level = poseAimedAt(EYE, new THREE.Vector3(0, 10, 1.6));
    expect(
      resolveVRCombatAimedTargetId({
        rayPose: level,
        actorPosition: ACTOR,
        candidates: [target],
        maxRangeMetres: 15,
        aimAssistRadiusMetres: 0.35,
      }),
    ).toBe(42);
  });

  test('aim assist widens the target without changing which one wins', () => {
    const target = droid(42, 0.9, 10);
    const request = {
      rayPose: poseAimedAt(EYE, new THREE.Vector3(0, 10, 0.9)),
      actorPosition: ACTOR,
      candidates: [target],
      maxRangeMetres: 15,
    };
    expect(resolveVRCombatAimedTargetId(request)).toBeNull();
    expect(resolveVRCombatAimedTargetId({ ...request, aimAssistRadiusMetres: 1.5 })).toBe(42);
  });

  test('ignores malformed candidates instead of failing the whole resolution', () => {
    const good = droid(9, 0, 8);
    const id = resolveVRCombatAimedTargetId({
      rayPose: poseAimedAt(EYE, bodyOf(good)),
      actorPosition: ACTOR,
      candidates: [
        null as never,
        { id: 1.5, position: new THREE.Vector3(0, 8, 0) },
        { id: 3, position: new THREE.Vector3(NaN, 8, 0) },
        good,
      ],
      maxRangeMetres: 15,
    });
    expect(id).toBe(9);
  });

  test('rejects a nonsensical range rather than silently targeting nothing', () => {
    const target = droid(42, 0, 10);
    expect(() =>
      resolveVRCombatAimedTargetId({
        rayPose: poseAimedAt(EYE, bodyOf(target)),
        actorPosition: ACTOR,
        candidates: [target],
        maxRangeMetres: 0,
      }),
    ).toThrow(RangeError);
  });

  test('returns null for an untracked or malformed ray', () => {
    const target = droid(42, 0, 10);
    const broken: XRWorldPose = {
      position: new THREE.Vector3(NaN, 0, 1.6),
      orientation: new THREE.Quaternion(),
      linearVelocity: null,
      angularVelocity: null,
      trackingState: 'tracked',
    };
    expect(
      resolveVRCombatAimedTargetId({
        rayPose: broken,
        actorPosition: ACTOR,
        candidates: [target],
        maxRangeMetres: 15,
      }),
    ).toBeNull();
  });
});

describe('measureVRCombatAim', () => {
  // Bolt's grouped troopers: three at 9 m, 1.3 m apart. With the aim-assist
  // sphere every one of them is "hit" when the barrel sits on the middle one,
  // and the old nearest-along-the-ray rule handed the shot to whichever stood
  // a step closer rather than the one under the barrel.
  const a = droid(1, -1.3, 9);
  const b = droid(2, 0, 8.6);
  const c = droid(3, 1.3, 9);
  const request = (lookAt: THREE.Vector3) => ({
    rayPose: poseAimedAt(EYE, lookAt),
    actorPosition: ACTOR,
    candidates: [a, b, c],
    maxRangeMetres: 15,
    aimAssistRadiusMetres: 0.6,
  });

  test('picks the hostile under the barrel, not the nearest one the ray grazes', () => {
    const aim = measureVRCombatAim(request(bodyOf(c)));
    expect(aim.targetId).toBe(3);
    expect(aim.offsetsDegrees.get(3)).toBeCloseTo(0, 5);
  });

  test('reports the barrel offset of every hostile in range, hit or not', () => {
    const aim = measureVRCombatAim(request(bodyOf(c)));
    expect([...aim.offsetsDegrees.keys()].sort()).toEqual([1, 2, 3]);
    // A is two spacings away: well beyond the 3 degree overlap band.
    expect(aim.offsetsDegrees.get(1)!).toBeGreaterThan(14);
    expect(aim.offsetsDegrees.get(2)!).toBeGreaterThan(7);
  });

  test('leaves hostiles beyond combat range out of the offsets', () => {
    const far = droid(9, 0, 40);
    const aim = measureVRCombatAim({ ...request(bodyOf(c)), candidates: [a, far] });
    expect(aim.offsetsDegrees.has(9)).toBe(false);
  });

  test('within 3 degrees of each other the nearer hostile still wins', () => {
    const near = droid(1, 0, 6);
    const far = droid(2, 0.2, 12);
    const aim = measureVRCombatAim({
      rayPose: poseAimedAt(new THREE.Vector3(0, 0, 0.9), bodyOf(far)),
      actorPosition: ACTOR,
      candidates: [far, near],
      maxRangeMetres: 15,
      aimAssistRadiusMetres: 0.6,
    });
    expect(aim.targetId).toBe(1);
  });

  test('agrees with resolveVRCombatAimedTargetId', () => {
    expect(resolveVRCombatAimedTargetId(request(bodyOf(a)))).toBe(measureVRCombatAim(request(bodyOf(a))).targetId);
  });
});
