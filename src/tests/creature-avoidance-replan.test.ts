import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * An NPC that meets another creature on its way plans a detour around it and
 * follows it for a moment. Planning a fresh detour every frame aimed it at its
 * own feet (each detour begins where it stands) and flipped the detour from
 * side to side, so an attacker behind two others jittered in place.
 */
describe('NPC creature avoidance', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/actions/Action.ts'), 'utf8');

  test('a detour around the same obstacle is not re-planned every frame', () => {
    expect(source).toContain('static AVOIDANCE_REPLAN_SECONDS = 0.6;');
    expect(source).toContain('if (closestObstacle !== this.avoidanceObstacle || this.avoidanceHoldSeconds <= 0) {');
    expect(source).toContain('this.avoidanceHoldSeconds = Math.max(0, this.avoidanceHoldSeconds - delta);');
  });
});
