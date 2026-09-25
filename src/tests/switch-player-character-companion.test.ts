import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Possession must neither duplicate nor lose a party member. At 106PER's
 * Hangar Control the driver possesses T3-M4 (the only member with both
 * Repair and Computer Use) while he is already a companion in the party:
 * SwitchPlayerCharacter built a second T3 at slot 0 with the companion still
 * following, and switching back destroyed the possessed instance without
 * putting the roster's member back.
 */
describe('SwitchPlayerCharacter and companions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'managers', 'PartyManager.ts'), 'utf8');
  const start = source.indexOf('static SwitchPlayerCharacter(npcId = 0){');
  const body = source.slice(start, source.indexOf('static Save(){', start));

  test('a companion instance of the possessed member is folded into the switch', () => {
    expect(body).toContain('PartyManager.party.findIndex((pm, index) => index > 0 && pm && pm.npcId == npcId)');
    expect(body).toContain('PartyManager.NPCS[npcId].template = companion.save();');
    expect(body).toContain('PartyManager.party.splice(companionIndex, 1);');
    expect(body).toContain('companion.destroy();');
  });

  test('handing control back restores the outgoing member as a companion', () => {
    expect(body).toContain('const outgoingNpcId = oldPC && !oldPC.isPlayer');
    expect(body).toContain('PartyManager.NPCS[outgoingNpcId].template = oldPC.save();');
    expect(body).toContain('PartyManager.IsNPCInParty(outgoingNpcId)');
    expect(body).toContain('PartyManager.RestoreCompanion(outgoingNpcId, spawn)');
    expect(body).toContain('static async RestoreCompanion(npcId: number, near: THREE.Vector3)');
    // Never a second instance of a member who is still in the party.
    expect(body).toContain('if(PartyManager.party.some((pm) => pm && pm.npcId == npcId)){ return; }');
  });
});
