import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { resolvePartyForcePool } from '../combat/partyForcePool';

/**
 * Retail shows Force 0 / 0 for every companion without a Force-die class level
 * (StrategyWiki KotOR II Party). p_baodur.utc stores ForcePoints 48 anyway,
 * and the engine gave him a 48-point pool.
 */
describe('party member Force pool', () => {
  test("Bao-Dur's stored 48 is dropped: Tech Specialist has no Force die", () => {
    expect(resolvePartyForcePool({ maxForcePoints: 48, forcePoints: 48, forceClassLevels: 0, poolFromClasses: 0 })).toBe(0);
  });

  test('a non-Jedi with no stored pool is left alone', () => {
    expect(resolvePartyForcePool({ maxForcePoints: 0, forcePoints: 0, forceClassLevels: 0, poolFromClasses: 0 })).toBeUndefined();
  });

  test('a Jedi with no stored pool gets the pool from its classes (Kreia 49)', () => {
    expect(resolvePartyForcePool({ maxForcePoints: 0, forcePoints: 0, forceClassLevels: 3, poolFromClasses: 49 })).toBe(49);
  });

  test("a Jedi's stored pool is kept", () => {
    expect(resolvePartyForcePool({ maxForcePoints: 81, forcePoints: 81, forceClassLevels: 8, poolFromClasses: 64 })).toBeUndefined();
  });

  test('ModuleCreature applies it when a member joins', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/module/ModuleCreature.ts'), 'utf8');
    const at = src.indexOf('  ensureForcePointsFromClasses(): void {');
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 1200)).toContain('resolvePartyForcePool(');
  });
});
