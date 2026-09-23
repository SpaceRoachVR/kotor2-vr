import { describe, expect, test } from '@jest/globals';
import {
  groupLevelUpPowerChains,
  listLevelUpPowers,
  readPowerMinimumLevel,
  recommendLevelUpPowers,
  resolveLevelUpAllowances,
  resolveLevelUpSkillPoints,
  resolveLevelUpVitalityGain,
} from '@/game/kotor/menu/LevelUpRules';

/**
 * Values below are the retail TSL tables, read from the game's own BIFs:
 * featgain.2da, classpowergain.2da, classes.2da and spells.2da.
 */
const featGainJcn = [1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1];
const powerGainJcn = [2, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2];
const consular = {
  id: 4, hitdie: 6, forcedie: 8, skillpointbase: 2, spellcaster: true, primaryabil: 'WIS',
  featGainPoints: featGainJcn, spellGainPoints: powerGainJcn,
};
const soldier = {
  id: 0, hitdie: 10, forcedie: 0, skillpointbase: 1, spellcaster: false, primaryabil: 'CON',
  featGainPoints: [1, 1, 1, 1], spellGainPoints: [2, 2, 2, 2],
};

describe('what one level is worth', () => {
  test('an attribute point only at every fourth character level', () => {
    expect(resolveLevelUpAllowances({ characterClass: consular, newClassLevel: 3, newCharacterLevel: 3 }).attributePoints).toBe(0);
    expect(resolveLevelUpAllowances({ characterClass: consular, newClassLevel: 4, newCharacterLevel: 4 }).attributePoints).toBe(1);
    expect(resolveLevelUpAllowances({ characterClass: consular, newClassLevel: 8, newCharacterLevel: 8 }).attributePoints).toBe(1);
  });

  test('feat and power picks come from the new class level', () => {
    expect(resolveLevelUpAllowances({ characterClass: consular, newClassLevel: 2, newCharacterLevel: 2 }))
      .toEqual({ attributePoints: 0, featPicks: 0, powerPicks: 1 });
    expect(resolveLevelUpAllowances({ characterClass: consular, newClassLevel: 3, newCharacterLevel: 3 }))
      .toEqual({ attributePoints: 0, featPicks: 1, powerPicks: 2 });
  });

  test('a class that is not a Force user gets no power picks whatever the table says', () => {
    expect(resolveLevelUpAllowances({ characterClass: soldier, newClassLevel: 2, newCharacterLevel: 2 }).powerPicks).toBe(0);
  });

  test('levels past the end of the table give nothing rather than NaN', () => {
    expect(resolveLevelUpAllowances({ characterClass: soldier, newClassLevel: 30, newCharacterLevel: 30 }))
      .toEqual({ attributePoints: 0, featPicks: 0, powerPicks: 0 });
  });

  test('skill points are the class base plus the Intelligence modifier, at least one', () => {
    expect(resolveLevelUpSkillPoints(2, 14)).toBe(4);
    expect(resolveLevelUpSkillPoints(1, 8)).toBe(1);
    expect(resolveLevelUpSkillPoints(1, 10)).toBe(1);
    expect(resolveLevelUpSkillPoints(4, 13)).toBe(5);
  });

  test('vitality is the hit die plus Constitution; Force points the force die plus Wisdom', () => {
    expect(resolveLevelUpVitalityGain(consular, 12, 16)).toEqual({ hitPoints: 7, forcePoints: 11 });
    expect(resolveLevelUpVitalityGain(soldier, 14, 16)).toEqual({ hitPoints: 12, forcePoints: 0 });
    expect(resolveLevelUpVitalityGain({ hitdie: 6, forcedie: 8, spellcaster: true }, 1, 1))
      .toEqual({ hitPoints: 1, forcePoints: 3 });
  });
});

const row = (index: number, fields: Record<string, string>) => ({
  __index: index, usertype: '1', label: `POWER_${index}`, consular: '****', forcepriority: '0',
  prerequisites: '****', ...fields,
});
// Heal 10 (0), Improved Heal 28 (12, needs 10), Master Heal 134 (18, needs 10_28),
// Force Sight 176 (-1: scripts only), Throw Lightsaber 49 (0), Advanced Throw 4 (9, needs 49).
const spells = [
  row(4, { consular: '9', prerequisites: '49', forcepriority: '1', light_recom: '44', dark_recom: '50' }),
  row(10, { consular: '6', light_recom: '5', dark_recom: '5' }),
  row(28, { consular: '12', prerequisites: '10', forcepriority: '1', light_recom: '18' }),
  row(49, { consular: '0', light_recom: '43', dark_recom: '49' }),
  row(134, { consular: '18', prerequisites: '10_28', forcepriority: '2', light_recom: '24' }),
  row(176, { consular: '-1' }),
  { __index: 183, usertype: '1', label: 'XXXFORCE_POWER_IMPROVED_BEAST_CONTROL', consular: '0' },
  { __index: 200, usertype: '2', label: 'SPECIAL', consular: '0' },
];

describe('which Force powers a level can buy', () => {
  test('0 means from the first level, -1 and blanks mean never by level', () => {
    expect(readPowerMinimumLevel(spells[3], 'consular')).toBe(1);
    expect(readPowerMinimumLevel(spells[5], 'consular')).toBeUndefined();
    expect(readPowerMinimumLevel({ consular: '****' }, 'consular')).toBeUndefined();
    expect(readPowerMinimumLevel(spells[1], undefined)).toBeUndefined();
  });

  test('a power is selectable at its level with every prerequisite known', () => {
    const known = new Set([49]);
    const list = listLevelUpPowers({ rows: spells, classColumn: 'consular', characterLevel: 9, isKnown: (id) => known.has(id) });
    const state = Object.fromEntries(list.map((entry) => [entry.id, entry.state]));
    expect(state).toEqual({ 4: 'selectable', 10: 'selectable', 28: 'unavailable', 49: 'known', 134: 'unavailable' });
  });

  test('both halves of a two-part prerequisite are required', () => {
    const known = new Set([10]);
    const list = listLevelUpPowers({ rows: spells, classColumn: 'consular', characterLevel: 20, isKnown: (id) => known.has(id) });
    expect(list.find((entry) => entry.id === 134)?.state).toBe('unavailable');
    expect(list.find((entry) => entry.id === 28)?.state).toBe('selectable');
  });

  test('script-only, cut and non-power rows are not listed unless already known', () => {
    const ids = listLevelUpPowers({ rows: spells, classColumn: 'consular', characterLevel: 20, isKnown: () => false }).map((entry) => entry.id);
    expect(ids).not.toContain(176);
    expect(ids).not.toContain(183);
    expect(ids).not.toContain(200);
    const withSight = listLevelUpPowers({ rows: spells, classColumn: 'consular', characterLevel: 20, isKnown: (id) => id === 176 });
    expect(withSight.find((entry) => entry.id === 176)?.state).toBe('known');
  });

  test('a class with no column learns nothing by level', () => {
    expect(listLevelUpPowers({ rows: spells, classColumn: undefined, characterLevel: 20, isKnown: () => false })).toEqual([]);
  });

  test('powers are grouped base, improved, master', () => {
    const list = listLevelUpPowers({ rows: spells, classColumn: 'consular', characterLevel: 20, isKnown: () => false });
    const groups = groupLevelUpPowerChains(list).map((group) => group.map((entry) => entry?.id));
    expect(groups).toContainEqual([10, 28, 134]);
    expect(groups).toContainEqual([49, 4]);
    expect(groups.flat().sort((a, b) => Number(a) - Number(b))).toEqual([4, 10, 28, 49, 134]);
  });

  test('recommendations follow the side of the Force, then table order', () => {
    const list = listLevelUpPowers({ rows: spells, classColumn: 'consular', characterLevel: 9, isKnown: (id) => id === 49 });
    expect(recommendLevelUpPowers(list, 1, true)).toEqual([10]);
    expect(recommendLevelUpPowers(list, 2, true)).toEqual([10, 4]);
    expect(recommendLevelUpPowers(list, 5, false)).toEqual([10, 4]);
    expect(recommendLevelUpPowers(list, 0, true)).toEqual([]);
  });
});
