import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  describeVRCombatVoicingSounds,
  describeVRPlayerBarks,
  pickVRBark,
  resolveVRCriticalImpact,
  shouldVoiceTargetPain,
  strokeWhooshCoversMiss,
} from '@/vr/runtime/VRCombatVoicing';

// Part D: being hit is the PC's own pain grunt, a critical is its own sound,
// low health is voiced. All retail WAVs (chitin.key, sounds.bif).
describe('combat voicing', () => {
  test('the PC\'s barks follow the PC soundset lines in dialog.tlk, by gender', () => {
    expect(describeVRPlayerBarks('pain', 0)).toEqual(['p_plyermw_hit1', 'p_plyermw_hit2']);
    expect(describeVRPlayerBarks('pain', 1)).toEqual(['p_plyerfw_hit1', 'p_plyerfw_hit2']);
    expect(describeVRPlayerBarks('low-health', 0)).toContain('p_plyermw_low2');
    expect(describeVRPlayerBarks('critical', 1)).toContain('p_plyerfw_crit2');
  });

  test('a pick is always one of the takes', () => {
    expect(pickVRBark(['a', 'b'], () => 0)).toBe('a');
    expect(pickVRBark(['a', 'b'], () => 0.999)).toBe('b');
    expect(pickVRBark([], () => 0.5)).toBe('');
  });

  test('a struck enemy grunts on some hits, and always on a critical', () => {
    expect(shouldVoiceTargetPain(false, () => 0.1)).toBe(true);
    expect(shouldVoiceTargetPain(false, () => 0.9)).toBe(false);
    expect(shouldVoiceTargetPain(true, () => 0.9)).toBe(true);
  });

  test('a saber critical is the heavy saber impact; other weapons keep theirs', () => {
    expect(resolveVRCriticalImpact('cb_ls_hitsoft1', () => 0)).toBe('cb_ls_hithard1');
    expect(resolveVRCriticalImpact('cb_ls_hitsoft2', () => 0.9)).toBe('cb_ls_hithard2');
    expect(resolveVRCriticalImpact('cb_ht_blademetal')).toBeNull();
    expect(resolveVRCriticalImpact('')).toBeNull();
  });

  test('the stroke\'s whoosh stands for a miss resolved right after it, not a held one', () => {
    expect(strokeWhooshCoversMiss(1_000, 1_300)).toBe(true);
    expect(strokeWhooshCoversMiss(1_000, 2_200)).toBe(false);
    expect(strokeWhooshCoversMiss(null, 2_200)).toBe(false);
  });

  test('every resref is a retail WAV in the install\'s chitin.key', () => {
    const key = 'D:/SteamLibrary/steamapps/common/Knights of the Old Republic II/chitin.key';
    if (!fs.existsSync(key)) return; // CI without the game
    const b = fs.readFileSync(key);
    const keyCount = b.readUInt32LE(12), keyOff = b.readUInt32LE(20);
    const wavs = new Set<string>();
    for (let i = 0; i < keyCount; i++) {
      const o = keyOff + i * 22;
      if (b.readUInt16LE(o + 16) === 4) wavs.add(b.toString('latin1', o, o + 16).replace(/\0.*$/, '').toLowerCase());
    }
    for (const resref of describeVRCombatVoicingSounds()) expect([resref, wavs.has(resref)]).toEqual([resref, true]);
    expect(path.basename(key)).toBe('chitin.key');
  });
});
