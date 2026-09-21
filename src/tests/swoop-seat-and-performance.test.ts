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
  test('they are further forward and wider than the first attempt', () => {
    const [left, right] = SWOOP_GRIP_OFFSETS;
    expect(Math.abs(left[0])).toBeCloseTo(0.45, 5);
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
 * "Steering didn't seem to work at all." It did — the rider was pinned against
 * the tunnel wall at full lock, measured at container x = 20 of a +/-20 tunnel,
 * because a captured neutral had gone stale against their real posture. At the
 * stop, nothing they do moves it back, which reads exactly like dead controls.
 */
describe('steering cannot strand the rider at the wall', () => {
  const controller = read('vr/runtime/VRMiniGameInputController.ts');
  const relax = bodyOf(controller, '  private static relaxNeutral(inputFrame: XRInputFrame): void');

  test('straight-ahead relaxes towards how the rider is actually holding', () => {
    expect(relax).toMatch(/sampleSwoopNeutral\(inputFrame\)/);
    expect(relax).toMatch(/NEUTRAL_RELAX_SECONDS/);
  });

  test('the time constant is long enough for a deliberate turn to survive', () => {
    expect(controller).toMatch(/NEUTRAL_RELAX_SECONDS = 4;/);
  });

  test('it is driven from frame timestamps, and a large gap cannot jump it', () => {
    expect(relax).toMatch(/inputFrame\.timestamp/);
    expect(relax).toMatch(/Math\.min\(0\.1,/);
  });

  test('losing the hands resets the clock rather than integrating a stale gap', () => {
    expect(relax).toMatch(/if \(!sampled\)[\s\S]{0,120}lastNeutralRelaxAt = 0;/);
  });
});
