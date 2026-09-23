import { describe, expect, jest, test } from '@jest/globals';

/**
 * Round 9: "let's fix the lack of audio for the doors". Every Peragus door
 * logged `AudioEmitter Sound not found dr_PER01`. The sound ships in
 * data\sounds.bif — chitin.key lists it as `dr_per01`, type 4 (WAV) — but the
 * KEY index was keyed case-sensitively, so the lookup missed and the loader
 * fell back to loose StreamSounds files that don't include it. Resrefs are
 * case-insensitive in the original engine.
 */
const keyBuffer = buildKey([
  { resRef: 'dr_per01', resType: 4, resId: (1 << 20) | 1568 },
  { resRef: 'Mixed_Case', resType: 2017, resId: 7 },
]);

jest.mock('@/utility/GameFileSystem', () => ({
  GameFileSystem: { readFile: jest.fn(async () => keyBuffer) },
}));
jest.mock('@/managers/BIFManager', () => ({ BIFManager: { bifs: new Map() } }));
jest.mock('@/resource/BIFObject', () => ({ BIFObject: class {} }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { KEYObject } = require('@/resource/KEYObject');

function buildKey(keys: { resRef: string; resType: number; resId: number }[]): Uint8Array {
  const header = 64;
  const fileTable = header;
  const bifName = 'data\\sounds.bif\0';
  const nameOffset = fileTable + 12;
  const keyTable = nameOffset + bifName.length;
  const buffer = Buffer.alloc(keyTable + keys.length * 22);
  buffer.write('KEY ', 0, 'latin1');
  buffer.write('V1  ', 4, 'latin1');
  buffer.writeUInt32LE(1, 8);
  buffer.writeUInt32LE(keys.length, 12);
  buffer.writeUInt32LE(fileTable, 16);
  buffer.writeUInt32LE(keyTable, 20);
  buffer.writeUInt32LE(0, fileTable);
  buffer.writeUInt32LE(nameOffset, fileTable + 4);
  buffer.writeUInt16LE(bifName.length, fileTable + 8);
  buffer.write(bifName, nameOffset, 'latin1');
  keys.forEach((key, i) => {
    const o = keyTable + i * 22;
    buffer.write(key.resRef, o, 'latin1');
    buffer.writeUInt16LE(key.resType, o + 16);
    buffer.writeUInt32LE(key.resId, o + 18);
  });
  return new Uint8Array(buffer);
}

describe('KEY resource lookup', () => {
  test('finds a door sound whatever case the 2DA spells it in', async () => {
    const key = new KEYObject();
    await key.loadFile('chitin.key');
    expect(key.getFileKey('dr_PER01', 4)?.resRef).toBe('dr_per01');
    expect(key.getFileKey('DR_PER01', 4)?.resId).toBe((1 << 20) | 1568);
    expect(key.getFileKey('dr_per01', 4)).not.toBeNull();
  });

  test('matches a mixed-case KEY entry from a lower-case request', async () => {
    const key = new KEYObject();
    await key.loadFile('chitin.key');
    expect(key.getFileKey('mixed_case', 2017)?.resRef).toBe('Mixed_Case');
  });

  test('still distinguishes resource types', async () => {
    const key = new KEYObject();
    await key.loadFile('chitin.key');
    expect(key.getFileKey('dr_per01', 2017)).toBeNull();
  });
});
