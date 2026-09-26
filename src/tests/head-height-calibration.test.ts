import { describe, expect, test } from '@jest/globals';
import { HeadHeightCalibration } from '@/vr/runtime/HeadHeightCalibration';

const options = { calibrationFrames: 5, riseMetres: 0.3, riseHoldMs: 1500 };

function feed(calibration: HeadHeightCalibration, y: number, fromMs: number, toMs: number, stepMs = 14) {
  const events = [];
  for (let t = fromMs; t <= toMs; t += stepMs) {
    const event = calibration.sample(y, t);
    if (event) events.push(event);
  }
  return events;
}

describe('HeadHeightCalibration', () => {
  test('calibrates to the median of the first steady frames', () => {
    const calibration = new HeadHeightCalibration(options);
    const events = [1.70, 1.72, 1.71, 1.69, 1.71].map((y, i) => calibration.sample(y, i * 14)).filter(Boolean);
    expect(events).toEqual([{ kind: 'calibrated', baselineMetres: 1.71 }]);
  });

  test('a player who stands up after a low calibration is raised to standing height', () => {
    // Round P1: VR was entered with the headset at 1.09 m; standing up then
    // put the player ~0.6 m above every character.
    const calibration = new HeadHeightCalibration(options);
    feed(calibration, 1.09, 0, 100);
    expect(calibration.baselineMetres).toBe(1.09);
    const events = feed(calibration, 1.72, 200, 2000);
    expect(events).toEqual([{ kind: 'raised', baselineMetres: 1.72, previousMetres: 1.09 }]);
    expect(calibration.baselineMetres).toBe(1.72);
  });

  test('a short rise (a hop, a stretch) does not move the baseline', () => {
    const calibration = new HeadHeightCalibration(options);
    feed(calibration, 1.2, 0, 100);
    expect(feed(calibration, 1.6, 200, 1400)).toEqual([]);
    feed(calibration, 1.2, 1414, 1600);
    expect(feed(calibration, 1.6, 1700, 2900)).toEqual([]);
    expect(calibration.baselineMetres).toBe(1.2);
  });

  test('leaning or tiptoes below the rise threshold never recalibrates', () => {
    const calibration = new HeadHeightCalibration(options);
    feed(calibration, 1.7, 0, 100);
    expect(feed(calibration, 1.95, 200, 10000)).toEqual([]);
  });

  test('crouching stays a crouch: the baseline is never lowered automatically', () => {
    const calibration = new HeadHeightCalibration(options);
    feed(calibration, 1.7, 0, 100);
    expect(feed(calibration, 1.0, 200, 10000)).toEqual([]);
    expect(calibration.baselineMetres).toBe(1.7);
  });

  test('implausible tracking is ignored, and reset starts over', () => {
    const calibration = new HeadHeightCalibration(options);
    expect(feed(calibration, 0.1, 0, 200)).toEqual([]);
    expect(calibration.baselineMetres).toBeNull();
    feed(calibration, 1.7, 300, 400);
    calibration.reset();
    expect(calibration.baselineMetres).toBeNull();
  });
});

describe('the view never rises above the character outside the swoop', () => {
  // Imported lazily: VRSpike pulls in the renderer stack.
  const clamp = (eye: number, baseline: number | null, head: number | null) =>
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('@/vr/VRSpike').VRSpike.clampedEyeHeightOffset(eye, baseline, head) as number;

  test('standing up after a low calibration is held at the character eye', () => {
    // baseline 1.09 (headset low at entry), head now 1.72: camera = rig + head.
    expect(1.72 + clamp(1.63, 1.09, 1.72)).toBeCloseTo(1.63);
  });

  test('at the baseline the camera is at the character eye, and crouching goes lower', () => {
    expect(1.7 + clamp(1.63, 1.7, 1.7)).toBeCloseTo(1.63);
    expect(1.1 + clamp(1.63, 1.7, 1.1)).toBeCloseTo(1.03);
  });

  test('before calibration the head is only ever pulled down', () => {
    expect(1.9 + clamp(1.63, null, 1.9)).toBeCloseTo(1.63);
    expect(clamp(1.63, null, 1.2)).toBe(0);
  });
});
