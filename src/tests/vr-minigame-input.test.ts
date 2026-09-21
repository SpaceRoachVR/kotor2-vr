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
/**
 * Buttons are keyed by gamepad index as a string, exactly as
 * XRInputFrameBuilder.readButtons writes them and XRInputRouter reads them.
 *
 * These fixtures previously used names ('squeeze', 'trigger'). No such key is
 * ever present on a real frame, so every read in the policy returned 0 — the
 * grip never closed and the throttle never opened — while this suite passed,
 * because it was asserting against the same invention. Index order is the
 * xr-standard mapping: 0 trigger, 1 squeeze, 2 touchpad, 3 thumbstick.
 */
const XR_TRIGGER = '0';
const XR_SQUEEZE = '1';
const button = (value: number) => ({ pressed: value >= 0.5, touched: value > 0, value });

function hand(options: {
  hand: 'left' | 'right'; x?: number; y?: number; z?: number;
  squeeze?: number; trigger?: number; orientation?: THREE.Quaternion;
  /** Thumbstick Y, in WebXR's sign: forward is negative. */
  stickY?: number;
}): XRHandInputFrame {
  const pose: XRWorldPose = {
    position: new THREE.Vector3(options.x ?? 0, options.y ?? 1.2, options.z ?? -0.3),
    orientation: options.orientation ?? new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  };
  return {
    hand: options.hand, pose, targetRayPose: pose,
    buttons: { [XR_TRIGGER]: button(options.trigger ?? 0), [XR_SQUEEZE]: button(options.squeeze ?? 0) },
    axes: [0, 0, 0, options.stickY ?? 0], interactionProfile: null,
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

/**
 * The swoop asks nothing of the hands but that they be tracked. A rider is
 * strapped to a vehicle, not holding an object they might drop, so requiring a
 * squeeze only created a state where the controls silently did nothing. The
 * turret keeps its squeeze: that is a deliberate grip on a mounted weapon.
 */
describe('riding the swoop', () => {
  test('tracked hands steer with no squeeze at all', () => {
    const both = resolveSteering(frame([
      hand({ hand: 'left', y: 1.0 }), hand({ hand: 'right', y: 1.4 }),
    ]), config);
    expect(both.grip).toBe(MiniGameGripState.TWO_HANDED);
    expect(both.steer).toBeGreaterThan(0);
  });

  test('one tracked hand is enough to stay in control', () => {
    const single = resolveSteering(frame([hand({ hand: 'right', x: 0.4 })]), config);
    expect(single.grip).toBe(MiniGameGripState.ONE_HANDED);
    expect(single.steer).toBeGreaterThan(0);
  });

  test('no tracked hands means no control', () => {
    const none = resolveSteering(frame([]), config);
    expect(none.grip).toBe(MiniGameGripState.NONE);
    expect(none.steer).toBe(0);
  });
});

describe('the turret still wants a deliberate grip', () => {
  test('an ungripped hand does not aim', () => {
    const loose = resolveTurretIntent(frame([
      hand({ hand: 'left' }), hand({ hand: 'right' }),
    ]), config);
    expect(loose.grip).toBe(MiniGameGripState.NONE);
    expect(loose.aimDirection).toBeNull();
  });

  test('squeezing both grips aims', () => {
    const held = resolveTurretIntent(frame([
      hand({ hand: 'left', squeeze: 1 }), hand({ hand: 'right', squeeze: 1 }),
    ]), config);
    expect(held.grip).toBe(MiniGameGripState.TWO_HANDED);
    expect(held.aimDirection).not.toBeNull();
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

  test('the left trigger jumps on the press, not while it is held', () => {
    const held = frame([
      hand({ hand: 'left', squeeze: 1, trigger: 1 }), hand({ hand: 'right', squeeze: 1 }),
    ]);
    expect(resolveSwoopIntent(held, false, config).jump).toBe(true);
    expect(resolveSwoopIntent(held, true, config).jump).toBe(false);
  });
});

/**
 * The throttle is a gear shift the OnAccelerate script guards by speed, so it is
 * held rather than tapped — holding it is how the bike climbs through its gears,
 * the same as holding the accelerate key on flatscreen.
 */
describe('swoop throttle', () => {
  const bars = (right: number, left = 0) => frame([
    hand({ hand: 'left', trigger: left }),
    hand({ hand: 'right', trigger: right }),
  ]);

  test('the right trigger is the throttle, and holding it keeps it on', () => {
    expect(resolveSwoopIntent(bars(1), false, config).throttle).toBe(true);
    expect(resolveSwoopIntent(bars(1), true, config).throttle).toBe(true);
  });

  test('no right trigger, no throttle', () => {
    expect(resolveSwoopIntent(bars(0), false, config).throttle).toBe(false);
  });

  test('the left trigger jumps without opening the throttle', () => {
    const intent = resolveSwoopIntent(bars(0, 1), false, config);
    expect(intent.jump).toBe(true);
    expect(intent.throttle).toBe(false);
  });

  test('both at once: throttle held while jumping', () => {
    const intent = resolveSwoopIntent(bars(1, 1), false, config);
    expect(intent.throttle).toBe(true);
    expect(intent.jump).toBe(true);
  });

  test('no tracked hands means no throttle', () => {
    const intent = resolveSwoopIntent(frame([]), false, config);
    expect(intent.grip).toBe(MiniGameGripState.NONE);
    expect(intent.throttle).toBe(false);
  });
});

/**
 * A rider who cannot accelerate cannot race, so the one hand that is holding on
 * keeps the throttle; the jump moves to that hand's thumbstick.
 */
describe('one-handed swoop', () => {
  test('the single trigger becomes the throttle, left hand or right', () => {
    for (const role of ['left', 'right'] as const) {
      const intent = resolveSwoopIntent(
        frame([hand({ hand: role, squeeze: 1, trigger: 1 })]), false, config);
      expect(intent.grip).toBe(MiniGameGripState.ONE_HANDED);
      expect(intent.throttle).toBe(true);
    }
  });

  test('pushing that hand’s stick forward jumps, on the push only', () => {
    const pushed = frame([hand({ hand: 'left', squeeze: 1, stickY: -1 })]);
    expect(resolveSwoopIntent(pushed, false, config).jump).toBe(true);
    expect(resolveSwoopIntent(pushed, true, config).jump).toBe(false);
  });

  test('a stick at rest does not jump', () => {
    const resting = frame([hand({ hand: 'left', squeeze: 1, stickY: 0 })]);
    expect(resolveSwoopIntent(resting, false, config).jump).toBe(false);
  });

  test('pulling the stick back does not jump', () => {
    const pulled = frame([hand({ hand: 'left', squeeze: 1, stickY: 1 })]);
    expect(resolveSwoopIntent(pulled, false, config).jump).toBe(false);
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
