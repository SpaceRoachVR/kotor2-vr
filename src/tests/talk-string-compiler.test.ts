import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { compileTalkString, stripAuthoringMetadata } from '@/resource/TalkStringCompiler';

/**
 * Object names never went through the token and comment handling that dialogue
 * has, so they surfaced raw in the headset. The retail TLK string 125641 is
 * literally `{Dummy Medbay PC}<FullName>` — a designer comment the game strips
 * followed by a token it substitutes — and it was displayed verbatim as a world
 * name tag.
 */
describe('authoring metadata is stripped', () => {
  test('removes a designer comment', () => {
    expect(stripAuthoringMetadata('Body{Invis container}')).toBe('Body');
    expect(stripAuthoringMetadata('Blast Door{HK-50}')).toBe('Blast Door');
    expect(stripAuthoringMetadata('Footlocker{Spikes}')).toBe('Footlocker');
  });

  test('removes a ## suffix', () => {
    expect(stripAuthoringMetadata('Some text##note-to-self')).toBe('Some text');
  });

  test('leaves an ordinary name untouched', () => {
    expect(stripAuthoringMetadata('Security Console')).toBe('Security Console');
  });
});

describe('the retail string that prompted this', () => {
  test('resolves to the player name', () => {
    expect(compileTalkString('{Dummy Medbay PC}<FullName>', { firstName: 'Kaya' }))
      .toBe('Kaya');
  });

  test('keeps the token visible when the name is unknown', () => {
    // Blanking would turn a missing name into a nameless object, which reads as
    // a rendering fault rather than a data one.
    expect(compileTalkString('{Dummy Medbay PC}<FullName>', {}))
      .toBe('<FullName>');
  });
});

describe('substitution tokens', () => {
  test('replaces the name tokens', () => {
    expect(compileTalkString('<FirstName> <LastName>', { firstName: 'Atton', lastName: 'Rand' }))
      .toBe('Atton Rand');
  });

  test('resolves a custom token through the supplied lookup', () => {
    const text = '[Computer] Slice the system. [<CUSTOM30> Spike(s)]';
    expect(compileTalkString(text, { custom: (i) => (i === 30 ? '2' : undefined) }))
      .toBe('[Computer] Slice the system. [2 Spike(s)]');
  });

  test('leaves an unset custom token in place rather than blanking it', () => {
    expect(compileTalkString('[<CUSTOM30> Spike(s)]', { custom: () => undefined }))
      .toBe('[<CUSTOM30> Spike(s)]');
  });

  test('applies extra literal replacements, as menus do for keymap tokens', () => {
    expect(compileTalkString('Press <KEY>', { extra: [[/<KEY>/g, 'F']] })).toBe('Press F');
  });
});

describe('it never throws on bad input', () => {
  test.each([undefined, null, 42, {}, ''])('%p yields an empty string', (value) => {
    expect(compileTalkString(value as unknown as string)).toBe('');
  });
});

describe('the three name getters route through the compiler', () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

  test.each([
    ['src/module/ModulePlaceable.ts'],
    ['src/module/ModuleCreature.ts'],
    ['src/module/ModuleDoor.ts'],
  ])('%s getName uses compileDisplayName', (file) => {
    const source = read(file);
    const at = source.indexOf('  getName(){');
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 240)).toMatch(/compileDisplayName\(/);
  });

  test('SetCustomToken is implemented in TSL, so <CUSTOM##> can resolve', () => {
    const defs = read('src/nwscript/NWScriptDefK2.ts');
    const at = defs.indexOf("name: 'SetCustomToken'");
    const body = defs.slice(at, defs.indexOf('\n  },', at));
    expect(body).not.toMatch(/action:\s*undefined/);
    expect(body).toMatch(/setCustomToken\(args\[0\], args\[1\]\)/);
  });
});
