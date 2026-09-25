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
  const start = source.indexOf('static SwitchPlayerCharacter(npcId = 0, keepOutgoingPlayer = false){');
  const body = source.slice(start, source.indexOf('static Save(){', start));

  test('a companion instance of the possessed member is folded into the switch', () => {
    expect(body).toContain('PartyManager.party.findIndex((pm, index) => index > 0 && pm && pm.npcId == npcId)');
    expect(body).toContain('PartyManager.NPCS[npcId].template = companion.save();');
    expect(body).toContain('PartyManager.party.splice(companionIndex, 1);');
    expect(body).toContain('companion.destroy();');
  });

  test('a leader switch keeps the Exile in the world and reinstates the same instance', () => {
    // Retail: a portrait click leaves the PC following; scripts (a_bet3m4)
    // take her out of the world, so the flag defaults to false.
    expect(body).toContain('static SwitchPlayerCharacter(npcId = 0, keepOutgoingPlayer = false){');
    expect(body).toContain('if(keepOutgoingPlayer && oldPC && oldPC.isPlayer && npcId >= 0){');
    expect(body).toContain('PartyManager.party.push(oldPC);');
    expect(body).toContain('return PartyManager.ReinstatePlayer(followerIndex);');
    const reinstate = source.slice(source.indexOf('static ReinstatePlayer(followerIndex: number)'), source.indexOf('static async RestoreCompanion('));
    expect(reinstate).toContain('PartyManager.party[0] = follower;');
    expect(reinstate).toContain('PartyManager.Player = follower;');
    expect(reinstate).toContain('PartyManager.RestoreCompanion(outgoingNpcId, where)');
    const wheel = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    expect(wheel).toContain('GameState.PartyManager.SwitchPlayerCharacter(entry.npcId, true);');
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
