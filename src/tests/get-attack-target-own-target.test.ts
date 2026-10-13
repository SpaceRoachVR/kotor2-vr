import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * NWScript 316, "Get the attack target of oCreature. This only works when
 * oCreature is in combat." It returned the creature's last attacker when the
 * creature had no target of its own, so the retail AI's "am I already
 * fighting?" checks (k_ai_master 2002/2005/2006, GN_RespondToShout) treated a
 * companion that had merely been hit as engaged, and it waited for its next
 * end-of-round before joining (Hive, combat round 17).
 */
describe('GetAttackTarget (NWScript 316)', () => {
  // NWScriptDefK1 reaches the whole engine graph and cannot be imported here;
  // pin the action body at source level, comments stripped.
  const contents = fs.readFileSync(path.join(process.cwd(), 'src/nwscript/NWScriptDefK1.ts'), 'utf8');
  const body = (() => {
    const at = contents.indexOf('name: "GetAttackTarget"');
    expect(at).toBeGreaterThan(-1);
    const rest = contents.slice(at);
    return rest.slice(0, rest.indexOf('\n  317:{'))
      .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  })();

  test("returns the creature's own attack target, never the creature that attacked it", () => {
    expect(body).toContain('combatData.lastAttackTarget');
    expect(body).not.toContain('lastAttacker');
  });
});
