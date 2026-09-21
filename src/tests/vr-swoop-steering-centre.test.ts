import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import {
  DEFAULT_MINIGAME_INPUT_CONFIGURATION, LEVEL_NEUTRAL, MiniGameGripState,
  resolveSteering, resolveSwoopIntent, sampleSwoopNeutral, swoopJumpControlHeld,
} from '@/vr/runtime/VRMiniGameInputPolicy';
import {
  attachSwoopGrips, buildSwoopGrips, detachSwoopGrips, SWOOP_GRIP_GROUP_NAME, SWOOP_GRIP_OFFSETS,
} from '@/vr/runtime/VRMiniGameGripHost';
import { XRHandInputFrame, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

const XR_TRIGGER = '0';
const XR_SQUEEZE = '1';
const XR_FACE = '4';
const button = (value: number) => ({ pressed: value >= 0.5, touched: value > 0, value });

function hand(options: {
  hand: 'left' | 'right'; x?: number; y?: number;
  trigger?: number; squeeze?: number; face?: number; stickY?: number;
}): XRHandInputFrame {
  const pose: XRWorldPose = {
    position: new THREE.Vector3(options.x ?? 0, options.y ?? 1.2, -0.3),
    orientation: new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  };
  return {
    hand: options.hand, pose, targetRayPose: pose,
    buttons: {
      [XR_TRIGGER]: button(options.trigger ?? 0),
      [XR_SQUEEZE]: button(options.squeeze ?? 0),
      [XR_FACE]: button(options.face ?? 0),
    },
    axes: [0, 0, 0, options.stickY ?? 0], interactionProfile: null,
  };
}

function frame(hands: XRHandInputFrame[], timestamp = 0): XRInputFrame {
  const map: Record<string, XRHandInputFrame> = {};
  for (const h of hands) map[h.hand] = h;
  return {
    timestamp,
    head: {
      position: new THREE.Vector3(0, 1.6, 0), orientation: new THREE.Quaternion(),
      linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
    } as XRWorldPose,
    hands: map as never,
    activeInteractionProfiles: [],
  };
}

const config = DEFAULT_MINIGAME_INPUT_CONFIGURATION;

/**
 * Reported from the headset: the bike "tends to fade to the right and has a
 * hard time manoeuvring left". Steering measured against dead level, which
 * assumes the rider holds both hands at exactly the same height — so whatever
 * bias their real posture has becomes a permanent pull that must be fought.
 */
describe('straight ahead is where the rider is holding, not dead level', () => {
  test('a rider whose right hand rests higher is not steering', () => {
    const resting = frame([
      hand({ hand: 'left', y: 1.15 }), hand({ hand: 'right', y: 1.27 }),
    ]);
    // Against dead level that 12cm bias is a hard pull.
    expect(Math.abs(resolveSteering(resting, config, LEVEL_NEUTRAL).steer)).toBeGreaterThan(0.4);

    const neutral = sampleSwoopNeutral(resting);
    expect(neutral).not.toBeNull();
    expect(resolveSteering(resting, config, neutral!).steer).toBe(0);
  });

  test('from that neutral, both directions are reachable and symmetric', () => {
    const resting = frame([hand({ hand: 'left', y: 1.15 }), hand({ hand: 'right', y: 1.27 })]);
    const neutral = sampleSwoopNeutral(resting)!;
    const right = resolveSteering(frame([
      hand({ hand: 'left', y: 1.05 }), hand({ hand: 'right', y: 1.37 }),
    ]), config, neutral).steer;
    const left = resolveSteering(frame([
      hand({ hand: 'left', y: 1.25 }), hand({ hand: 'right', y: 1.17 }),
    ]), config, neutral).steer;
    expect(right).toBeGreaterThan(0);
    expect(left).toBeLessThan(0);
    expect(right).toBeCloseTo(-left, 5);
  });

  test('one-handed neutral is that hand\u2019s own resting offset from the head', () => {
    const resting = frame([hand({ hand: 'right', x: 0.3 })]);
    expect(Math.abs(resolveSteering(resting, config, LEVEL_NEUTRAL).steer)).toBeGreaterThan(0);
    const neutral = sampleSwoopNeutral(resting)!;
    expect(resolveSteering(resting, config, neutral).steer).toBe(0);
  });

  test('no hands define no neutral', () => {
    expect(sampleSwoopNeutral(frame([]))).toBeNull();
  });
});

/**
 * The left controller leaves the input frame whenever its grip pose goes
 * briefly untracked — observed live, with both controllers powered and
 * `session.inputSources` reporting two sources while the frame carried only
 * `right`. Falling straight to one-handed steering then reads the right hand's
 * offset from the head, which is the reported rightward pull.
 */
describe('a jump is always reachable', () => {
  test('a face button jumps from either hand', () => {
    for (const role of ['left', 'right'] as const) {
      expect(swoopJumpControlHeld(frame([hand({ hand: role, face: 1 })]), config)).toBe(true);
    }
  });

  test('the left trigger still jumps when both hands are present', () => {
    expect(swoopJumpControlHeld(frame([
      hand({ hand: 'left', trigger: 1 }), hand({ hand: 'right' }),
    ]), config)).toBe(true);
  });

  test('the right hand alone can still jump, which the left trigger could not', () => {
    const rightOnly = frame([hand({ hand: 'right', face: 1 })]);
    expect(swoopJumpControlHeld(rightOnly, config)).toBe(true);
    expect(resolveSwoopIntent(rightOnly, false, config).jump).toBe(true);
  });

  test('throttle and jump are independent controls', () => {
    const both = frame([hand({ hand: 'right', trigger: 1, face: 1 })]);
    const intent = resolveSwoopIntent(both, false, config);
    expect(intent.throttle).toBe(true);
    expect(intent.jump).toBe(true);
  });

  test('no tracked hand jumps nothing', () => {
    expect(swoopJumpControlHeld(frame([]), config)).toBe(false);
  });
});

/**
 * The bike ships no handle: every one of v_supertrike01's 340 nodes was
 * searched and nothing is named for a bar, grip or handle. The rider is a
 * single baked mesh whose hands are modelled in place.
 */
describe('the swoop gets visible grips to hold', () => {
  test('two grips, placed where the bike\u2019s own rider holds', () => {
    const grips = buildSwoopGrips();
    expect(grips.children).toHaveLength(2);
    expect(SWOOP_GRIP_OFFSETS).toHaveLength(2);
    const [left, right] = SWOOP_GRIP_OFFSETS;
    expect(left[0]).toBeCloseTo(-right[0], 5);
    expect(left[1]).toBe(right[1]);
    expect(left[2]).toBe(right[2]);
  });

  test('attaching twice does not stack a second set', () => {
    const bike = new THREE.Object3D();
    attachSwoopGrips(bike);
    attachSwoopGrips(bike);
    expect(bike.children.filter((c) => c.name === SWOOP_GRIP_GROUP_NAME)).toHaveLength(1);
  });

  test('leaving the minigame leaves the bike as it was', () => {
    const bike = new THREE.Object3D();
    attachSwoopGrips(bike);
    detachSwoopGrips(bike);
    expect(bike.getObjectByName(SWOOP_GRIP_GROUP_NAME)).toBeUndefined();
  });

  test('a missing bike is not an error', () => {
    expect(attachSwoopGrips(null)).toBeNull();
    expect(() => detachSwoopGrips(undefined)).not.toThrow();
  });
});
