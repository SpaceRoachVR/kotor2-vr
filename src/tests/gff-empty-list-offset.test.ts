import { describe, expect, test } from '@jest/globals';
import { GFFObject } from '@/resource/GFFObject';
import { GFFField } from '@/resource/GFFField';
import { GFFStruct } from '@/resource/GFFStruct';
import { GFFDataType } from '@/enums/resource/GFFDataType';

/**
 * The GFF writer emitted every EMPTY list with a field offset of 0xFFFFFFFF.
 * BioWare's writers (and PyKotor's) point an empty list at a 4-byte zero count
 * in the list-indices block instead, and readers that follow the spec reject
 * the sentinel as out of bounds. Found by the retail parity tooling: PyKotor
 * could read the GITs in a retail save but refused every GIT our engine had
 * saved, over 446 empty VarTable/ActionList/EffectList/ItemList fields.
 */
function readUInt32(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(offset, true);
}

describe('GFF export of empty lists', () => {
  const gff = new GFFObject();
  gff.FileType = 'GIT ';
  gff.RootNode.addField(new GFFField(GFFDataType.LIST, 'EmptyList'));
  const full = gff.RootNode.addField(new GFFField(GFFDataType.LIST, 'FullList'));
  const child = new GFFStruct(7);
  child.addField(new GFFField(GFFDataType.INT, 'Value')).setValue(42);
  full.addChildStruct(child);

  const buffer = gff.getExportBuffer();
  const fieldsOffset = readUInt32(buffer, 16);
  const fieldCount = readUInt32(buffer, 20);
  const labelsOffset = readUInt32(buffer, 24);
  const listIndicesOffset = readUInt32(buffer, 48);
  const listIndicesSize = readUInt32(buffer, 52);

  const listOffsetFor = (label: string): number => {
    for (let i = 0; i < fieldCount; i++) {
      const base = fieldsOffset + i * 12;
      const labelIndex = readUInt32(buffer, base + 4);
      const labelBytes = buffer.slice(labelsOffset + labelIndex * 16, labelsOffset + labelIndex * 16 + 16);
      const name = String.fromCharCode(...labelBytes).replace(/\0+$/, '');
      if (name === label) return readUInt32(buffer, base + 8);
    }
    throw new Error(`no field ${label}`);
  };

  test('an empty list points inside the list-indices block at a zero count', () => {
    const offset = listOffsetFor('EmptyList');
    expect(offset).not.toBe(0xFFFFFFFF);
    expect(offset + 4).toBeLessThanOrEqual(listIndicesSize);
    expect(readUInt32(buffer, listIndicesOffset + offset)).toBe(0);
  });

  test('a non-empty list still round-trips its struct', () => {
    const offset = listOffsetFor('FullList');
    expect(readUInt32(buffer, listIndicesOffset + offset)).toBe(1);
    const reloaded = new GFFObject(buffer);
    expect(reloaded.RootNode.getFieldByLabel('EmptyList').getChildStructs()).toHaveLength(0);
    const structs = reloaded.RootNode.getFieldByLabel('FullList').getChildStructs();
    expect(structs).toHaveLength(1);
    expect(structs[0].getFieldByLabel('Value').getValue()).toBe(42);
  });
});

describe('ModuleArea GIT CurrentWeather', () => {
  // Retail saves write CurrentWeather as a BYTE (checked against a retail
  // SAVEGAME.sav with PyKotor); ModuleArea.save() wrote it as a LIST, which put
  // a weather enum value where a list-indices offset belongs.
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleArea.ts'), 'utf8');

  test('is written as BYTE', () => {
    expect(source).toContain("new GFFField(GFFDataType.BYTE, 'CurrentWeather')");
    expect(source).not.toContain("new GFFField(GFFDataType.LIST, 'CurrentWeather')");
  });
});
