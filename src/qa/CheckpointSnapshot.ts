export type CheckpointSaveStatus = 'unsaved' | 'saving' | 'saved' | 'load-failed';

export interface CheckpointInventoryItem {
  itemId: string;
  quantity: number;
}

export interface CheckpointJournalEntry {
  questId: string;
  stage: number;
  state: string;
}

export interface CheckpointEffect {
  effectId: string;
  sourceId: string | null;
  remainingSeconds: number | null;
}

export interface CheckpointAction {
  actionId: string;
  targetId: string | null;
  state: string;
}

export type CheckpointPlotValue = string | number | boolean | null;

export interface CheckpointSnapshotInput {
  module: string;
  room: string;
  playerId: string;
  partyIds: string[];
  inventory: CheckpointInventoryItem[];
  equipment: Record<string, string | null>;
  plotState: Record<string, CheckpointPlotValue>;
  journal: CheckpointJournalEntry[];
  effects: CheckpointEffect[];
  actions: CheckpointAction[];
  saveStatus: CheckpointSaveStatus;
}

export interface CheckpointSnapshot {
  readonly module: string;
  readonly room: string;
  readonly playerId: string;
  readonly partyIds: readonly string[];
  readonly inventory: readonly Readonly<CheckpointInventoryItem>[];
  readonly equipment: Readonly<Record<string, string | null>>;
  readonly plotState: Readonly<Record<string, CheckpointPlotValue>>;
  readonly journal: readonly Readonly<CheckpointJournalEntry>[];
  readonly effects: readonly Readonly<CheckpointEffect>[];
  readonly actions: readonly Readonly<CheckpointAction>[];
  readonly saveStatus: CheckpointSaveStatus;
}

const SAVE_STATUSES = new Set<CheckpointSaveStatus>(['unsaved', 'saving', 'saved', 'load-failed']);

/**
 * Captures a complete, immutable checkpoint from a caller-provided engine state.
 * The caller owns engine reads; this boundary validates and detaches evidence so
 * later mutation of game state cannot rewrite a checkpoint already recorded.
 */
export function captureCheckpointSnapshot(input: CheckpointSnapshotInput): CheckpointSnapshot {
  assertRecord(input, 'input');
  assertNonEmptyString(input.module, 'module');
  assertNonEmptyString(input.room, 'room');
  assertNonEmptyString(input.playerId, 'player id');
  assertStringArray(input.partyIds, 'party ids');
  assertArray(input.inventory, 'inventory');
  assertArray(input.journal, 'journal');
  assertArray(input.effects, 'effects');
  assertArray(input.actions, 'actions');

  if (!input.partyIds.includes(input.playerId)) {
    throw invalidCheckpoint('party ids must include the player id');
  }
  if (new Set(input.partyIds).size !== input.partyIds.length) {
    throw invalidCheckpoint('party ids must not contain duplicates');
  }

  const snapshot: CheckpointSnapshot = {
    module: input.module,
    room: input.room,
    playerId: input.playerId,
    partyIds: freezeArray(input.partyIds.map((partyId) => {
      assertNonEmptyString(partyId, 'party id');
      return partyId;
    })),
    inventory: freezeArray(input.inventory.map((item, index) => freezeInventoryItem(item, index))),
    equipment: freezeRecord(input.equipment, 'equipment', (value, key) => {
      assertNonEmptyString(key, 'equipment slot');
      if (value !== null) {
        assertNonEmptyString(value, `equipment item for ${key}`);
      }
      return value;
    }),
    plotState: freezeRecord(input.plotState, 'plot state', (value, key) => {
      assertNonEmptyString(key, 'plot state key');
      if (!isCheckpointPlotValue(value)) {
        throw invalidCheckpoint(`plot state value for ${key} must be a scalar`);
      }
      return value;
    }),
    journal: freezeArray(input.journal.map((entry, index) => freezeJournalEntry(entry, index))),
    effects: freezeArray(input.effects.map((effect, index) => freezeEffect(effect, index))),
    actions: freezeArray(input.actions.map((action, index) => freezeAction(action, index))),
    saveStatus: validateSaveStatus(input.saveStatus),
  };

  return Object.freeze(snapshot);
}

function freezeInventoryItem(item: CheckpointInventoryItem, index: number): Readonly<CheckpointInventoryItem> {
  assertRecord(item, `inventory item ${index}`);
  assertNonEmptyString(item.itemId, `inventory item ${index} id`);
  assertPositiveInteger(item.quantity, `inventory item ${index} quantity`);
  return Object.freeze({ itemId: item.itemId, quantity: item.quantity });
}

function freezeJournalEntry(entry: CheckpointJournalEntry, index: number): Readonly<CheckpointJournalEntry> {
  assertRecord(entry, `journal entry ${index}`);
  assertNonEmptyString(entry.questId, `journal entry ${index} quest id`);
  assertInteger(entry.stage, `journal entry ${index} stage`);
  assertNonEmptyString(entry.state, `journal entry ${index} state`);
  return Object.freeze({ questId: entry.questId, stage: entry.stage, state: entry.state });
}

function freezeEffect(effect: CheckpointEffect, index: number): Readonly<CheckpointEffect> {
  assertRecord(effect, `effect ${index}`);
  assertNonEmptyString(effect.effectId, `effect ${index} id`);
  if (effect.sourceId !== null) {
    assertNonEmptyString(effect.sourceId, `effect ${index} source id`);
  }
  if (effect.remainingSeconds !== null && (!Number.isFinite(effect.remainingSeconds) || effect.remainingSeconds < 0)) {
    throw invalidCheckpoint(`effect ${index} remaining seconds must be non-negative or null`);
  }
  return Object.freeze({
    effectId: effect.effectId,
    sourceId: effect.sourceId,
    remainingSeconds: effect.remainingSeconds,
  });
}

function freezeAction(action: CheckpointAction, index: number): Readonly<CheckpointAction> {
  assertRecord(action, `action ${index}`);
  assertNonEmptyString(action.actionId, `action ${index} id`);
  if (action.targetId !== null) {
    assertNonEmptyString(action.targetId, `action ${index} target id`);
  }
  assertNonEmptyString(action.state, `action ${index} state`);
  return Object.freeze({ actionId: action.actionId, targetId: action.targetId, state: action.state });
}

function freezeRecord<T>(
  value: Record<string, T>,
  field: string,
  validateValue: (entry: T, key: string) => T
): Readonly<Record<string, T>> {
  assertRecord(value, field);
  const copy: Record<string, T> = Object.create(null) as Record<string, T>;
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = validateValue(entry, key);
  }
  return Object.freeze(copy);
}

function freezeArray<T>(value: T[]): readonly T[] {
  return Object.freeze(value);
}

function validateSaveStatus(value: CheckpointSaveStatus): CheckpointSaveStatus {
  if (!SAVE_STATUSES.has(value)) {
    throw invalidCheckpoint('save status is unsupported');
  }
  return value;
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  assertArray(value, field);
}

function assertArray(value: unknown, field: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw invalidCheckpoint(`${field} must be an array`);
  }
}

function assertRecord(value: unknown, field: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidCheckpoint(`${field} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidCheckpoint(`${field} must be a non-empty string`);
  }
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalidCheckpoint(`${field} must be a positive integer`);
  }
}

function assertInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalidCheckpoint(`${field} must be an integer`);
  }
}

function isCheckpointPlotValue(value: unknown): value is CheckpointPlotValue {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}

function invalidCheckpoint(message: string): TypeError {
  return new TypeError(`Invalid checkpoint snapshot: ${message}`);
}
