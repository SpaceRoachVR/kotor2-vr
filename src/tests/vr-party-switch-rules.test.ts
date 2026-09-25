import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { buildPartySwitchEntries, PLAYER_SWITCH_ENTRY_ID } from '@/vr/runtime/VRPartySwitchRules';

const exile = { id: '1', name: 'Torm Hobaar', npcId: -1, isPlayer: true, portrait: 'po_pmhh' };
const atton = { id: '2', name: 'Atton', npcId: 0, isPlayer: false, portrait: 'po_patton' };
const t3 = { id: '3', name: 'T3-M4', npcId: 8, isPlayer: false, portrait: 'po_pt3m4' };

describe('buildPartySwitchEntries', () => {
  test('with the Exile in control, every companion is offered as a possession target', () => {
    const entries = buildPartySwitchEntries([exile, atton, t3], 'Torm Hobaar');
    expect(entries).toEqual([
      { id: '2', label: 'Atton', icon: 'po_patton', npcId: 0 },
      { id: '3', label: 'T3-M4', icon: 'po_pt3m4', npcId: 8 },
    ]);
  });

  test('with a companion in control, the Exile is offered by her recorded name', () => {
    // 106PER Hangar Control: T3-M4 possessed, the Exile not in the world.
    const entries = buildPartySwitchEntries([t3, atton], 'Torm Hobaar', 'po_pmhh');
    expect(entries).toEqual([
      { id: '2', label: 'Atton', icon: 'po_patton', npcId: 0 },
      { id: PLAYER_SWITCH_ENTRY_ID, label: 'Torm Hobaar', icon: 'po_pmhh', npcId: -1 },
    ]);
  });

  test('the leader is never offered to themselves, and an unnamed Exile is not offered', () => {
    expect(buildPartySwitchEntries([t3, atton], '')).toEqual([{ id: '2', label: 'Atton', icon: 'po_patton', npcId: 0 }]);
    expect(buildPartySwitchEntries([exile], 'Torm Hobaar')).toEqual([]);
    expect(buildPartySwitchEntries([], 'Torm Hobaar')).toEqual([]);
  });

  test('the wheel snapshot possesses through SwitchPlayerCharacter, not SwitchLeaderAtIndex', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    const start = source.indexOf('function snapshotVRPartyMembers()');
    const body = source.slice(start, source.indexOf('function resolveVRCombatWeaponMode(', start));
    expect(body).toContain('buildPartySwitchEntries(');
    expect(body).toContain('GameState.PartyManager.SwitchPlayerCharacter(entry.npcId, true)');
    expect(body).not.toContain('SwitchLeaderAtIndex');
  });
});
