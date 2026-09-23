import { describe, expect, test } from '@jest/globals';
import {
  angleToVector, canAddMultiClass, effectsMatchExactly, pointFacingAway, MAX_CREATURE_CLASSES,
} from '@/nwscript/TSLRoutineRules';

const effect = (type: number, ints: number[]) => ({ type, getInt: (i: number) => ints[i] });

describe('AngleToVector', () => {
  test('uses the SetFacing convention: anticlockwise degrees from due east', () => {
    const east = angleToVector(0);
    const north = angleToVector(90);
    expect(east.x).toBeCloseTo(1); expect(east.y).toBeCloseTo(0);
    expect(north.x).toBeCloseTo(0); expect(north.y).toBeCloseTo(1);
    expect(angleToVector(180).x).toBeCloseTo(-1);
    expect(angleToVector(45).z).toBe(0);
  });

  test('a non-finite angle is treated as east rather than producing NaN', () => {
    expect(angleToVector(NaN)).toEqual({ x: 1, y: 0, z: 0 });
  });
});

describe('FaceObjectAwayFromObject', () => {
  test('faces the point mirrored through the facer, away from the other object', () => {
    expect(pointFacingAway({ x: 2, y: 3, z: 1 }, { x: 0, y: 0, z: 0 })).toEqual({ x: 4, y: 6, z: 1 });
  });

  test('has no direction when both stand on the same spot', () => {
    expect(pointFacingAway({ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 5 })).toBeNull();
  });
});

describe('AddMultiClass', () => {
  const CLASS_COUNT = 12;
  test('adds a second class the creature does not have', () => {
    expect(canAddMultiClass([{ id: 0 }], 5, CLASS_COUNT)).toBe(true);
  });

  test('never duplicates a class or exceeds two classes', () => {
    expect(canAddMultiClass([{ id: 5 }], 5, CLASS_COUNT)).toBe(false);
    expect(MAX_CREATURE_CLASSES).toBe(2);
    expect(canAddMultiClass([{ id: 0 }, { id: 3 }], 5, CLASS_COUNT)).toBe(false);
  });

  test('rejects class ids outside classes.2da', () => {
    expect(canAddMultiClass([], -1, CLASS_COUNT)).toBe(false);
    expect(canAddMultiClass([], CLASS_COUNT, CLASS_COUNT)).toBe(false);
    expect(canAddMultiClass([], 1.5, CLASS_COUNT)).toBe(false);
  });
});

describe('RemoveEffectByExactMatch', () => {
  test('matches type and the first two integers, as a_swapimplant relies on', () => {
    expect(effectsMatchExactly(effect(7, [0, 4, 99]), effect(7, [0, 4]))).toBe(true);
    expect(effectsMatchExactly(effect(7, [0, 4]), effect(7, [2, 4]))).toBe(false);
    expect(effectsMatchExactly(effect(7, [0, 4]), effect(7, [0, 3]))).toBe(false);
    expect(effectsMatchExactly(effect(8, [0, 4]), effect(7, [0, 4]))).toBe(false);
  });

  test('treats unset integers as zero', () => {
    expect(effectsMatchExactly(effect(7, []), effect(7, [0, 0]))).toBe(true);
  });
});
