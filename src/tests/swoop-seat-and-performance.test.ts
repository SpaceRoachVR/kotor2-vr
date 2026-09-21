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
    expect(gameState).toMatch(/MINIGAME_SEAT_FORWARD_OFFSET = 0\.7;/);
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
  test('they sit inboard, on the bars the rider reaches', () => {
    const [left, right] = SWOOP_GRIP_OFFSETS;
    expect(Math.abs(left[0])).toBeCloseTo(0.26, 5);
    expect(left[0]).toBeCloseTo(-right[0], 5);
    expect(left[1]).toBeCloseTo(1.6, 5);
    expect(left[2]).toBeCloseTo(0.95, 5);
  });

  test('they are reachable from the saddle rather than behind it', () => {
    const forwardOfSeat = SWOOP_GRIP_OFFSETS[0][1] - 0.7;
    expect(forwardOfSeat).toBeGreaterThan(0.5);
    expect(forwardOfSeat).toBeLessThan(1.2);
  });
});

/**
 * "Steering didn't seem to work at all... tended to veer in whichever direction
 * was used first. Lifting one hand and dropping the other did nothing."
 *
 * Two causes, both from treating lean as a *rate*. A rate can only be undone by
 * counter-steering, so the bike kept going whichever way it was first pushed
 * and ended pinned against the tunnel wall - measured at container x = 20 of a
 * +/-20 tunnel, where nothing the rider does moves it back. And the neutral
 * relaxed towards whatever they held, so a lean held for a few seconds quietly
 * became the new straight-ahead and stopped doing anything at all.
 *
 * Lean is now a *position*: level is the centre lane, half a lean is half way
 * across, letting go returns to centre. It cannot run away and a held lean
 * keeps working. Chosen with Allen over the retail rate model.
 */
describe('lean is where the rider is, not how fast they drift', () => {
  const controller = read('vr/runtime/VRMiniGameInputController.ts');
  const update = bodyOf(controller, '  static update(inputFrame: XRInputFrame | null): void');

  test('the wanted lane comes from the lean and the tunnel width', () => {
    expect(update).toMatch(/const wanted = steer \* limit;/);
    expect(update).toMatch(/target\.setLateralPosition\(/);
  });

  test('the rate path is not also driving it', () => {
    expect(update).toMatch(/target\.setLateralForce\(0\)/);
  });

  test('it eases rather than snapping, so tracking jitter cannot buzz the bike', () => {
    expect(controller).toMatch(/LATERAL_EASING = 0\.25;/);
    expect(update).toMatch(/\(wanted - current\) \* VRMiniGameInputController\.LATERAL_EASING/);
  });

  test('the drifting neutral that ate held input is gone', () => {
    expect(controller).not.toMatch(/relaxNeutral/);
    expect(controller).not.toMatch(/NEUTRAL_RELAX_SECONDS/);
  });

  test('a track with no tunnel falls back to the rate model rather than freezing', () => {
    expect(update).toMatch(/if \(limit > 0\)[\s\S]*?\} else \{[\s\S]*?setLateralForce\(steer \* lateral\)/);
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

  test('riding requires holding on', () => {
    const policy = read('vr/runtime/VRMiniGameInputPolicy.ts');
    const riding = policy.slice(
      policy.indexOf('export function resolveRidingState('),
      policy.indexOf('export function sampleSwoopNeutral('),
    );
    expect(riding).toMatch(/isGripping\(hand, config\)/);
  });
});

/**
 * A/X did not jump, twice, having been bound by index each time. Index order
 * past the trigger and squeeze is not consistent across profiles, so every
 * other button jumps - there is nothing else for them to do while riding.
 */
describe('every spare button jumps', () => {
  const policy = read('vr/runtime/VRMiniGameInputPolicy.ts');

  test('the throttle and the grip are excluded, everything else included', () => {
    expect(policy).toMatch(/JUMP_BUTTON_INDICES = \['2', '3', '4', '5', '6', '7'\]/);
  });

  test('any of them counts, not just the first one present', () => {
    expect(policy).toMatch(/JUMP_BUTTON_INDICES\.some\(/);
  });
});
