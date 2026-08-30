import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  snapshotCharGenProgression,
  validateCharGenProgression,
} from '@/game/kotor/menu/CharGenProgression';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

function buildCreature(overrides: Record<string, unknown> = {}) {
  return {
    str: 16,
    dex: 14,
    con: 12,
    wis: 10,
    int: 8,
    cha: 14,
    skills: Array.from({ length: 8 }, (_, rank) => ({ rank })),
    feats: [{ id: 4 }, { id: 9 }],
    classes: [{ spellcaster: false, spells: [] as Array<{ id: number }> }],
    forcePoints: 0,
    maxForcePoints: 0,
    currentForce: 0,
    ...overrides,
  };
}

describe('character-generation progression handoff', () => {
  test('captures every created-character value consumed by normal game systems', () => {
    expect(snapshotCharGenProgression(buildCreature())).toEqual({
      abilities: { str: 16, dex: 14, con: 12, wis: 10, int: 8, cha: 14 },
      skillRanks: [0, 1, 2, 3, 4, 5, 6, 7],
      featIds: [4, 9],
      classKnownPowerIds: [[]],
      forcePoints: 0,
      maxForcePoints: 0,
      currentForce: 0,
    });
  });

  test('retains known powers for spellcaster classes', () => {
    const creature = buildCreature({
      classes: [{ spellcaster: true, spells: [{ id: 42 }, { id: 53 }] }],
      forcePoints: 12,
      maxForcePoints: 20,
    });

    expect(snapshotCharGenProgression(creature).classKnownPowerIds).toEqual([[42, 53]]);
  });

  test('rejects malformed skill ranks and a Force pool on a pregame non-spellcaster', () => {
    expect(validateCharGenProgression(buildCreature({ skills: [{ rank: 0 }] }))).toEqual({
      valid: false,
      reason: 'invalid-skill-ranks',
    });
    expect(validateCharGenProgression(buildCreature({ forcePoints: 1, maxForcePoints: 1 }))).toEqual({
      valid: false,
      reason: 'invalid-pregame-force-state',
    });
  });

  test('serializes Constitution independently from Strength and creates an explicit zero max Force pool', () => {
    const creatureSource = read('src/module/ModuleCreature.ts');
    const managerSource = read('src/managers/CharGenManager.ts');

    expect(creatureSource).toMatch(/new GFFField\(\s*GFFDataType\.BYTE, 'Con'\)\s*\)\.setValue\(this\.con\)/);
    expect(managerSource).toMatch(/new GFFField\(\s*GFFDataType\.WORD, 'MaxForcePoints'\)\s*\)\.setValue\(0\)/);
  });
});
