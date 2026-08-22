import { describe, expect, test } from '@jest/globals';
import {
  captureCheckpointSnapshot,
  type CheckpointSnapshotInput,
} from '@/qa/CheckpointSnapshot';

function completeCheckpoint(): CheckpointSnapshotInput {
  return {
    module: '101PER',
    room: '101PER_01',
    playerId: 'player-1',
    partyIds: ['player-1', 'kreia-2'],
    inventory: [
      { itemId: 'medpac', quantity: 3 },
      { itemId: 'plasma-cutter', quantity: 1 },
    ],
    equipment: {
      rightHand: 'plasma-cutter',
      armor: null,
    },
    plotState: {
      peragusAwake: true,
      fuelDepotAccess: 2,
    },
    journal: [
      { questId: 'a_peragus_escape', stage: 30, state: 'active' },
    ],
    effects: [
      { effectId: 'stealth', sourceId: 'player-1', remainingSeconds: 12 },
    ],
    actions: [
      { actionId: 'open-door', targetId: 'door-18', state: 'queued' },
    ],
    saveStatus: 'saved',
  };
}

describe('checkpoint snapshots', () => {
  test('captures every required checkpoint domain without retaining mutable input state', () => {
    const input = completeCheckpoint();

    const snapshot = captureCheckpointSnapshot(input);

    expect(snapshot).toEqual(completeCheckpoint());
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.inventory)).toBe(true);
    expect(Object.isFrozen(snapshot.inventory[0])).toBe(true);

    input.inventory[0].quantity = 99;
    input.equipment.rightHand = null;

    expect(snapshot.inventory[0].quantity).toBe(3);
    expect(snapshot.equipment.rightHand).toBe('plasma-cutter');
  });

  test.each([
    ['module', (input: CheckpointSnapshotInput) => { input.module = ''; }],
    ['room', (input: CheckpointSnapshotInput) => { input.room = '  '; }],
    ['party member', (input: CheckpointSnapshotInput) => { input.partyIds = ['']; }],
    ['duplicate party member', (input: CheckpointSnapshotInput) => { input.partyIds = ['player-1', 'player-1']; }],
    ['inventory collection', (input: CheckpointSnapshotInput) => { input.inventory = null as never; }],
    ['inventory quantity', (input: CheckpointSnapshotInput) => { input.inventory = [{ itemId: 'medpac', quantity: 0 }]; }],
    ['non-finite plot state', (input: CheckpointSnapshotInput) => { input.plotState = { fuelDepotAccess: Number.NaN }; }],
    ['save status', (input: CheckpointSnapshotInput) => { input.saveStatus = 'unknown' as never; }],
  ])('rejects an invalid %s', (_field, mutate) => {
    const input = completeCheckpoint();
    mutate(input);

    expect(() => captureCheckpointSnapshot(input)).toThrow(/checkpoint/i);
  });
});
