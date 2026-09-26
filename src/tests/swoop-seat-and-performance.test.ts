import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { SWOOP_GRIP_OFFSETS } from '@/vr/runtime/VRMiniGameGripHost';

/**
 * Five faults from the first real ride of the swoop, all measured.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const bodyOf = (source: string, signature: string): string => {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated body for ${signature}`);
};

const player = read('module/ModuleMGPlayer.ts');
const gameState = read('GameState.ts');

/**
 * "Terribly slow and glitchy." The player's animation manager list grew without
 * bound: de-duplication compared a stored animation's NUL-padded name against
 * the caller's clean string, so nothing ever matched and every play pushed
 * another manager. The dashboard's timer digits are replayed continuously by
 * the heartbeat, so it climbed for as long as the ride lasted — measured at
 * 3,419 managers costing 9ms a frame, with the player's update at 11.6ms.
 * After: 34 managers, flat across 90 simulated seconds, player update 0.38ms.
 */
describe('the ride does not get slower the longer it lasts', () => {
  test('animation names are matched on a normalised key', () => {
    const key = bodyOf(player, '  private static animationKey(name: string): string');
    expect(key).toMatch(/replace\(/);
    expect(key).toMatch(/toLowerCase\(\)\.trim\(\)/);
  });

  test.each([
    ['playAnimation', '  playAnimation(name'],
    ['removeAnimation', '  removeAnimation(name'],
  ])('%s de-duplicates through that key rather than the raw name', (_label, signature) => {
    const body = bodyOf(player, signature);
    expect(body).toMatch(/ModuleMGPlayer\.animationKey\(am\?\.currentAnimation\?\.name\)/);
    expect(body).not.toMatch(/am\?\.currentAnimation\?\.name == name/);
  });

  test('the course advances only the animation, not the whole model tree', () => {
    const advance = bodyOf(player, '  advanceTrackAnimation(delta: number)');
    expect(advance).toMatch(/track\.animationManager\?\.update\(scaled\)/);
    // As a statement, not the comment that explains why it is gone.
    expect(advance).not.toMatch(/^\s*track\.update\(/m);
  });

  test('the grips are attached once rather than searched for every frame', () => {
    expect(gameState).toMatch(/vrSwoopGripsAttachedTo !== player\.container/);
  });
});

/**
 * "The player seat position was too far back" — the rider hung off the bike's
 * origin, which is aft of the saddle, so the head sat behind the seat back
 * looking forward at it.
 */
describe('the rider sits on the saddle', () => {
  const seat = gameState.slice(
    gameState.indexOf('public static getMiniGameSeat()'),
    gameState.indexOf('public static getCurrentPlayer()'),
  );

  test('the seat is offset forward of the hook', () => {
    expect(gameState).toMatch(/MINIGAME_SEAT_FORWARD_OFFSET = 0.6;/);
    expect(seat).toMatch(/addScaledVector\([\s\S]*?MINIGAME_SEAT_FORWARD_OFFSET/);
  });

  test('the offset follows the bike, not a world axis', () => {
    expect(seat).toMatch(/miniGameSeatForward/);
  });

  test('the returned position is its own vector, not the decompose scratch', () => {
    expect(gameState).toMatch(/miniGameSeat: \{ position: THREE\.Vector3; facing: number \} = \{\s*position: new THREE\.Vector3\(\)/);
  });
});

/**
 * "The spawn position was about 90 degrees to the left of forward." Measured
 * in the headset: rig yaw pi against a travel heading of pi/2.
 */
describe('the rider faces the way the bike travels', () => {
  const seat = gameState.slice(
    gameState.indexOf('public static getMiniGameSeat()'),
    gameState.indexOf('public static getCurrentPlayer()'),
  );

  test('a full half turn is taken off the heading', () => {
    expect(seat).toMatch(/Math\.atan2\([\s\S]*?\)\s*- Math\.PI;/);
    expect(seat).not.toMatch(/- Math\.PI \/ 2;/);
  });
});

/**
 * "The grips are in the wrong place." They were placed at the authored rider's
 * own hand span, which sits low and close — short of the bars, out of reach.
 */
describe('the grips sit on the handlebars', () => {
  // Measured from the bike's own rider, `trider`, which is posed holding the
  // bars: the centroid of its forward-most vertices either side of centre.
  test('they sit where the authored rider holds', () => {
    const [left, right] = SWOOP_GRIP_OFFSETS;
    expect(Math.abs(left[0])).toBeCloseTo(0.25, 3);
    expect(left[0]).toBeCloseTo(-right[0], 5);
    expect(left[1]).toBeCloseTo(1.4, 3);
    expect(left[2]).toBeCloseTo(0.87, 3);
  });

  test('they are reachable from the saddle rather than behind it', () => {
    const forwardOfSeat = SWOOP_GRIP_OFFSETS[0][1] - 0.6;
    expect(forwardOfSeat).toBeGreaterThan(0.4);
    expect(forwardOfSeat).toBeLessThan(1.0);
  });
});


/**
 * "These need to be grip-able with the hands also." Squeeze takes hold of a
 * bar and the hand is drawn on it; steering only counts while held.
 */
describe('the bars can be taken hold of', () => {
  const controller = read('vr/runtime/VRMiniGameInputController.ts');
  const pin = bodyOf(controller, '  private static pinHeldHands(');

  test('a holding hand is pinned to its grip, and a free hand released', () => {
    expect(pin).toMatch(/isGripping\(hand, config\)/);
    expect(pin).toMatch(/holding \? \(poses\?\.\[role\] \?\? null\) : null/);
  });

  test('the pin is only the visual: input still reads the real pose', () => {
    const host = read('vr/runtime/XRControllerAnchorHost.ts');
    expect(host).toMatch(/this\.pinnedPoses\[hand\] \?\? inputFrame\?\.hands\[hand\]\?\.pose/);
  });

  test('leaving a minigame never leaves a hand stuck to a bar', () => {
    expect(controller).toMatch(/releaseHands\(\)/);
    expect(bodyOf(controller, '  static reset(): void')).toMatch(/releaseHands\(\)/);
  });

  test('holding on is a squeeze, and holding on has no say in the steering', () => {
    const policy = read('vr/runtime/VRMiniGameInputPolicy.ts');
    expect(bodyOf(policy, 'export function isGripping(')).toMatch(/XR_STANDARD_SQUEEZE/);
    const steer = bodyOf(policy, 'export function resolveSwoopSteer(');
    expect(steer).not.toMatch(/isGripping|resolveGripState/);
  });
});


/**
 * The scheme locked on 2026-09-25, after four hand-steering models failed in
 * the headset: the left stick and head lean steer as a rate, the stick wins,
 * the hands do not steer. The policy tests cover the behaviour; this pins the
 * wiring the engine relies on.
 */
describe('steering is the left stick or the lean, as a rate', () => {
  const controller = read('vr/runtime/VRMiniGameInputController.ts');
  const update = bodyOf(controller, '  static update(inputFrame: XRInputFrame | null): void');

  test('the steer is handed to the bike as a rate input, not a lane', () => {
    expect(update).toMatch(/target\.setSteer\(target\.raceStarted \? intent\.steer : 0\)/);
    expect(controller).not.toMatch(/setLateralPosition|LATERAL_EASING|handRollAngle/);
  });

  test('the bike integrates it with inertia and a wall', () => {
    const player = read('module/ModuleMGPlayer.ts');
    expect(bodyOf(player, '  stepLateral(delta: number)')).toMatch(/stepSwoopLateral\(/);
    expect(bodyOf(player, '  stepLateral(delta: number)')).toMatch(/emitRideEvent\('wall'/);
    expect(bodyOf(player, '  update(delta: number = 0)')).toMatch(/this\.stepLateral\(delta\)/);
  });

  test('both input paths write the same steer input', () => {
    expect(read('controls/IngameControls.ts')).toMatch(/player\.setSteerInput\(-1\)/);
    expect(read('controls/IngameControls.ts')).toMatch(/player\.setSteerInput\(1\)/);
    expect(read('GameState.ts')).toMatch(/setSteer: \(steer: number\) => \{ player\.setSteerInput\?\.\(steer\); \}/);
  });

  test('the race start is the lateral acceleration the heartbeat grants', () => {
    expect(read('GameState.ts')).toMatch(/get raceStarted\(\)\{ return \(player\.accel_lateral_secs \?\? 0\) > 0; \}/);
  });

  test('the left trigger alone jumps; the right trigger alone throttles', () => {
    const policy = read('vr/runtime/VRMiniGameInputPolicy.ts');
    expect(bodyOf(policy, 'export function swoopJumpControlHeld(')).toMatch(/frame\.hands\['left'\]/);
    expect(bodyOf(policy, 'export function swoopThrottleHeld(')).toMatch(/frame\.hands\['right'\]/);
    expect(policy).not.toMatch(/JUMP_BUTTON_INDICES/);
  });
});
