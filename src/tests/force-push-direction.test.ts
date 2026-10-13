import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { forcePushDirection } from '@/effects/forcePushDirection';

/**
 * Force Push and Force Wave throw a target away from the caster. The engine
 * threw it backwards along its own facing, so a trooper turned toward a
 * companion behind the caster was thrown toward the caster (Force Wave on
 * Korriban: two troopers ended nearer the Exile).
 */
describe('Force push direction', () => {
  test('straight away from the pusher, whatever the target faces', () => {
    const [x, y] = forcePushDirection({ x: 3, y: 4 }, { x: 0, y: 0 }, 1.234);
    expect(x).toBeCloseTo(0.6);
    expect(y).toBeCloseTo(0.8);
  });

  test('backwards along the facing with no pusher', () => {
    const [x, y] = forcePushDirection({ x: 0, y: 0 }, undefined, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-1);
  });

  test('backwards along the facing when the pusher stands on the target', () => {
    const [x, y] = forcePushDirection({ x: 1, y: 1 }, { x: 1, y: 1 }, 0);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-1);
  });

  test('EffectForcePushed uses it with its creator', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/effects/EffectForcePushed.ts'), 'utf8');
    expect(src).toContain('forcePushDirection(this.object.position, this.creator?.position, this.object.facing)');
  });
});
