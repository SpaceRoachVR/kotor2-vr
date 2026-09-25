import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * GetHasSkill (routine 286) was a stub returning 0, so every console reply
 * gated on it ("[Repair] Replace the missing parts" at Peragus' Hangar
 * Control, c_ic_skilrep) was never offered, and T3-M4's retail route to the
 * fuel depot stopped at the console. The routine table imports GameState, so
 * this pins the implementation by source rather than by import.
 */
describe('GetHasSkill', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'nwscript', 'NWScriptDefK1.ts'), 'utf8');
  const start = source.indexOf('name: "GetHasSkill"');
  const body = source.slice(start, source.indexOf('name: "ActionUseFeat"', start));

  test('reads the creature\'s effective skill rank instead of returning 0', () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain('getSkillLevel(skill) > 0 ? 1 : 0');
    expect(body).not.toMatch(/action: function[^{]*\{\s*return 0;\s*\}/);
  });

  test('refuses a non-creature and a malformed skill id', () => {
    expect(body).toContain('ModuleObjectType.ModuleCreature)) return 0');
    expect(body).toContain('!Number.isInteger(skill) || skill < 0) return 0');
  });
});
