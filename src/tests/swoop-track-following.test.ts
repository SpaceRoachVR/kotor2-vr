import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The bike did not follow the track at all.
 *
 * Every swoop track model carries an animation named `track` whose only
 * animated nodes are the model root and `modelhook` — the hook the rider is
 * attached to. That animation is the course. 211TEL's runs 96 seconds and
 * sweeps the hook from y -183 to y 6180, which is the span its obstacles are
 * placed across (y 93 to 6006).
 *
 * Nothing ever advanced it. The engine instead translated the track model in a
 * straight line along +Y from the world origin, so the rider left the authored
 * canyon almost immediately — which is why obstacles were never struck and why
 * the world ahead turned black. That was reported as a draw-distance problem
 * and was not one: the far plane is 15000 and the level is four rooms deep.
 *
 * `MovementPerSec` is the speed the animation was authored at, so advancing it
 * by speed/MovementPerSec makes a rider at that speed take exactly the authored
 * time. Verified: at speed 100 the course completes in 96.0 simulated seconds
 * and wraps back to the start, which is the lap `Num_Loops = -1` asks for.
 *
 * Source-level assertions: importing these modules pulls in THREE's ESM build,
 * which Jest cannot parse here. Behaviour is covered by the emulator probes.
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

describe('the swoop rides its authored course', () => {
  const advance = bodyOf(player, '  advanceTrackAnimation(delta: number)');

  test('the course animation is played on the track model, looping', () => {
    expect(player).toMatch(/static readonly TRACK_ANIMATION_NAME = 'track';/);
    expect(advance).toMatch(/playAnimation\(ModuleMGPlayer\.TRACK_ANIMATION_NAME, true\)/);
  });

  test('it advances in proportion to speed over MovementPerSec', () => {
    expect(advance).toMatch(/movementPerSec/);
    expect(advance).toMatch(/delta \* \(this\.speed \/ perSecond\)/);
  });

  test('a stopped bike does not advance the course', () => {
    expect(advance).toMatch(/if\(!\(scaled > 0\)\)\{ return; \}/);
  });

  test('a missing animation is survivable rather than throwing', () => {
    expect(advance).toMatch(/typeof track\.playAnimation !== 'function'/);
    expect(advance).toMatch(/if\(!started\)\{ return; \}/);
  });

  test('a new track starts its own animation', () => {
    expect(bodyOf(player, '  setTrack(model')).toMatch(/this\.trackAnimationPlaying = false;/);
  });
});

describe('the bike is no longer shoved along in a straight line', () => {
  const update = player.slice(player.indexOf('  update(delta'), player.indexOf('  updatePaused('));

  test('nothing translates the track node any more', () => {
    expect(update).not.toMatch(/this\.track\.position\.add/);
  });

  test('the force vector carries steering only, not forward motion', () => {
    expect(update).toMatch(/this\.forceVector\.set\( this\.lateralForce \* delta, 0, 0 \)/);
  });

  test('steering is an offset from the hook the course animation moves', () => {
    expect(update).toMatch(/this\.container\.position\.add\(this\.forceVector\)/);
  });

  test('and the tunnel clamps that offset, not the track node', () => {
    const clamp = bodyOf(player, '  clampToTunnel()');
    expect(clamp).toMatch(/this\.container\.position\.x/);
    expect(clamp).not.toMatch(/this\.track\.position/);
  });
});
