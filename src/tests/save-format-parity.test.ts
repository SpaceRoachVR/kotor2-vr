import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Field types our engine writes into a save, pinned to what retail KOTOR II
 * writes. The expectations come from tools/parity/save_schema.py, which walks
 * every GFF in a retail SAVEGAME.sav and one our engine wrote and diffs the
 * (struct path, label) -> type schemas.
 *
 * A wrong type is not cosmetic: GFFField.setValue stores whatever it is given,
 * so a BYTE written as FLOAT, or a CExoLocString written as FLOAT, reaches disk
 * in a shape retail tooling (and a later load) reads as a different value.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('save field types match retail saves', () => {
  test.each([
    ['module/ModuleSound.ts', 'BYTE', 'Times'],
    ['module/ModuleSound.ts', 'BYTE', 'Volume'],
    ['module/ModuleSound.ts', 'BYTE', 'VolumeVrtn'],
    ['module/ModuleTrigger.ts', 'INT', 'Type'],
    ['module/ModuleWaypoint.ts', 'CEXOLOCSTRING', 'LocalizedName'],
    ['module/ModuleArea.ts', 'BYTE', 'CurrentWeather'],
    ['module/ModuleArea.ts', 'DWORD', 'StealthXPLoss'],
    ['module/ModuleArea.ts', 'BYTE', 'StealthXPEnabled'],
    ['module/ModuleCreature.ts', 'BYTE', 'Hologram'],
    ['module/ModuleCreature.ts', 'SHORT', 'willbonus'],
    ['managers/PartyManager.ts', 'BYTE', 'PT_CHEAT_USED'],
  ])('%s writes %s %s', (file, type, label) => {
    // PartyManager writes `addField(new GFFField(...))` without the inner spaces.
    expect(read(file).replace(/addField\(new/g, 'addField( new').replace(/\)\)\.setValue/g, ') ).setValue')).toContain(`new GFFField(GFFDataType.${type}, '${label}') ).setValue(`);
  });

  test('ModuleCreature.save writes refbonus once and willbonus once', () => {
    const source = read('module/ModuleCreature.ts');
    const saves = (label: string) =>
      source.split(`GFFDataType.SHORT, '${label}') ).setValue(`).length - 1;
    expect(saves('refbonus')).toBe(1);
    expect(saves('willbonus')).toBe(1);
  });
});

describe('creature template fields that were saved but never loaded', () => {
  const source = read('module/ModuleCreature.ts');

  test.each(['fortbonus', 'refbonus', 'willbonus'])('%s is read back', (label) => {
    expect(source).toContain(`hasField('${label}')`);
  });

  test('BodyVariation loads into bodyVariation, not bodyBag', () => {
    expect(source).toContain("this.bodyVariation = this.template.getFieldByLabel('BodyVariation').getValue();");
    expect(source).not.toContain("this.bodyBag = this.template.getFieldByLabel('BodyVariation').getValue();");
    expect(source).toContain("new GFFField(GFFDataType.BYTE, 'BodyVariation') ).setValue(this.bodyVariation);");
  });
});

describe('creature force points from a retail template', () => {
  test('MaxForcePoints falls back to base ForcePoints when the template has none', () => {
    // Retail UTCs have ForcePoints and CurrentForce but no MaxForcePoints
    // (checked with PyKotor on templates.bif); tools/parity reported null max FP
    // on every Peragus creature.
    const source = read('module/ModuleCreature.ts');
    expect(source).toContain('this.maxForcePoints = this.forcePoints || 0;');
  });
});
