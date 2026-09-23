import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { CharGenClasses, TSLCharGenClasses, getCharGenClasses } from '@/game/CharGenClasses';
import { GameEngineType } from '@/enums/engine/GameEngineType';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/**
 * TSL character creation used KotOR I's class table, so the Exile started as a
 * Scoundrel, Scout or Soldier. Values below are retail TSL data: classes.2da
 * rows 3 Guardian (d10), 4 Consular (d6), 5 Sentinel (d8); name strrefs 353-355;
 * dialog.tlk 48031-48033 are the character-creation blurbs.
 */
describe('TSL class-selection slots are the three Jedi classes', () => {
  const slots = [0, 1, 2, 3, 4, 5];

  test('each game gets its own table', () => {
    expect(getCharGenClasses(GameEngineType.TSL)).toBe(TSLCharGenClasses);
    expect(getCharGenClasses(GameEngineType.KOTOR)).toBe(CharGenClasses);
  });

  test('every TSL slot is a Jedi class, and none is a KotOR I class', () => {
    expect(slots.map((slot) => TSLCharGenClasses[slot].id)).toEqual([4, 5, 3, 3, 5, 4]);
  });

  test('the class follows the body size KotOR I used for the same hit die', () => {
    // K1: small Scoundrel d6, medium Scout d8, large Soldier d10.
    const k1ToTsl: Record<number, number> = { 2: 4, 1: 5, 0: 3 };
    for (const slot of slots) {
      expect(TSLCharGenClasses[slot].id).toBe(k1ToTsl[CharGenClasses[slot].id]);
      expect(TSLCharGenClasses[slot].appearances).toBe(CharGenClasses[slot].appearances);
    }
  });

  test('names and descriptions are TSL\'s own strings, genders unchanged', () => {
    const names: Record<number, number> = { 3: 353, 4: 354, 5: 355 };
    const blurbs: Record<number, number> = { 3: 48033, 4: 48031, 5: 48032 };
    for (const slot of slots) {
      const entry = TSLCharGenClasses[slot];
      expect(entry.strings.name).toBe(names[entry.id]);
      expect(entry.strings.description).toBe(blurbs[entry.id]);
      expect(entry.strings.gender).toBe(CharGenClasses[slot].strings.gender);
    }
  });

  test('each slot offers fifteen distinct bodies', () => {
    for (const slot of slots) {
      expect(new Set(CharGenClasses[slot].appearances).size).toBe(15);
    }
  });
});

describe('character creation reads the class by id, not by slot', () => {
  test('templates take their class from the slot table', () => {
    const manager = read('src/managers/CharGenManager.ts');
    expect(manager).toMatch(/const classId = slotClass\.id;/);
    expect(manager).not.toMatch(/classId = 2;/);
  });

  test('quick creation looks up the selected class id in both games', () => {
    for (const file of ['src/game/kotor/menu/CharGenQuickOrCustom.ts', 'src/game/tsl/menu/CharGenQuickOrCustom.ts']) {
      const source = read(file);
      expect(source).toMatch(/SWRuleSet\.classes\[GameState\.CharGenManager\.getSelectedClassId\(\)\]/);
      expect(source).not.toMatch(/SWRuleSet\.classes\[GameState\.CharGenManager\.selectedClass\]/);
    }
  });

  test('no screen indexes KotOR I\'s table directly any more', () => {
    for (const file of ['src/game/kotor/menu/CharGenClass.ts', 'src/game/kotor/menu/CharGenMain.ts',
      'src/game/kotor/menu/CharGenPortCust.ts', 'src/game/tsl/menu/CharGenPortCust.ts']) {
      expect(read(file)).not.toMatch(/CharGenClasses\[/);
    }
  });

  test('every Play route sets starting vitality and Force points before the character is saved', () => {
    for (const file of ['src/game/kotor/menu/CharGenCustomPanel.ts', 'src/game/kotor/menu/CharGenQuickPanel.ts',
      'src/game/tsl/menu/CharGenQuickPanel.ts']) {
      const source = read(file);
      const force = source.indexOf('applyStartingVitality()');
      const save = source.indexOf('PlayerTemplate = GameState.CharGenManager.selectedCreature.save()');
      expect(force).toBeGreaterThan(-1);
      expect(save).toBeGreaterThan(force);
    }
  });
});

describe('starting vitality comes from the class and Constitution', () => {
  const manager = read('src/managers/CharGenManager.ts');

  test('it uses the per-level rule: hit die plus Constitution, Force die plus Wisdom', () => {
    expect(manager).toContain('return resolveLevelUpVitalityGain(characterClass, creature.con, creature.wis);');
  });

  test('base, maximum and current vitality are all set, so the character starts full', () => {
    expect(manager).toMatch(/creature\.hitPoints = start\.hitPoints;\s*creature\.maxHitPoints = start\.hitPoints;\s*creature\.currentHitPoints = start\.hitPoints;/);
  });

  test('the character-creation summary shows it', () => {
    expect(read('src/game/kotor/menu/CharGenMain.ts')).toContain('this.LBL_VIT?.setText(String(start.hitPoints))');
  });
});
