import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Minigame collision spheres have to follow their object through the world.
 *
 * Every minigame object hangs off a track node that moves, so its own
 * `position` is a local offset, not where it is. Both the player and the
 * enemies copied that local position into the collision sphere (with the
 * world-space call sitting commented out beside it), which put all 47 course
 * objects on 211TEL at the origin sharing one sphere: they all reported a
 * collision on the first frame, firing every acceleration pad at once.
 *
 * Measured after the fix on a live 211TEL: pad spheres sit at real positions
 * (e.g. -75, -2.5, 40), no pad collides spuriously during a run, and widening
 * one pad's radius makes the player collide with it and run OnHitFollower.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('collision spheres track world position', () => {
  test.each([
    ['module/ModuleMGPlayer.ts', 2],
    ['module/ModuleMGEnemy.ts', 1],
  ])('%s takes its sphere centre from the world', (file, expected) => {
    const source = read(file);
    const matches = source.match(/getWorldPosition\(this\.sphere\.center\)/g) ?? [];
    expect(matches).toHaveLength(expected);
  });

  test.each(['module/ModuleMGPlayer.ts', 'module/ModuleMGEnemy.ts'])(
    '%s no longer copies the local position into the sphere', (file) => {
      expect(read(file)).not.toContain('this.sphere.center.copy(this.position)');
    });

  test('the enemy already used world space for its firing ray, which is the same source', () => {
    // Its raycast origin was right all along; only the sphere was wrong.
    expect(read('module/ModuleMGEnemy.ts'))
      .toContain('this.container.getWorldPosition(GameState.raycaster.ray.origin)');
  });
});
