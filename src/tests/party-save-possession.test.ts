import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/engine/CurrentGame', () => ({ CurrentGame: {} }));
jest.mock('@/module/ModuleCreature', () => ({ ModuleCreature: class {} }));
jest.mock('@/module/ModulePlayer', () => ({ ModulePlayer: class {} }));

import { PartyManager } from '@/managers/PartyManager';
import type { ModuleCreature } from '@/module/ModuleCreature';

beforeEach(() => {
  PartyManager.party = [];
  PartyManager.CurrentMembers = [];
  jest.spyOn(PartyManager, 'SavePartyMember').mockResolvedValue(undefined);
});

afterEach(() => jest.restoreAllMocks());

function creature(npcId: number): ModuleCreature {
  return { npcId } as ModuleCreature;
}

test('saving a temporarily possessed NPC does not recruit it into the persistent party', () => {
  PartyManager.party = [creature(8)];
  PartyManager.Save();
  PartyManager.Save();
  expect(PartyManager.CurrentMembers).toEqual([]);
  expect(PartyManager.IsNPCInParty(8)).toBe(false);
  expect(PartyManager.SavePartyMember).toHaveBeenCalledWith(8);
});

test('saving preserves recruited members and marks the actual controlled companion as leader', () => {
  PartyManager.CurrentMembers = [{ memberID: 0, isLeader: true }, { memberID: 8, isLeader: false }];
  PartyManager.party = [creature(8), creature(-1), creature(0)];
  PartyManager.Save();
  expect(PartyManager.CurrentMembers).toEqual([
    { memberID: 0, isLeader: false }, { memberID: 8, isLeader: true },
  ]);
  expect(PartyManager.SavePartyMember).toHaveBeenCalledWith(0);
  expect(PartyManager.SavePartyMember).toHaveBeenCalledWith(8);
});

test('the Exile leading does not label the first companion as leader', () => {
  PartyManager.CurrentMembers = [{ memberID: 0, isLeader: true }];
  PartyManager.party = [creature(-1), creature(0)];
  PartyManager.Save();
  expect(PartyManager.CurrentMembers).toEqual([{ memberID: 0, isLeader: false }]);
});

test('an empty live party preserves roster membership without a stale leader', () => {
  PartyManager.CurrentMembers = [{ memberID: 8, isLeader: true }];
  PartyManager.Save();
  expect(PartyManager.CurrentMembers).toEqual([{ memberID: 8, isLeader: false }]);
  expect(PartyManager.SavePartyMember).not.toHaveBeenCalled();
});
