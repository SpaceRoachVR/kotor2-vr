import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Round 8, S6: "Plasma torch bash still does nothing". Peragus' Damaged Door
 * runs a_plasmachk from OnMeleeAttacked, which asks GetLastAttacker(OBJECT_SELF)
 * for the attacker's weapon and checks it for the door-cutting property. Both
 * GetLastAttacker and GetLastDamager answered only for creatures, so on a door
 * every torch strike read as "no attacker" and the door barked "too damaged to
 * be bashed open with anything short of a plasma torch" at a player holding one.
 *
 * NWScriptDefK1 reaches the whole engine graph, so the two definitions are
 * pinned by source.
 */
describe('attacker queries on doors and placeables', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/nwscript/NWScriptDefK1.ts'), 'utf8');

  function definition(name: string): string {
    const at = source.indexOf(`name: "${name}"`);
    expect(at).toBeGreaterThan(-1);
    const body = source.slice(at);
    return body.slice(0, body.indexOf('\n  },'));
  }

  test('GetLastAttacker answers for any module object', () => {
    const body = definition('GetLastAttacker');
    expect(body).toContain('ModuleObjectType.ModuleObject)');
    expect(body).not.toContain('ModuleObjectType.ModuleCreature');
    expect(body).toContain('combatData?.lastAttacker');
  });

  test('GetLastDamager answers for any module object calling it', () => {
    const body = definition('GetLastDamager');
    expect(body).toContain('ModuleObjectType.ModuleObject)');
    expect(body).not.toContain('ModuleObjectType.ModuleCreature');
    expect(body).toContain('combatData?.lastDamager');
  });
});
