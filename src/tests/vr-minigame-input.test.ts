import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import {
  aimDirectionToPitchYaw, DEFAULT_MINIGAME_INPUT_CONFIGURATION, MiniGameGripState,
  resolveSteering, resolveSwoopIntent, resolveTurretIntent,
} from '@/vr/runtime/VRMiniGameInputPolicy';
import { XRHandInputFrame, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

/**
 * VR input for the swoop and turret, against the decisions taken for it:
 * two-handed handlebars and grips, hold-squeeze to hold on, and either hand
 * alone still steers or aims so a seated player is never stranded. Comfort is
 * deliberately untouched — the player's existing settings apply.
 */
const button = (value: number) => ({ pressed: value >= 0.5, touched: value > 0, value });

function hand(options: {
  hand: 'left' | 'right'; x?: number; y?: number; z?: number;
  squeeze?: number; trigger?: number; orientation?: THREE.Quaternion;
}): XRHandInputFrame {
  const pose: XRWorldPose = {
    position: new THREE.Vector3(options.x ?? 0, options.y ?? 1.2, options.z ?? -0.3),
    orientation: options.orientation ?? new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  };
  return {
    hand: options.hand, pose, targetRayPose: pose,
    buttons: { squeeze: button(options.squeeze ?? 0), trigger: button(options.trigger ?? 0) },
    axes: [], interactionProfile: null,
  };
}

function frame(hands: XRHandInputFrame[]): XRInputFrame {
  const map: Record<string, XRHandInputFrame> = {};
  for (const h of hands) map[h.hand] = h;
  return {
    timestamp: 0,
    head: {
      position: new THREE.Vector3(0, 1.6, 0), orientation: new THREE.Quaternion(),
      linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
    } as XRWorldPose,
    hands: map as never,
    activeInteractionProfiles: [],
  };
}

const config = DEFAULT_MINIGAME_INPUT_CONFIGURATION;

describe('holding on', () => {
  test('a hand only counts while its squeeze is held', () => {
    const loose = resolveSteering(frame([hand({ hand: 'left' }), hand({ hand: 'right' })]), config);
    expect(loose.grip).toBe(MiniGameGripState.NONE);
    expect(loose.steer).toBe(0);

    const both = resolveSteering(frame([
      hand({ hand: 'left', squeeze: 1 }), hand({ hand: 'right', squeeze: 1 }),
    ]), config);
    expect(both.grip).toBe(MiniGameGripState.TWO_HANDED);
  });

  test('one hand is enough to stay in control', () => {
    const single = resolveSteering(frame([
      hand({ hand: 'right', squeeze: 1, x: 0.4 }), hand({ hand: 'left' }),
    ]), config);
    expect(single.grip).toBe(MiniGameGripState.ONE_HANDED);
    expect(single.steer).toBeGreaterThan(0);
  });
});

describe('swoop steering', () => {
  test('level bars do not steer', () => {
    const level = resolveSteering(frame([
      hand({ hand: 'left', squeeze: 1, y: 1.2 }), hand({ hand: 'right', squeeze: 1, y: 1.2 }),
    ]), config);
    expect(level.steer).toBe(0);
  });

  test('rolling the bars steers, and further is more', () => {
    const slight = resolveSteering(frame([
      hand({ hand: 'left', squeeze: 1, y: 1.14 }), hand({ hand: 'right', squeeze: 1, y: 1.26 }),
    ]), config).steer;
    const hard = resolveSteering(frame([
      hand({ hand: 'left', squeeze: 1, y: 1.0 }), hand({ hand: 'right', squeeze: 1, y: 1.4 }),
    ]), config).steer;
    expect(slight).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(slight);
    expect(hard).toBeLessThanOrEqual(1);
  });

  test('rolling the other way steers the other way, symmetrically', () => {
    const left = resolveSteering(frame([
      hand({ hand: 'left', squeeze: 1, y: 1.4 }), hand({ hand: 'right', squeeze: 1, y: 1.0 }),
    ]), config).steer;
    const right = resolveSteering(frame([
      hand({ hand: 'left', squeeze: 1, y: 1.0 }), hand({ hand: 'right', squeeze: 1, y: 1.4 }),
    ]), config).steer;
    expect(left).toBeCloseTo(-right, 5);
  });

  test('a small wobble inside the deadzone is ignored', () => {
    const wobble = resolveSteering(frame([
      hand({ hand: 'left', squeeze: 1, y: 1.2 }), hand({ hand: 'right', squeeze: 1, y: 1.201 }),
    ]), config).steer;
    expect(wobble).toBe(0);
  });

  test('jump fires on the press, not while the trigger is held', () => {
    const held = frame([hand({ hand: 'right', squeeze: 1, trigger: 1 })]);
    expect(resolveSwoopIntent(held, false, config).jump).toBe(true);
    expect(resolveSwoopIntent(held, true, config).jump).toBe(false);
  });
});

describe('turret aim', () => {
  test('not holding on means no aim and no fire', () => {
    const intent = resolveTurretIntent(frame([hand({ hand: 'right', trigger: 1 })]), config);
    expect(intent.grip).toBe(MiniGameGripState.NONE);
    expect(intent.aimDirection).toBeNull();
    expect(intent.fire).toBe(false);
  });

  test('both grips aim between the hands', () => {
    const left = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4);
    const right = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -0.4);
    const intent = resolveTurretIntent(frame([
      hand({ hand: 'left', squeeze: 1, orientation: left }),
      hand({ hand: 'right', squeeze: 1, orientation: right }),
    ]), config);
    expect(intent.grip).toBe(MiniGameGripState.TWO_HANDED);
    // Equal and opposite yaw averages back to straight ahead.
    expect(intent.aimDirection!.x).toBeCloseTo(0, 5);
    expect(intent.aimDirection!.z).toBeCloseTo(-1, 5);
  });

  test('one grip aims along that hand', () => {
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const intent = resolveTurretIntent(frame([
      hand({ hand: 'right', squeeze: 1, orientation: turned }),
    ]), config);
    expect(intent.grip).toBe(MiniGameGripState.ONE_HANDED);
    expect(intent.aimDirection!.x).toBeCloseTo(-1, 5);
  });

  test('the trigger fires while held, since the gun bank rate-limits itself', () => {
    const intent = resolveTurretIntent(frame([
      hand({ hand: 'right', squeeze: 1, trigger: 1 }),
    ]), config);
    expect(intent.fire).toBe(true);
  });

  test('aim direction converts to the pitch and yaw the turret rotates on', () => {
    expect(aimDirectionToPitchYaw(new THREE.Vector3(0, 0, -1)).yaw).toBeCloseTo(0, 5);
    expect(aimDirectionToPitchYaw(new THREE.Vector3(1, 0, 0)).yaw).toBeCloseTo(Math.PI / 2, 5);
    expect(aimDirectionToPitchYaw(new THREE.Vector3(0, 1, 0)).pitch).toBeCloseTo(Math.PI / 2, 5);
  });
});
