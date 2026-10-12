import { describe, expect, test } from '@jest/globals';
import {
  chooseLoadedPlayerCharacterRecord,
  findLivePlayerCharacter,
  isSavedControlledPlayerCharacter,
  refreshPlayerCharacterRecord,
} from '@/managers/PlayerCharacterRecord';

/**
 * pc.utc was the Exile as she was at character creation: every save this
 * engine wrote put her at (54.65, 79.62, 1.8), the 001EBO prologue start.
 */
describe('refreshPlayerCharacterRecord', () => {
  const creature = (isPlayer: boolean, record: string) => ({ isPlayer, save: () => record });

  test('a save writes the Exile as she is now', () => {
    const exile = creature(true, 'exile-now');
    expect(refreshPlayerCharacterRecord('exile-at-chargen' as string, exile, [exile])).toBe('exile-now');
  });

  test('while a companion is controlled, the Exile follower is the record', () => {
    const atton = creature(false, 'atton');
    const exile = creature(true, 'exile-following');
    expect(findLivePlayerCharacter(atton, [atton, exile])).toBe(exile);
    expect(refreshPlayerCharacterRecord('exile-at-chargen' as string, atton, [atton, exile])).toBe('exile-following');
  });

  test('with the Exile out of the world, the previous record stands', () => {
    const t3 = creature(false, 't3m4');
    expect(refreshPlayerCharacterRecord('exile-before-errand' as string, t3, [t3])).toBe('exile-before-errand');
  });

  test('a snapshot that throws keeps the previous record', () => {
    const errors: unknown[] = [];
    const broken = { isPlayer: true, save: (): string => { throw new Error('no model'); } };
    expect(refreshPlayerCharacterRecord('previous' as string, broken, [broken], (e) => errors.push(e))).toBe('previous');
    expect(errors).toHaveLength(1);
  });
});

describe('loading the Exile record', () => {
  test('the Exile is identified by tag, since engine saves always write IsPC 0', () => {
    const companions = ['atton', 'T3M4', 'kreia', ''];
    expect(isSavedControlledPlayerCharacter(0, '', companions)).toBe(true);
    expect(isSavedControlledPlayerCharacter(0, 'Atton', companions)).toBe(false);
    expect(isSavedControlledPlayerCharacter(0, 't3m4', companions)).toBe(false);
    expect(isSavedControlledPlayerCharacter(1, 'atton', companions)).toBe(true);
    expect(isSavedControlledPlayerCharacter(0, 'some_custom_pc_tag', companions)).toBe(true);
  });

  test('a saved Exile beats a stale pc.utc', () => {
    expect(chooseLoadedPlayerCharacterRecord('saved-exile', true, 'stale-pc')).toBe('saved-exile');
  });

  test('pc.utc stands in when a companion was being controlled', () => {
    expect(chooseLoadedPlayerCharacterRecord('saved-atton', false, 'pc')).toBe('pc');
    expect(chooseLoadedPlayerCharacterRecord('saved-atton', false, undefined)).toBe('saved-atton');
  });
});
