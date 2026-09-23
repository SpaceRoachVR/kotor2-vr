import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveBaseSavingThrow, savingThrowEffectBonus, SavingThrow, SAVING_THROW_TYPE_ALL,
} from '@/combat/SavingThrows';

/**
 * Saving throws against numbers a retail SAVEGAME.sav stores (read with
 * PyKotor from saves/000002 - Game1, 101PER GIT). The stored
 * FortSaveThrow/RefSaveThrow/WillSaveThrow is class base + template bonus +
 * ability modifier + autobalance (+ gear); ModuleObject's rolls add the ability
 * modifier and autobalance, so the base here is the other three terms.
 */
const mod = (score: number) => Math.floor((score - 10) / 2);

describe('retail save totals decompose into the engine base save', () => {
  test.each([
    // tag, class saves (fort/ref/will from the class savingthrowtable), ability mods, stored totals
    ['kreia', [3, 2, 3], [3, 3, 3], [6, 5, 6]],
    ['t3m4', [1, 3, 1], [2, 2, 0], [3, 5, 1]],
  ])('%s', (_tag, classSaves, abilityMods, stored) => {
    for (let i = 0; i < 3; i++) {
      const base = resolveBaseSavingThrow({ classSaves: [classSaves[i]], templateBonus: 0, effectBonus: 0 });
      expect(base + abilityMods[i]).toBe(stored[i]);
    }
  });

  test('multiclass saves add across classes, and the template bonus adds on top', () => {
    expect(resolveBaseSavingThrow({ classSaves: [2, 3], templateBonus: 4, effectBonus: 0 })).toBe(9);
  });

  test('non-finite inputs count as zero rather than poisoning the total', () => {
    expect(resolveBaseSavingThrow({ classSaves: [NaN, 2], templateBonus: undefined as never, effectBonus: 1 })).toBe(3);
  });

  test('ability modifier helper matches d20', () => {
    expect([mod(8), mod(10), mod(16), mod(3)]).toEqual([-1, 0, 3, -4]);
  });
});

describe('saving throw effects', () => {
  const effects = [
    { amount: 2, save: SavingThrow.ALL, saveType: SAVING_THROW_TYPE_ALL },
    { amount: 3, save: SavingThrow.WILL, saveType: SAVING_THROW_TYPE_ALL },
    { amount: -1, save: SavingThrow.FORTITUDE, saveType: SAVING_THROW_TYPE_ALL },
    { amount: 5, save: SavingThrow.FORTITUDE, saveType: 7 }, // e.g. vs poison only
  ];

  test('an ALL effect applies to every save; a targeted one only to its own', () => {
    expect(savingThrowEffectBonus(effects, SavingThrow.REFLEX)).toBe(2);
    expect(savingThrowEffectBonus(effects, SavingThrow.WILL)).toBe(5);
    expect(savingThrowEffectBonus(effects, SavingThrow.FORTITUDE)).toBe(1);
  });

  test('a type-limited effect counts only for a roll of that type', () => {
    expect(savingThrowEffectBonus(effects, SavingThrow.FORTITUDE, 7)).toBe(6);
  });
});

describe('engine wiring', () => {
  const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

  test('ModuleCreature derives its saves instead of returning the stored field', () => {
    const source = read('module/ModuleCreature.ts');
    expect(source).toContain('getFortitudeSave(saveType: number = SAVING_THROW_TYPE_ALL): number {');
    expect(source).toContain('resolveBaseSavingThrow({');
    expect(source).toContain("'FortSaveThrow') ).setValue(this.getSavingThrowTotal(SavingThrow.FORTITUDE))");
  });

  test('save rolls pass the save type through to the base save', () => {
    const source = read('module/ModuleObject.ts');
    expect(source).toContain('(roll + this.getFortitudeSave(nSaveType) + bonus) >= nDC');
    expect(source).toContain('(roll + this.getReflexSave(nSaveType) + bonus) >= nDC');
    expect(source).toContain('(roll + this.getWillSave(nSaveType) + bonus) >= nDC');
  });

  test.each(['GetFortitudeSavingThrow', 'GetWillSavingThrow', 'GetReflexSavingThrow'])('%s is implemented', (name) => {
    const source = read('nwscript/NWScriptDefK1.ts');
    const at = source.indexOf(`name: "${name}"`);
    expect(source.slice(at, at + 900)).toContain('getSavingThrowTotal(');
  });
});
