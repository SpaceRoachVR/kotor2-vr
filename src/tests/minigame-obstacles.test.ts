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
    const check = bodyOf(read('module/ModuleMGPlayer.ts'), '  checkObstacleCollisions()');
    expect(check).toMatch(/getWorldPosition\(ModuleMGPlayer\.obstacleProbePosition\)/);
    expect(check).not.toMatch(/this\.track\.position;/);
  });
});
