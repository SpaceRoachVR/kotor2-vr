import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * NWScript 54, "Cancels combat for the specified creature." Retail
 * k_inc_generic calls CancelCombat(OBJECT_SELF) from a party member's
 * end-of-round checks when it sees no enemy (GN_DoPostDCRChecks) and when its
 * target is over 30 m away (GN_RunDefaultAIRoutine); k_hen_combend01 runs that
 * per creature. The engine cancelled combat for the whole party whenever the
 * argument was a party member, so every companion round-end dropped the
 * leader's and the other companions' combat too: 28 script cancels each in a
 * 40 s Telos firefight, and the companions never fired back.
 */
describe('CancelCombat (NWScript 54)', () => {
  // NWScriptDefK1 reaches the whole engine graph and cannot be imported here;
  // pin the action body at source level, comments stripped.
  const contents = fs.readFileSync(path.join(process.cwd(), 'src/nwscript/NWScriptDefK1.ts'), 'utf8');
  const body = (() => {
    const at = contents.indexOf('name: "CancelCombat"');
    expect(at).toBeGreaterThan(-1);
    const rest = contents.slice(at);
    return rest.slice(0, rest.indexOf('\n  55:{'))
      .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  })();

  test('cancels combat for the named creature', () => {
    expect(body).toMatch(/\(args\[0\] as ModuleCreature\)\.cancelCombat\(\)/);
  });

  test('never reaches other party members', () => {
    expect(body).not.toContain('PartyManager');
  });
});
