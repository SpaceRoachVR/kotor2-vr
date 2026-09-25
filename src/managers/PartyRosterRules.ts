/**
 * The party roster (PARTYTABLE's PT_MEMBERS) is what a save writes and what a
 * module transition rebuilds the party from; the live `party` array is only
 * this module's instances of it. A creature put into the party by
 * AddPartyMember (103PER's a_addt3m4sp: T3-M4, NPC 8, resurrected in the fuel
 * pipe) used to be pushed into `party` alone, with no roster entry and no
 * npcId, so the save wrote him as member 0 (Atton's id, twice) and the next
 * module load and the next reload both came up without him.
 */
export interface PartyRosterEntry {
  isLeader: boolean;
  memberID: number;
}

/**
 * Adds `npcId` to the roster unless it is already there. Returns true when an
 * entry was added.
 */
export function registerPartyRosterMember(roster: PartyRosterEntry[], npcId: number): boolean {
  if (!Array.isArray(roster)) {
    throw new TypeError('party roster must be an array');
  }
  if (!Number.isInteger(npcId) || npcId < 0) {
    throw new RangeError('npc id must be a non-negative integer');
  }
  if (roster.some((entry) => entry && entry.memberID === npcId)) return false;
  roster.push({ isLeader: false, memberID: npcId });
  return true;
}
