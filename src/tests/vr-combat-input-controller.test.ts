import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRCombatInputController } from '@/vr/runtime/VRCombatInputController';
import { CombatWeaponMode, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRCombatInputController', () => {
  test('emits every saber swing without assigning a local d20 cooldown', () => {
    const controller = new VRCombatInputController({
      minimumSwingSpeedMetresPerSecond: 0.8,
      visualSwingCooldownMilliseconds: 100,
    });

    expect(controller.process(frame(0, 0), context('melee-one-handed', 0))).toEqual([]);
    const firstSwing = controller.process(frame(160, -0.3), context('melee-one-handed', 160));
    const secondSwing = controller.process(frame(320, 0), context('melee-one-handed', 320));

    expect(firstSwing).toEqual([expect.objectContaining({ weaponMode: 'melee-one-handed' })]);
    expect(secondSwing).toEqual([expect.objectContaining({ weaponMode: 'melee-one-handed' })]);
    expect(firstSwing[0]).not.toHaveProperty('rollEligible');
    expect(secondSwing[0]).not.toHaveProperty('rollEligible');
  });

  test('an unarmed punch is a swing, because VR has no automatic basic attack', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });

    controller.process(frame(0, 0), context('unarmed', 0));
    const punch = controller.process(frame(160, -0.3), context('unarmed', 160));

    expect(punch).toEqual([expect.objectContaining({ weaponMode: 'unarmed', input: 'dominant-swing' })]);
  });

  test('promotes to two-handed only when both hands are actually on the hilt', () => {
    // ROADMAP 3.3. The grip button alone is not a two-handed grip: the off hand
    // has to be tracked and close enough to be holding the same weapon.
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    const nearHilt = (y: number) => new THREE.Vector3(0, y, -0.55);

    controller.process(frame(0, 0, nearHilt(0)), context('melee-one-handed', 0, true));
    // A two-handed swing must be fast on two samples running (critic run 14).
    expect(controller.process(frame(80, -0.15, nearHilt(-0.15)), context('melee-one-handed', 80, true))).toHaveLength(0);
    const swing = controller.process(frame(160, -0.3, nearHilt(-0.3)), context('melee-one-handed', 160, true));

    expect(swing[0]).toMatchObject({ weaponMode: 'melee-two-handed', hand: 'right' });
    expect(swing[0].gripSeparationMetres).toBeCloseTo(0.15, 6);
  });

  test('does not promote when the grip is held but the off hand is nowhere near', () => {
    const controller = new VRCombatInputController({
      minimumSwingSpeedMetresPerSecond: 0.8,
      twoHandedGripMaxSeparationMetres: 0.35,
    });
    const farAway = (y: number) => new THREE.Vector3(1.2, y, -0.4);

    controller.process(frame(0, 0, farAway(0)), context('melee-one-handed', 0, true));
    const swing = controller.process(frame(160, -0.3, farAway(-0.3)), context('melee-one-handed', 160, true));

    expect(swing[0]).toMatchObject({ weaponMode: 'melee-one-handed' });
    expect(swing[0].gripSeparationMetres).toBeUndefined();
  });

  test('does not promote when the off hand is not tracked at all', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });

    controller.process(frame(0, 0), context('melee-one-handed', 0, true));
    const swing = controller.process(frame(160, -0.3), context('melee-one-handed', 160, true));

    expect(swing[0]).toMatchObject({ weaponMode: 'melee-one-handed' });
  });

  test('the off hand alone can drive a swing in a two-handed grip', () => {
    // The point of 3.3. The dominant hand is completely still; only the off
    // hand moves, rotating the blade about the rear hand. Sampling the dominant
    // hand — which is what the old implementation did — would see zero speed
    // and emit nothing.
    const controller = new VRCombatInputController({
      minimumSwingSpeedMetresPerSecond: 0.8,
      bladeSampleDistanceMetres: 0.6,
    });
    const rearHandY = 0;

    controller.process(
      frame(0, rearHandY, new THREE.Vector3(0, 0.15, -0.4)),
      context('melee-one-handed', 0, true),
    );
    controller.process(
      frame(60, rearHandY, new THREE.Vector3(0.075, 0.075, -0.4)),
      context('melee-one-handed', 60, true),
    );
    const swing = controller.process(
      // Off hand swings across; dominant hand has not moved at all.
      frame(120, rearHandY, new THREE.Vector3(0.15, 0, -0.4)),
      context('melee-one-handed', 120, true),
    );

    expect(swing).toHaveLength(1);
    expect(swing[0]).toMatchObject({ weaponMode: 'melee-two-handed' });
    expect(swing[0].speedMetresPerSecond).toBeGreaterThan(0.8);
  });

  test('a still two-handed grip with tracking jitter never attacks (critic run 13)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, bladeSampleDistanceMetres: 0.6 });
    let swings = 0;
    // Hands 7 cm apart on the hilt; the off hand jitters +/-5 mm every frame
    // for 4 s at 72 Hz while the dominant hand holds still.
    for (let i = 0; i < 288; i++) {
      const t = i * (1000 / 72);
      const jitter = (i % 2 === 0 ? 1 : -1) * 0.005;
      swings += controller.process(
        frame(t, 0, new THREE.Vector3(jitter, 0.07, -0.4)),
        context('melee-one-handed', t, true),
      ).length;
    }
    expect(swings).toBe(0);
  });

  test('a reacquisition jump (tracking state change) is not a swing (critic run 13)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    const withState = (f: XRInputFrame, state: 'tracked' | 'emulated'): XRInputFrame =>
      ({ ...f, hands: { right: { ...f.hands.right!, pose: { ...f.hands.right!.pose, trackingState: state } } } });
    controller.process(withState(frame(0, 0), 'emulated'), context('melee-one-handed', 0));
    // Tracking comes back 0.3 m away, 40 ms later.
    expect(controller.process(withState(frame(40, 0.3), 'tracked'), context('melee-one-handed', 40))).toHaveLength(0);
    // A real swing once tracking has settled still counts.
    controller.process(withState(frame(200, 0.3), 'tracked'), context('melee-one-handed', 200));
    expect(controller.process(withState(frame(240, 0.5), 'tracked'), context('melee-one-handed', 240))).toHaveLength(1);
  });

  test('in game, a one-frame pop is not a swing but a swing over frames is (critic run 15)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    controller.process(frame(0, 0), context('melee-one-handed', 0));
    // A 0.10 m pop in one 40 ms frame, then still.
    expect(controller.process(frame(40, 0.1), context('melee-one-handed', 40))).toHaveLength(0);
    expect(controller.process(frame(400, 0.1), context('melee-one-handed', 400))).toHaveLength(0);
    // A real swing: fast on two frames running.
    expect(controller.process(frame(440, 0.2), context('melee-one-handed', 440))).toHaveLength(0);
    expect(controller.process(frame(480, 0.35), context('melee-one-handed', 480))).toHaveLength(1);
  });

  test('in game at low frame rate with repeated poses, a deliberate swing lands (critic run 16)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    // 75 ms frames, each pose shown twice; the hand sweeps 0.6 m in 300 ms.
    const ys = [0, 0, 0, 0, 0.15, 0.15, 0.3, 0.3, 0.45, 0.45, 0.6, 0.6];
    let swings = 0;
    ys.forEach((y, i) => { swings += controller.process(frame(i * 75, y), context('melee-one-handed', i * 75)).length; });
    expect(swings).toBeGreaterThan(0);
  });

  test('in game, a pop out and back is not a swing (critic run 16)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    [0, 0, 0.06, 0, 0, 0].forEach((y, i) => { swings += controller.process(frame(i * 40, y), context('melee-one-handed', i * 40)).length; });
    [0, 0.25, 0, 0].forEach((y, i) => { swings += controller.process(frame(1000 + i * 40, y), context('melee-one-handed', 1000 + i * 40)).length; });
    expect(swings).toBe(0);
  });

  test('in game at 60 ms frames, a pop or flick out and back is not a swing (critic run 17)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    // 8 cm out in one frame, back the next, several times.
    [0, 0, 0.08, 0, 0, 0.08, 0, 0.08, 0, 0].forEach((y, i) => { swings += controller.process(frame(i * 60, y), context('melee-one-handed', i * 60)).length; });
    expect(swings).toBe(0);
  });

  test('in game, an 8 cm jab is not a swing; a 30 cm stroke at 60 ms frames is (critic run 17)', () => {
    const jab = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    [0, 0, 0.04, 0.08, 0.08, 0.08].forEach((y, i) => { swings += jab.process(frame(i * 40, y), context('melee-one-handed', i * 40)).length; });
    expect(swings).toBe(0);
    const stroke = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let strokes = 0;
    [0, 0, 0.1, 0.2, 0.3, 0.3].forEach((y, i) => { strokes += stroke.process(frame(i * 60, y), context('melee-one-handed', i * 60)).length; });
    expect(strokes).toBeGreaterThan(0);
  });

  test('in game, a quick return stroke is recovery, not a second swing (critic run 18)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    // Out 0.75 m in ~250 ms at 50 ms frames, then back 0.6 m over ~700 ms.
    const out = [0, 0, 0.15, 0.3, 0.45, 0.6, 0.75];
    const back = [0.66, 0.57, 0.48, 0.39, 0.3, 0.21, 0.15, 0.15, 0.15];
    out.forEach((y, i) => { swings += controller.process(frame(i * 50, y), context('melee-one-handed', i * 50)).length; });
    expect(swings).toBeGreaterThan(0);
    const afterOut = swings;
    back.forEach((y, i) => { const t = 400 + i * 80; swings += controller.process(frame(t, y), context('melee-one-handed', t)).length; });
    expect(swings).toBe(afterOut);
    // A fresh swing the same way later still counts.
    const again = [0.15, 0.15, 0.3, 0.45, 0.6, 0.75];
    again.forEach((y, i) => { const t = 2500 + i * 50; swings += controller.process(frame(t, y), context('melee-one-handed', t)).length; });
    expect(swings).toBeGreaterThan(afterOut);
  });

  test('in game, continuous forehand/backhand strokes keep swinging (critic run 18)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    // 0.6 m strokes of 300 ms, alternating, at 60 ms frames, for 9 s.
    for (let t = 0, i = 0; t < 9000; t += 60, i++) {
      const phase = (t % 600) / 300;
      const y = phase < 1 ? phase * 0.6 : (2 - phase) * 0.6;
      swings += controller.process(frame(t, y), context('melee-one-handed', t)).length;
    }
    expect(swings).toBeGreaterThanOrEqual(5);
  });

  test('in game, a held follow-through then a slow return is one swing; a fast backhand is two (critic run 19)', () => {
    const held = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    // Slash 0.75 m in ~250 ms, hold 800 ms, return 0.6 m in ~450 ms.
    [0, 0, 0.15, 0.3, 0.45, 0.6, 0.75].forEach((y, i) => { swings += held.process(frame(i * 50, y), context('melee-one-handed', i * 50)).length; });
    [0.75, 0.75].forEach((y, i) => { const t = 700 + i * 400; swings += held.process(frame(t, y), context('melee-one-handed', t)).length; });
    [0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.15].forEach((y, i) => { const t = 1150 + i * 75; swings += held.process(frame(t, y), context('melee-one-handed', t)).length; });
    expect(swings).toBe(1);
    const backhand = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let both = 0;
    [0, 0, 0.15, 0.3, 0.45, 0.6, 0.75].forEach((y, i) => { both += backhand.process(frame(i * 50, y), context('melee-one-handed', i * 50)).length; });
    [0.75, 0.6, 0.45, 0.3, 0.15, 0, 0].forEach((y, i) => { const t = 700 + i * 50; both += backhand.process(frame(t, y), context('melee-one-handed', t)).length; });
    expect(both).toBe(2);
  });

  test('in game, one slow 1 s sweep is one swing event (critic run 17)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    for (let t = 0; t <= 1000; t += 50) swings += controller.process(frame(t, (t / 1000) * 1.3), context('melee-one-handed', t)).length;
    for (let t = 1050; t <= 2000; t += 50) swings += controller.process(frame(t, 1.3), context('melee-one-handed', t)).length;
    expect(swings).toBe(1);
  });

  test('in game, a pop that stays put is not a swing', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    [0, 0, 0.25, 0.25, 0.25, 0.25].forEach((y, i) => { swings += controller.process(frame(i * 40, y), context('melee-one-handed', i * 40)).length; });
    expect(swings).toBe(0);
  });

  test('in game, +/-1 cm hilt jitter in a two-handed grip never swings, a real two-handed sweep does (critic run 16)', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8, minimumFastSamples: 2 });
    let swings = 0;
    for (let i = 0; i < 150; i++) {
      const t = i * 40;
      const jitter = (i % 2 === 0 ? 1 : -1) * 0.01;
      swings += controller.process(frame(t, 0, new THREE.Vector3(jitter, 0.12, -0.4)), context('melee-one-handed', t, true)).length;
    }
    expect(swings).toBe(0);
    // Both hands sweep down together.
    let sweep = 0;
    [0, 0.1, 0.2, 0.3, 0.4].forEach((d, i) => {
      const t = 7000 + i * 50;
      sweep += controller.process(frame(t, -d, new THREE.Vector3(0, 0.12 - d, -0.4)), context('melee-one-handed', t, true)).length;
    });
    expect(sweep).toBeGreaterThan(0);
  });

  test('a double-bladed or dual-wield stance is never promoted', () => {
    // Adding a second hand to an already-two-weapon stance means something
    // other than a two-handed grip, and is not modelled.
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    const nearHilt = (y: number) => new THREE.Vector3(0, y, -0.55);

    for (const mode of ['melee-double-bladed', 'melee-dual-wield'] as const) {
      controller.reset();
      controller.process(frame(0, 0, nearHilt(0)), context(mode, 0, true));
      const swing = controller.process(frame(160, -0.3, nearHilt(-0.3)), context(mode, 160, true));

      expect(swing[0]).toMatchObject({ weaponMode: mode });
    }
  });

  test('fires a blaster once per dominant weapon-action press edge', () => {
    const controller = new VRCombatInputController();

    expect(controller.process(frame(0, 0), context('blaster', 0, false, false))).toEqual([]);
    expect(controller.process(frame(10, 0), context('blaster', 10, false, true)))
      .toEqual([expect.objectContaining({ weaponMode: 'blaster', hand: 'right' })]);
    expect(controller.process(frame(20, 0), context('blaster', 20, false, true))).toEqual([]);
  });

  test('uses the selected left dominant hand for a deliberate blaster shot', () => {
    const controller = new VRCombatInputController();

    const events = controller.process(
      frame(0, 0, new THREE.Vector3(0, -0.15, -0.4)),
      context('blaster', 0, false, true, 'left'),
    );

    expect(events).toEqual([expect.objectContaining({
      weaponMode: 'blaster', input: 'dominant-trigger', hand: 'left',
    })]);
  });

  test('does not convert a melee trigger into a basic attack without a queued aimed Force power', () => {
    const controller = new VRCombatInputController();

    expect(controller.process(frame(0, 0), context('melee-one-handed', 0, false, true))).toEqual([]);
  });

  test('keeps an aimed dominant trigger available for a queued Force power while melee is equipped', () => {
    const controller = new VRCombatInputController();

    const events = controller.process(frame(0, 0), context('melee-one-handed', 0, false, true, 'right', true));

    expect(events).toEqual([expect.objectContaining({
      weaponMode: 'melee-one-handed', input: 'dominant-trigger', hand: 'right',
    })]);
  });

  test('emits every deliberate blaster trigger press after release', () => {
    const controller = new VRCombatInputController({
      minimumSwingSpeedMetresPerSecond: 0.8,
      visualSwingCooldownMilliseconds: 100,
    });

    const firstShot = controller.process(frame(0, 0), context('blaster', 0, false, true));
    expect(firstShot).toEqual([expect.objectContaining({ weaponMode: 'blaster' })]);

    controller.process(frame(50, 0), context('blaster', 50, false, false));
    const secondShot = controller.process(frame(100, 0), context('blaster', 100, false, true));
    expect(secondShot).toEqual([expect.objectContaining({ weaponMode: 'blaster' })]);

    controller.process(frame(150, 0), context('blaster', 150, false, false));
    const thirdShot = controller.process(frame(200, 0), context('blaster', 200, false, true));
    expect(thirdShot).toEqual([expect.objectContaining({ weaponMode: 'blaster' })]);
  });

  test('rejects a non-finite recognition timestamp', () => {
    const controller = new VRCombatInputController();
    expect(() => controller.process(frame(0, 0), context('melee-one-handed', Number.NaN))).toThrow(RangeError);
  });
});

describe('swings must reach their target (ROADMAP 3.16)', () => {
  // The frame helper holds the hand at (0, y, -0.4) with identity orientation,
  // so the weapon runs from there down -Z. A capsule based at z = -2 and 1.9 m
  // tall spans it.
  const volume = (x: number) => ({ base: new THREE.Vector3(x, 0, -2), heightMetres: 1.9, radiusMetres: 0.5 });
  const at = (timestamp: number, x: number | null) => ({
    ...context('melee-one-handed', timestamp),
    nominatedTargetVolume: x === null ? null : volume(x),
  });

  test('a swing through the target counts, and reports how close it came', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    controller.process(frame(0, 0), at(0, 0.5));
    const swing = controller.process(frame(160, -0.3), at(160, 0.5));
    expect(swing).toEqual([expect.objectContaining({ input: 'dominant-swing' })]);
    // Hand at (0, -0.3), capsule axis at (0.5, 0): 0.58 m minus the 0.5 m radius.
    expect(swing[0].targetContactMetres).toBeCloseTo(0.083, 2);
  });

  test('a fast swing at empty air beside the target does not count, and is reported as a miss', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    controller.process(frame(0, 0), at(0, 5));
    expect(controller.process(frame(160, -0.3), at(160, 5))).toEqual([]);
    // The hand stops; once the swing window closes the miss is recorded.
    expect(controller.process(frame(600, -0.3), at(600, 5))).toEqual([]);
    const misses = controller.drainMisses();
    expect(misses).toHaveLength(1);
    expect(misses[0].closestMetres).toBeCloseTo(4.5, 1);
    expect(controller.drainMisses()).toHaveLength(0);
  });

  test('the blade may arrive a moment after the hand was fastest', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    controller.process(frame(0, 0), at(0, 3));
    expect(controller.process(frame(160, -0.3), at(160, 3))).toEqual([]);
    // Slow now, but still inside the 250 ms window, and the weapon is at the target.
    expect(controller.process(frame(260, -0.3), at(260, 0.5))).toHaveLength(1);
    expect(controller.process(frame(700, -0.3), at(700, 3))).toEqual([]);
  });

  test('is forgiving: passing within the slack of the body still counts', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    controller.process(frame(0, 0), at(0, 1.2));
    expect(controller.process(frame(160, -0.3), at(160, 1.2))).toHaveLength(1);
  });

  test('without a target volume the old speed-only rule stands', () => {
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    controller.process(frame(0, 0), at(0, null));
    expect(controller.process(frame(160, -0.3), at(160, null))).toHaveLength(1);
  });
});

function context(
  weaponMode: CombatWeaponMode,
  timestamp: number,
  offhandGrip = false,
  weaponActionPressed = false,
  dominantHand: 'left' | 'right' = 'right',
  allowDominantTrigger = false,
) {
  return {
    actorId: '7',
    nominatedTargetId: '42',
    weaponMode,
    timestamp,
    offhandGrip,
    weaponActionPressed,
    dominantHand,
    offhandHand: dominantHand === 'right' ? 'left' as const : 'right' as const,
    allowDominantTrigger,
  } as const;
}

function frame(
  timestamp: number,
  rightY: number,
  /** Off-hand position. Omit for a one-handed frame with no left hand tracked. */
  left?: THREE.Vector3 | null,
): XRInputFrame {
  const pose = (position: THREE.Vector3): XRWorldPose => ({
    position,
    orientation: new THREE.Quaternion(),
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  });
  const right = new THREE.Vector3(0, rightY, -0.4);
  return {
    timestamp,
    head: pose(new THREE.Vector3(0, 0, 1.7)),
    hands: {
      right: {
        hand: 'right', pose: pose(right),
        targetRayPose: pose(right), buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3',
      },
      ...(left
        ? {
          left: {
            hand: 'left' as const, pose: pose(left.clone()),
            targetRayPose: pose(left.clone()), buttons: {}, axes: [],
            interactionProfile: 'oculus-touch-v3',
          },
        }
        : {}),
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}

/**
 * Round-17 audit (Hilt, findings 2-6): strokes as the headset delivers them —
 * 17-29 fps with about one frame in three repeating the previous pose, and no
 * runtime velocity (Virtual Desktop). Every scenario is one Hilt drove in the
 * emulator; the counts are what "one physical stroke = one attack" requires.
 */
describe('stroke detection at headset frame rates (round-17 audit)', () => {
  // Rig-style axes: x right, y up, -z forward. Guard and slash end are 0.53 m apart.
  const guard = new THREE.Vector3(0.25, 1.3, -0.3);
  const slashEnd = new THREE.Vector3(-0.25, 1.2, -0.45);
  const target = new THREE.Vector3(0, 1.4, -1.6);
  const rates = [
    { name: '17 fps', frameMs: 58 },
    { name: '29 fps', frameMs: 34 },
  ];

  test('the recorded 17 fps slash-then-slow-drift trace is one stroke, not two (F5b)', () => {
    // Hilt's out-drift.json: right-hand world positions from the game at about
    // 17 fps. The slash ends at 601 ms; the hand then drifts back at a true
    // 0.55-0.65 m/s, which the old clock read as 1.0-1.3 m/s and swung again.
    const trace: readonly (readonly [number, number, number, number])[] = [
      [0, -2.748, 16.266, 4.776], [57, -2.748, 16.266, 4.776], [110, -2.748, 16.266, 4.776], [164, -2.748, 16.266, 4.776],
      [220, -2.748, 16.266, 4.776], [276, -2.748, 16.266, 4.776], [329, -2.748, 16.266, 4.776], [382, -2.748, 16.266, 4.776],
      [434, -2.748, 16.266, 4.776], [495, -2.529, 16.445, 4.72], [548, -2.529, 16.445, 4.72], [601, -2.246, 16.666, 4.657],
      [657, -2.246, 16.666, 4.657], [722, -2.212, 16.692, 4.65], [781, -2.212, 16.692, 4.65], [836, -2.212, 16.692, 4.65],
      [894, -2.212, 16.692, 4.65], [948, -2.212, 16.692, 4.65], [999, -2.212, 16.692, 4.65], [1061, -2.212, 16.692, 4.65],
      [1119, -2.212, 16.692, 4.65], [1183, -2.212, 16.692, 4.65], [1242, -2.22, 16.686, 4.652], [1306, -2.22, 16.686, 4.652],
      [1372, -2.247, 16.665, 4.658], [1439, -2.247, 16.665, 4.658], [1501, -2.29, 16.632, 4.666], [1561, -2.29, 16.632, 4.666],
      [1624, -2.338, 16.594, 4.677], [1683, -2.338, 16.594, 4.677], [1748, -2.395, 16.55, 4.689], [1815, -2.395, 16.55, 4.689],
      [1882, -2.463, 16.497, 4.705], [1942, -2.463, 16.497, 4.705], [2010, -2.524, 16.449, 4.719], [2075, -2.524, 16.449, 4.719],
      [2146, -2.593, 16.394, 4.736], [2210, -2.593, 16.394, 4.736], [2275, -2.647, 16.35, 4.75], [2343, -2.647, 16.35, 4.75],
      [2408, -2.695, 16.31, 4.762], [2474, -2.695, 16.31, 4.762], [2541, -2.729, 16.282, 4.771], [2609, -2.729, 16.282, 4.771],
      [2683, -2.747, 16.267, 4.775], [2758, -2.747, 16.267, 4.775], [2833, -2.748, 16.266, 4.776], [2903, -2.748, 16.266, 4.776],
      [2983, -2.748, 16.266, 4.776], [3061, -2.748, 16.266, 4.776], [3149, -2.748, 16.266, 4.776], [3223, -2.748, 16.266, 4.776],
      [3294, -2.748, 16.266, 4.776], [3362, -2.748, 16.266, 4.776], [3442, -2.748, 16.266, 4.776], [3512, -2.748, 16.266, 4.776],
      [3581, -2.748, 16.266, 4.776], [3648, -2.748, 16.266, 4.776],
    ];
    const controller = new VRCombatInputController({ minimumFastSamples: 2 });
    const events: number[] = [];
    for (const [t, x, y, z] of trace) {
      const position = new THREE.Vector3(x, y, z);
      if (controller.process(posedFrame(t, position, new THREE.Quaternion()), context('melee-one-handed', t)).length) events.push(t);
    }
    expect(events).toEqual([601]);
  });

  for (const { name, frameMs } of rates) {
    test.each([450, 550, 650])(`${name}: a slash with a natural %i ms return to guard is one stroke (F4)`, (returnMs) => {
      const events = play([
        { to: slashEnd, ms: 260 }, { to: slashEnd, ms: 350 }, { to: guard, ms: returnMs },
      ], { frameMs });
      expect(events).toHaveLength(1);
    });

    test(`${name}: ten single strokes with a return to guard are ten strokes (F4)`, () => {
      const segments: Segment[] = [];
      for (let i = 0; i < 10; i++) {
        segments.push({ to: slashEnd, ms: 260 }, { to: slashEnd, ms: 350 }, { to: guard, ms: 450 }, { to: guard, ms: 2340 });
      }
      expect(play(segments, { frameMs })).toHaveLength(10);
    });

    test(`${name}: a forehand then a backhand 150 ms later are two strokes`, () => {
      expect(play([{ to: slashEnd, ms: 260 }, { to: slashEnd, ms: 150 }, { to: guard, ms: 260 }], { frameMs })).toHaveLength(2);
    });

    test(`${name}: a slash, a 700 ms hold and a hard backhand are two strokes (F5a)`, () => {
      expect(play([{ to: slashEnd, ms: 260 }, { to: slashEnd, ms: 700 }, { to: guard, ms: 260 }], { frameMs })).toHaveLength(2);
    });

    test(`${name}: a slash then a slow 1.6 s drift back to guard is one stroke (F5b)`, () => {
      expect(play([{ to: slashEnd, ms: 260 }, { to: slashEnd, ms: 300 }, { to: guard, ms: 1600 }], { frameMs })).toHaveLength(1);
    });

    test(`${name}: a wrist-led stroke counts: 10 cm of hand, 100 degrees of blade (finding 5)`, () => {
      const start = new THREE.Vector3(0.15, 1.35, -0.3);
      const end = new THREE.Vector3(0.06, 1.3, -0.36);
      const events = play([{ to: end, aim: new THREE.Vector3(-0.85, -0.1, -0.5), ms: 220 }], {
        frameMs, start, startAim: new THREE.Vector3(0.85, 0.2, -0.5),
      });
      expect(events).toHaveLength(1);
    });

    test(`${name}: a wrist flick out and back never counts: 3 cm of hand, 70 degrees of blade (F6)`, () => {
      const start = new THREE.Vector3(0.05, 1.35, -0.3);
      const out = new THREE.Vector3(0.02, 1.35, -0.31);
      const rest = new THREE.Vector3(0.3, 0.2, -1);
      const flicked = new THREE.Vector3(-0.8, 0, -0.6);
      let events = 0;
      for (let k = 0; k < 4; k++) {
        events += play([
          { to: out, aim: flicked, ms: 90 }, { to: start, aim: rest, ms: 110 },
        ], { frameMs, start, startAim: rest, phaseMs: k * 13 }).length;
      }
      expect(events).toBe(0);
    });

    test(`${name}: a 10 cm pop forward and back, or an 8 cm jab, never counts (F6)`, () => {
      const start = new THREE.Vector3(0.05, 1.35, -0.3);
      let events = 0;
      for (let k = 0; k < 4; k++) {
        events += play([
          { to: new THREE.Vector3(0.05, 1.35, -0.4), ms: 70 }, { to: start, ms: 70 },
        ], { frameMs, start, phaseMs: k * 13 }).length;
        events += play([
          { to: new THREE.Vector3(0.05, 1.35, -0.38), ms: 80 }, { to: new THREE.Vector3(0.05, 1.35, -0.38), ms: 400 },
        ], { frameMs, start, phaseMs: k * 13 }).length;
      }
      expect(events).toBe(0);
    });
  }

  interface Segment {
    readonly to: THREE.Vector3;
    /** Blade direction at the end of the segment; omitted, the blade points at the target. */
    readonly aim?: THREE.Vector3;
    readonly ms: number;
  }

  /**
   * Plays a scripted right-hand motion through a game-configured controller
   * (smoothstep per segment), sampled every `frameMs` with every third frame
   * repeating the previous pose, and returns the times of swing events.
   */
  function play(segments: readonly Segment[], options: {
    readonly frameMs: number;
    readonly start?: THREE.Vector3;
    readonly startAim?: THREE.Vector3;
    readonly phaseMs?: number;
  }): number[] {
    const controller = new VRCombatInputController({ minimumFastSamples: 2 });
    const aimAt = (position: THREE.Vector3, aim?: THREE.Vector3) =>
      (aim ? aim.clone() : target.clone().sub(position)).normalize();
    const keys: { t: number; position: THREE.Vector3; aim: THREE.Vector3 }[] = [];
    const start = options.start ?? guard;
    let t = 600;
    keys.push({ t, position: start.clone(), aim: aimAt(start, options.startAim) });
    for (const segment of segments) {
      t += segment.ms;
      keys.push({ t, position: segment.to.clone(), aim: aimAt(segment.to, segment.aim) });
    }
    const end = t + 1200;
    const events: number[] = [];
    let previous: XRInputFrame | null = null;
    for (let frameIndex = 0, now = options.phaseMs ?? 0; now <= end; frameIndex++, now += options.frameMs) {
      let current: XRInputFrame;
      if (previous && frameIndex % 3 === 2) {
        current = { ...previous, timestamp: now };
      } else {
        let k = 0;
        while (k < keys.length - 1 && keys[k + 1].t < now) k++;
        const a = keys[k];
        const b = keys[Math.min(k + 1, keys.length - 1)];
        const raw = b.t > a.t ? Math.min(1, Math.max(0, (now - a.t) / (b.t - a.t))) : 1;
        const s = raw * raw * (3 - 2 * raw);
        const position = a.position.clone().lerp(b.position, s);
        const forward = new THREE.Vector3(0, 0, -1);
        const qa = new THREE.Quaternion().setFromUnitVectors(forward, a.aim);
        const qb = new THREE.Quaternion().setFromUnitVectors(forward, b.aim);
        current = posedFrame(now, position, qa.slerp(qb, s));
      }
      previous = current;
      if (controller.process(current, context('melee-one-handed', now)).length) events.push(now);
    }
    return events;
  }
});

function posedFrame(timestamp: number, position: THREE.Vector3, orientation: THREE.Quaternion): XRInputFrame {
  const pose = (): XRWorldPose => ({
    position: position.clone(),
    orientation: orientation.clone(),
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  });
  return {
    timestamp,
    head: { ...pose(), position: new THREE.Vector3(0, 1.7, 0), orientation: new THREE.Quaternion() },
    hands: {
      right: {
        hand: 'right', pose: pose(),
        targetRayPose: pose(), buttons: {}, axes: [], interactionProfile: 'oculus-touch-v3',
      },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}
