import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * ActionAttack (routine 37) accepted only creatures. 105PER's a_bash_console
 * makes the PC attack the Turbolift Console placeable itself, whose death
 * script unlocks the turbolift; the refusal left the door locked for good.
 * The routine table imports GameState, so this pins the source.
 */
describe('ActionAttack targets', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'nwscript', 'NWScriptDefK1.ts'), 'utf8');
  const start = source.indexOf('name: "ActionAttack"');
  const body = source.slice(start, source.indexOf('name: "GetNearestCreature"', start));

  test('accepts placeables and doors as well as creatures', () => {
    expect(start).toBeGreaterThan(0);
    expect(body).toContain('ModuleObjectType.ModulePlaceable');
    expect(body).toContain('ModuleObjectType.ModuleDoor');
    expect(body).toContain('attackCreature(target)');
  });

  test('still requires a creature caller', () => {
    expect(body).toContain('BitWise.InstanceOfObject(this.caller, ModuleObjectType.ModuleCreature)');
  });
});
