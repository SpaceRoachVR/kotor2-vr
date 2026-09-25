import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { registerPartyRosterMember, PartyRosterEntry } from '@/managers/PartyRosterRules';

/**
 * 103PER's a_addt3m4sp calls AddPartyMember(8, T3-M4). The party array had
 * three members until the next save or module load, after which T3 was gone:
 * the save wrote PT_MEMBER_ID 0 for him (no npcId) and the roster that
 * transitions rebuild from never listed him.
 */
describe('registerPartyRosterMember', () => {
  test('adds a missing member as a non-leader', () => {
    const roster: PartyRosterEntry[] = [{ isLeader: false, memberID: 0 }];
    expect(registerPartyRosterMember(roster, 8)).toBe(true);
    expect(roster).toEqual([{ isLeader: false, memberID: 0 }, { isLeader: false, memberID: 8 }]);
  });

  test('does not duplicate a member already on the roster', () => {
    const roster: PartyRosterEntry[] = [{ isLeader: false, memberID: 0 }, { isLeader: false, memberID: 8 }];
    expect(registerPartyRosterMember(roster, 8)).toBe(false);
    expect(roster).toHaveLength(2);
  });

  test('refuses a nonsensical id or roster', () => {
    expect(() => registerPartyRosterMember([], -1)).toThrow(RangeError);
    expect(() => registerPartyRosterMember([], 1.5)).toThrow(RangeError);
    expect(() => registerPartyRosterMember(null as unknown as PartyRosterEntry[], 0)).toThrow(TypeError);
  });

  test('AddCreatureToParty records the slot on the creature and on the roster', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'managers', 'PartyManager.ts'), 'utf8');
    const start = source.indexOf('static AddCreatureToParty(slot = 1, creature: ModuleCreature){');
    const body = source.slice(start, source.indexOf('static SwitchPlayerCharacter(', start));
    expect(body).toContain('creature.npcId = slot;');
    expect(body).toContain('registerPartyRosterMember(PartyManager.CurrentMembers, slot)');
    expect(body).toContain('PartyManager.AddPortraitToOrder( creature.getPortraitResRef() )');
  });
});
