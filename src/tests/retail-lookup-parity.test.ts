import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Three defects the 82-module parity sweep (2026-09-19) surfaced, all of them
 * the engine failing to read what retail ships.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('subrace', () => {
  const source = read('module/ModuleCreature.ts');

  test('GetSubRace reports SubraceIndex, not the unset `subrace`', () => {
    // No retail UTC has a 'SubRace' field, so `subrace` stayed 0 and
    // GetSubRace answered 0 for all 279 subraced creatures in 22 modules.
    // getHP already switched on subraceIndex (Wookiee/Beast HP).
    expect(source).toContain('  getSubRace(){\n    // SUBRACE_* comes from');
    expect(source).toContain('return this.subraceIndex;');
    expect(source).not.toContain("hasField('SubRace')");
  });

  test('save writes the loaded SubraceIndex', () => {
    expect(source).toContain("new GFFField(GFFDataType.BYTE, 'SubraceIndex') ).setValue(this.subraceIndex);");
  });
});

describe('key-bif textures', () => {
  test('a TGA in the key table is loaded when no TPC exists', () => {
    // textures.bif holds many base-game textures as TGA + TXI. The key-bif
    // source only tried TPC, so 19 environment maps across 18 modules
    // (dxn_water03b and friends) resolved as missing.
    const source = read('loaders/TextureLoader.ts');
    const branch = source.slice(source.indexOf("case 'key-bif': {"), source.indexOf('  private loadTga('));
    expect(branch).toContain('ResourceLoader.searchKeyTable(ResourceTypes.tga, resref)');
    expect(branch).toContain("'key-bif-txi'");
  });
});

describe('sound templates', () => {
  test('a UTS cache miss falls back to loading the resource', () => {
    // 44 of 47 sound objects in 103PER were built from the GIT struct alone —
    // no tag, no sound files, volume 0 — because the UTS was not pre-cached.
    const source = read('module/ModuleSound.ts');
    expect(source).toContain('async load(){');
    expect(source).toContain("ResourceLoader.loadResource(ResourceTypes['uts'], this.getTemplateResRef())");
  });

  test('the area awaits the sound load before wiring its emitter', () => {
    const source = read('module/ModuleArea.ts');
    expect(source).toContain('await sound.load();\n        await sound.loadSound();');
  });
});
