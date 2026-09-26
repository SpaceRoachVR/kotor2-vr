import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Obstacles were inert. The area built one per LYT entry and then nothing
 * touched them again: no template, no scripts, no collider — only an
 * invulnerability timer counting down against nothing. A rider passed straight
 * through every hazard on the track.
 *
 * Measured on 211TEL before: 105 obstacles, 0 with a template, 0 with scripts.
 * After: 105 with templates and scripts, and driving the bike onto one fires
 * the player's OnHitObstacle with the obstacle that was struck.
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

describe('obstacles are given their scripts', () => {
  const miniGame = read('module/ModuleMiniGame.ts');

  test('the ARE obstacle list is read at all', () => {
    expect(miniGame).toMatch(/getFieldByLabel\('Obstacles'\)/);
    expect(miniGame).toMatch(/obstacleTemplates/);
  });

  test('templates are matched to placed obstacles by name', () => {
    const apply = bodyOf(miniGame, '  applyObstacleTemplates()');
    expect(apply).toMatch(/obstacle\?\.layout\?\.name/);
    expect(apply).toMatch(/toLowerCase\(\)/);
    expect(apply).toMatch(/obstacle\.setTemplate\(template\)/);
  });

  test('the area applies them once the layout has placed the obstacles', () => {
    const area = read('module/ModuleArea.ts');
    const placed = area.indexOf('new ModuleMGObstacle(undefined, this.layout.obstacles[i])');
    const applied = area.indexOf('applyObstacleTemplates()');
    expect(placed).toBeGreaterThan(-1);
    expect(applied).toBeGreaterThan(placed);
  });
});

describe('obstacles can be struck', () => {
  const obstacle = read('module/ModuleMGObstacle.ts');

  test('an obstacle has a collision sphere at its placed position', () => {
    expect(obstacle).toMatch(/sphere: THREE\.Sphere/);
    expect(obstacle).toMatch(/this\.sphere\.center\.copy\(layout\.position\)/);
  });

  test('the chosen radius is a single named constant, since retail ships none', () => {
    expect(obstacle).toMatch(/static readonly DEFAULT_RADIUS = 3;/);
  });

  test('a spent obstacle does not fire again while the bike is still inside it', () => {
    const struck = bodyOf(obstacle, '  isStruckBy(position: THREE.Vector3)');
    expect(struck).toMatch(/if\(this\.invince > 0\)\{ return false; \}/);
  });

  test('the player sweeps them and runs both sides of the hit', () => {
    const check = bodyOf(read('module/ModuleMGPlayer.ts'), '  checkObstacleCollisions()');
    expect(check).toMatch(/obstacle\.startInvulnerability\(\)/);
    expect(check).toMatch(/obstacle\.onHitFollower\(\)/);
    expect(check).toMatch(/this\.onHitObstacle\(obstacle\)/);
  });

  test('the sweep compares world positions, not the track node local offset', () => {
    const player = read('module/ModuleMGPlayer.ts');
    const check = bodyOf(player, '  checkObstacleCollisions()');
    expect(check).toMatch(/this\.sweepMeets\(obstacle\.sphere\.center, obstacle\.sphere\.radius\)/);
    expect(check).not.toMatch(/this\.track\.position;/);
    const sweep = bodyOf(player, '  sweepMeets(centre: THREE.Vector3, radius: number)');
    expect(sweep).toMatch(/getWorldPosition\(ModuleMGPlayer\.sweepEnd\)/);
    expect(sweep).toMatch(/segmentMeetsCircle2D\(a\.x, a\.y, b\.x, b\.y, centre\.x, centre\.y, radius\)/);
  });

  test('a struck marker re-arms after a moment, and an invulnerable rider strikes nothing', () => {
    const obstacle = read('module/ModuleMGObstacle.ts');
    expect(obstacle).toMatch(/DEFAULT_REARM_SECONDS = 1.5/);
    expect(bodyOf(obstacle, '  startInvulnerability()')).toMatch(/this.invince_period || ModuleMGObstacle.DEFAULT_REARM_SECONDS/);
    expect(bodyOf(read('module/ModuleMGPlayer.ts'), '  checkObstacleCollisions()')).toMatch(/if\(this\.invince > 0\)\{ return; \}/);
  });

  test('the rails across the road are room geometry, met by short rays at hull height', () => {
    const player = read('module/ModuleMGPlayer.ts');
    expect(player).toContain('BARRIER_NODE_PATTERN = /_gr\\d+_(lh|rh|fh|ch|center)\\d*/i');
    const check = bodyOf(player, '  checkBarrierCollisions()');
    expect(check).toContain('ray.intersectObjects(meshes, false)');
    expect(check).toContain('this.onHitObstacle(undefined as any)');
    expect(check).toContain('if(!this.container || this.invince > 0 || !this.sweepValid){ return; }');
    expect(bodyOf(player, '  update(delta: number = 0)')).toContain('this.checkBarrierCollisions()');
    // Road tiles share the prefix and must not be rails.
    const pattern = /_gr\d+_(lh|rh|fh|ch|center)\d*/i;
    expect(pattern.test('tel_gr08_lh02')).toBe(true);
    expect(pattern.test('swp_gr01_fh01')).toBe(true);
    expect(pattern.test('tel_gr08_center01')).toBe(true);
    expect(pattern.test('tel_gr08_platl03')).toBe(false);
    expect(pattern.test('tel_gr08_start')).toBe(false);
    expect(pattern.test('swp_gr01_finish')).toBe(false);
  });

  test('a hop clears the course: nothing is struck while airborne', () => {
    const player = read('module/ModuleMGPlayer.ts');
    expect(bodyOf(player, '  checkObstacleCollisions()')).toMatch(/OBSTACLE_CLEAR_HEIGHT/);
    expect(bodyOf(player, '  update(delta: number = 0)')).toMatch(/const airborne = this\.container\.position\.z > ModuleMGPlayer\.OBSTACLE_CLEAR_HEIGHT/);
  });
});
