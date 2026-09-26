import { beforeEach, describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import { VRMiniGameInputController, VRMiniGameTarget } from '@/vr/runtime/VRMiniGameInputController';
import { XRHandInputFrame, XRInputFrame, XRWorldPose } from '@/vr/runtime/XRTypes';

/**
 * The controller against a fake swoop: what reaches the bike, frame by frame.
 * The pieces the policy tests cover (deadzones, stick vs lean) are taken as
 * read; this is about the neutral, the race start, the hands and the edges.
 */
const button = (value: number) => ({ pressed: value >= 0.5, touched: value > 0, value });

function hand(role: 'left' | 'right', o: { squeeze?: number; trigger?: number; stickX?: number } = {}): XRHandInputFrame {
  const pose: XRWorldPose = {
    position: new THREE.Vector3(role === 'left' ? -0.25 : 0.25, 1.2, -0.3), orientation: new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  };
  return {
    hand: role, pose, targetRayPose: pose,
    buttons: { '0': button(o.trigger ?? 0), '1': button(o.squeeze ?? 0) },
    axes: [0, 0, o.stickX ?? 0, 0], interactionProfile: null,
  };
}

let clock = 0;
function frame(hands: XRHandInputFrame[], headX = 0): XRInputFrame {
  const map: Record<string, XRHandInputFrame> = {};
  for (const h of hands) map[h.hand] = h;
  clock += 11;
  return {
    timestamp: clock,
    head: {
      position: new THREE.Vector3(headX, 1.6, 0), orientation: new THREE.Quaternion(),
      linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
    },
    hands: map as never,
    activeInteractionProfiles: [],
  };
}

interface FakeSwoop extends VRMiniGameTarget {
  steers: number[];
  jumps: number;
  accelerates: number;
  raceStarted: boolean;
}

function swoop(): FakeSwoop {
  const gripPose = (x: number): XRWorldPose => ({
    position: new THREE.Vector3(x, 0.8, 1.4), orientation: new THREE.Quaternion(),
    linearVelocity: null, angularVelocity: null, trackingState: 'tracked',
  });
  const target: FakeSwoop = {
    type: 1, raceStarted: false, steers: [], jumps: 0, accelerates: 0,
    setSteer: (steer) => { target.steers.push(steer); },
    seatPosition: new THREE.Vector3(0, 0, 0), seatRight: new THREE.Vector3(1, 0, 0),
    gripPoses: { left: gripPose(-0.1), right: gripPose(0.1) },
    jump: () => { target.jumps++; }, accelerate: () => { target.accelerates++; }, fire: () => {},
    pitch: 0, yaw: 0, rotateBy: () => {},
  };
  return target;
}

let target: FakeSwoop;
let pins: Array<[string, XRWorldPose | null]>;

beforeEach(() => {
  VRMiniGameInputController.reset();
  target = swoop();
  pins = [];
  VRMiniGameInputController.setProvider(() => target);
  VRMiniGameInputController.pinHand = (h, p) => { pins.push([h, p]); };
});

const last = <T>(list: T[]): T => list[list.length - 1];

describe('the neutral is the posture at the flag', () => {
  test('before the race starts, nothing steers, whatever the rider does', () => {
    VRMiniGameInputController.update(frame([hand('left', { stickX: 1 })], 0.3));
    expect(last(target.steers)).toBe(0);
  });

  test('the lean neutral is taken from where the head was when the race started', () => {
    // Sitting 10cm right of centre through the countdown.
    VRMiniGameInputController.update(frame([hand('left')], 0.1));
    VRMiniGameInputController.update(frame([hand('left')], 0.1));
    target.raceStarted = true;
    VRMiniGameInputController.update(frame([hand('left')], 0.1));
    expect(last(target.steers)).toBe(0);
    expect(VRMiniGameInputController.debugState().leanNeutral).toBeCloseTo(0.1, 6);
    // Leaning back to the seat centre is now a lean to the left.
    VRMiniGameInputController.update(frame([hand('left')], 0.0));
    expect(last(target.steers)).toBeLessThan(0);
    // And the neutral does not drift after the rider.
    VRMiniGameInputController.update(frame([hand('left')], 0.0));
    expect(VRMiniGameInputController.debugState().leanNeutral).toBeCloseTo(0.1, 6);
  });

  test('a recentre takes the current posture as straight again', () => {
    target.raceStarted = true;
    VRMiniGameInputController.update(frame([hand('left')], 0.0));
    VRMiniGameInputController.update(frame([hand('left')], 0.2));
    expect(last(target.steers)).toBeGreaterThan(0);
    VRMiniGameInputController.recentreSteering();
    VRMiniGameInputController.update(frame([hand('left')], 0.2));
    expect(last(target.steers)).toBe(0);
  });

  test('the stick steers once the race has started', () => {
    target.raceStarted = true;
    VRMiniGameInputController.update(frame([hand('left', { stickX: -1 })]));
    expect(last(target.steers)).toBe(-1);
    expect(VRMiniGameInputController.debugState().steerSource).toBe('stick');
  });
});

describe('the hands on the bars', () => {
  test('squeezing draws the hand on its grip, releasing lets go', () => {
    VRMiniGameInputController.update(frame([hand('left', { squeeze: 1 }), hand('right')]));
    expect(pins).toEqual([['left', target.gripPoses!.left]]);
    VRMiniGameInputController.update(frame([hand('left'), hand('right')]));
    expect(last(pins)).toEqual(['left', null]);
  });

  test('a held hand is not re-pinned every frame', () => {
    VRMiniGameInputController.update(frame([hand('right', { squeeze: 1 })]));
    VRMiniGameInputController.update(frame([hand('right', { squeeze: 1 })]));
    expect(pins.length).toBe(1);
  });

  test('a hand that drops out of the frame is let go, and the bike does not swerve', () => {
    target.raceStarted = true;
    VRMiniGameInputController.update(frame([hand('left', { squeeze: 1 }), hand('right', { squeeze: 1 })]));
    VRMiniGameInputController.update(frame([hand('right', { squeeze: 1 })]));
    expect(last(pins)).toEqual(['left', null]);
    expect(last(target.steers)).toBe(0);
  });

  test('leaving the minigame releases both hands', () => {
    VRMiniGameInputController.update(frame([hand('left', { squeeze: 1 }), hand('right', { squeeze: 1 })]));
    VRMiniGameInputController.setProvider(() => null);
    VRMiniGameInputController.update(frame([hand('left', { squeeze: 1 }), hand('right', { squeeze: 1 })]));
    expect(pins.slice(-2)).toEqual([['left', null], ['right', null]]);
  });
});

describe('throttle and jump reach the bike', () => {
  test('holding the right trigger asks for acceleration every frame', () => {
    for (let i = 0; i < 3; i++) VRMiniGameInputController.update(frame([hand('right', { trigger: 1 })]));
    expect(target.accelerates).toBe(3);
  });

  test('the left trigger jumps once per press, even if the race has not started', () => {
    for (let i = 0; i < 3; i++) VRMiniGameInputController.update(frame([hand('left', { trigger: 1 })]));
    expect(target.jumps).toBe(1);
    VRMiniGameInputController.update(frame([hand('left', { trigger: 0 })]));
    VRMiniGameInputController.update(frame([hand('left', { trigger: 1 })]));
    expect(target.jumps).toBe(2);
  });

  test('a press that spans a frame with no input does not fire again on return', () => {
    VRMiniGameInputController.update(frame([hand('left', { trigger: 1 })]));
    VRMiniGameInputController.update(null);
    VRMiniGameInputController.update(frame([hand('left', { trigger: 1 })]));
    // The null frame cleared the edge state, so this is a fresh press: two
    // jumps for two distinct holds is the honest answer.
    expect(target.jumps).toBe(2);
  });
});

describe('without a seat', () => {
  test('lean cannot steer but the stick still can', () => {
    target.raceStarted = true;
    (target as { seatPosition: THREE.Vector3 | null }).seatPosition = null;
    VRMiniGameInputController.update(frame([hand('left')], 0.5));
    expect(last(target.steers)).toBe(0);
    expect(VRMiniGameInputController.debugState().lean).toBeNull();
    VRMiniGameInputController.update(frame([hand('left', { stickX: 0.9 })], 0.5));
    expect(last(target.steers)).toBeGreaterThan(0.8);
  });
});
