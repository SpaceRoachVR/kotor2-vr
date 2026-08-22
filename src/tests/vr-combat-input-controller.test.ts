import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { VRCombatInputController } from '@/vr/runtime/VRCombatInputController';
import { CombatWeaponMode, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRCombatInputController', () => {
  test('emits every saber swing but only makes an on-tempo swing roll eligible', () => {
    const controller = new VRCombatInputController({
      minimumSwingSpeedMetresPerSecond: 0.8,
      visualSwingCooldownMilliseconds: 100,
      rollCooldownMilliseconds: 2_000,
    });

    expect(controller.process(frame(0, 0), context('melee-one-handed', 0))).toEqual([]);
    const firstSwing = controller.process(frame(160, -0.3), context('melee-one-handed', 160));
    const secondSwing = controller.process(frame(320, 0), context('melee-one-handed', 320));

    expect(firstSwing).toEqual([expect.objectContaining({ rollEligible: true, weaponMode: 'melee-one-handed' })]);
    expect(secondSwing).toEqual([expect.objectContaining({ rollEligible: false, weaponMode: 'melee-one-handed' })]);
  });

  test('promotes to two-handed only when both hands are actually on the hilt', () => {
    // ROADMAP 3.3. The grip button alone is not a two-handed grip: the off hand
    // has to be tracked and close enough to be holding the same weapon.
    const controller = new VRCombatInputController({ minimumSwingSpeedMetresPerSecond: 0.8 });
    const nearHilt = (y: number) => new THREE.Vector3(0, y, -0.55);

    controller.process(frame(0, 0, nearHilt(0)), context('melee-one-handed', 0, true));
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
    const swing = controller.process(
      // Off hand swings across; dominant hand has not moved at all.
      frame(120, rearHandY, new THREE.Vector3(0.15, 0, -0.4)),
      context('melee-one-handed', 120, true),
    );

    expect(swing).toHaveLength(1);
    expect(swing[0]).toMatchObject({ weaponMode: 'melee-two-handed' });
    expect(swing[0].speedMetresPerSecond).toBeGreaterThan(0.8);
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

  test('fires a blaster once per weapon-action press edge without bypassing the d20 path', () => {
    const controller = new VRCombatInputController();

    expect(controller.process(frame(0, 0), context('blaster', 0, false, false))).toEqual([]);
    expect(controller.process(frame(10, 0), context('blaster', 10, false, true)))
      .toEqual([expect.objectContaining({ weaponMode: 'blaster', rollEligible: true })]);
    expect(controller.process(frame(20, 0), context('blaster', 20, false, true))).toEqual([]);
  });

  test('emits every blaster trigger pull but only makes an on-tempo pull roll eligible', () => {
    const controller = new VRCombatInputController({
      minimumSwingSpeedMetresPerSecond: 0.8,
      visualSwingCooldownMilliseconds: 100,
      rollCooldownMilliseconds: 2_000,
    });

    // Rising edge #1: within the first cooldown window, so it rolls.
    const firstShot = controller.process(frame(0, 0), context('blaster', 0, false, true));
    expect(firstShot).toEqual([expect.objectContaining({ weaponMode: 'blaster', rollEligible: true })]);

    // Release, then a second rising edge before the roll cooldown elapses:
    // the shot still fires visually but must not roll a second time.
    controller.process(frame(50, 0), context('blaster', 50, false, false));
    const secondShot = controller.process(frame(100, 0), context('blaster', 100, false, true));
    expect(secondShot).toEqual([expect.objectContaining({ weaponMode: 'blaster', rollEligible: false })]);

    // Release, then a third rising edge after the roll cooldown elapses: rolls again.
    controller.process(frame(150, 0), context('blaster', 150, false, false));
    const thirdShot = controller.process(frame(2_100, 0), context('blaster', 2_100, false, true));
    expect(thirdShot).toEqual([expect.objectContaining({ weaponMode: 'blaster', rollEligible: true })]);
  });

  test('reports roll readiness for the diegetic hilt timer', () => {
    const controller = new VRCombatInputController({
      minimumSwingSpeedMetresPerSecond: 0.8,
      visualSwingCooldownMilliseconds: 100,
      rollCooldownMilliseconds: 2_000,
    });

    // Never swung yet — ready.
    expect(controller.getRollReadiness(0)).toBe(1);

    controller.process(frame(0, 0), context('melee-one-handed', 0));
    controller.process(frame(160, -0.3), context('melee-one-handed', 160));

    expect(controller.getRollReadiness(160)).toBeCloseTo(0);
    expect(controller.getRollReadiness(1_160)).toBeCloseTo(0.5);
    expect(controller.getRollReadiness(2_160)).toBe(1);
  });

  test('rejects a non-finite readiness timestamp', () => {
    const controller = new VRCombatInputController();
    expect(() => controller.getRollReadiness(Number.NaN)).toThrow(TypeError);
  });
});

function context(
  weaponMode: CombatWeaponMode,
  timestamp: number,
  offhandGrip = false,
  weaponActionPressed = false
) {
  return {
    actorId: '7',
    nominatedTargetId: '42',
    weaponMode,
    timestamp,
    offhandGrip,
    weaponActionPressed,
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
