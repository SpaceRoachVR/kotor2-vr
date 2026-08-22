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
    expect(Object.isFrozen(snapshot.partyIds)).toBe(true);
    expect(Object.isFrozen(snapshot.plotState)).toBe(true);
    expect(Object.isFrozen(snapshot.journal)).toBe(true);
    expect(Object.isFrozen(snapshot.journal[0])).toBe(true);
    expect(Object.isFrozen(snapshot.effects)).toBe(true);
    expect(Object.isFrozen(snapshot.effects[0])).toBe(true);
    expect(Object.isFrozen(snapshot.actions)).toBe(true);
    expect(Object.isFrozen(snapshot.actions[0])).toBe(true);

    input.inventory[0].quantity = 99;
    input.equipment.rightHand = null;
    input.partyIds[0] = 'mutated-player';
    input.plotState.peragusAwake = false;
    input.journal[0].state = 'completed';
    input.effects[0].remainingSeconds = 0;
    input.actions[0].state = 'executed';

    expect(snapshot.inventory[0].quantity).toBe(3);
    expect(snapshot.equipment.rightHand).toBe('plasma-cutter');
    expect(snapshot.partyIds[0]).toBe('player-1');
    expect(snapshot.plotState.peragusAwake).toBe(true);
    expect(snapshot.journal[0].state).toBe('active');
    expect(snapshot.effects[0].remainingSeconds).toBe(12);
    expect(snapshot.actions[0].state).toBe('queued');
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
