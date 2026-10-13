import { beforeEach, afterEach, describe, expect, jest, test } from '@jest/globals';
jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/engine/CurrentGame', () => ({ CurrentGame: {} }));
jest.mock('@/module/ModulePlayer', () => ({ ModulePlayer: class {} }));
jest.mock('@/module/ModuleCreature', () => ({ ModuleCreature: class {} }));
import { PartyManager } from '@/managers/PartyManager';
import { GameState } from '@/GameState';
import * as fs from 'fs';
import * as path from 'path';

/**
 * nwscript.nss 846 RemoveNPCFromPartyToBase: "Will remove the CNPC from the 3
 * person party, and remove him/her from the area, effectively sending the
 * CNPC back to the base. The CNPC data is still stored in the party table".
 * It used to leave the creature standing in the area. 001EBO's outro
 * (a_outro 0) removes 3C-FD to base and then SpawnAvailableNPC(7) puts him at
 * wp_3c_hk, so the end of the Ebon Hawk tutorial showed two of him (round 18).
 */
describe('RemoveNPCFromPartyToBase', () => {
  let member: any;
  beforeEach(() => {
    member = { npcId: 7, isPM: true, save: jest.fn(() => ({ saved: true })), destroy: jest.fn(), container: {} };
    PartyManager.NPCS = { 7: { available: true, canSelect: true, template: { old: true } } } as any;
    PartyManager.party = [{ npcId: -1 } as any, member];
    PartyManager.Player = PartyManager.party[0] as any;
    PartyManager.CurrentMembers = [{ memberID: 7, isLeader: false }] as any;
    jest.spyOn(PartyManager, 'RebuildPortraitOrder').mockImplementation(() => undefined as any);
    Object.assign(GameState, { PartyManager, module: { area: { attachObject: jest.fn() } }, group: { creatures: { add: jest.fn() } } });
  });
  afterEach(() => jest.restoreAllMocks());

  test('the creature leaves the party and the area', () => {
    expect(PartyManager.RemoveNPCFromPartyToBase(7)).toBe(true);
    expect(PartyManager.party).not.toContain(member);
    expect(member.destroy).toHaveBeenCalledTimes(1);
    expect((GameState as any).module.area.attachObject).not.toHaveBeenCalled();
    expect(PartyManager.CurrentMembers).toEqual([]);
  });

  test('its data stays in the party table, still available', () => {
    PartyManager.RemoveNPCFromPartyToBase(7);
    expect(PartyManager.NPCS[7].template).toEqual({ saved: true });
    expect(PartyManager.NPCS[7].available).toBe(true);
  });

  test('an NPC not in the party is a failure that changes nothing', () => {
    PartyManager.party = [PartyManager.Player as any];
    expect(PartyManager.RemoveNPCFromPartyToBase(7)).toBe(false);
    expect(PartyManager.NPCS[7].template).toEqual({ old: true });
  });
});

describe('the opcodes', () => {
  const DEFS = fs.readFileSync(path.join(process.cwd(), 'src/nwscript/NWScriptDefK2.ts'), 'utf8');
  const body = (name: string) => { const at = DEFS.indexOf(`name: '${name}'`); const rest = DEFS.slice(at); return rest.slice(0, rest.indexOf('\n  },')); };

  test('RemoveNPCFromPartyToBase sends the NPC to base rather than leaving it in the world', () => {
    expect(body('RemoveNPCFromPartyToBase')).toMatch(/PartyManager\.RemoveNPCFromPartyToBase\(args\[0\]\)/);
  });

  test('SpawnAvailableNPC spawns only an available NPC ("from the list of available creatures")', () => {
    expect(body('SpawnAvailableNPC')).toMatch(/\.available/);
  });
});
