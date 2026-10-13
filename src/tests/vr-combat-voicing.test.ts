import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  describeVRCombatVoicingSounds,
  describeVRPlayerBarks,
  pickVRBark,
  resolveVRCriticalImpact,
  shouldVoiceTargetPain,
  VR_LONG_STROKE_SPEED_METRES_PER_SECOND,
  VR_RETAIL_SWING_TAKES,
  VR_STROKE_RESULT_WINDOW_MS,
  VRStrokeResultLedger,
  VRStrokeWhooshPicker,
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
    for (const resref of VR_RETAIL_SWING_TAKES) expect([resref, wavs.has(resref)]).toEqual([resref, true]);
    expect(path.basename(key)).toBe('chitin.key');
  });
});

// Part F (decision 4, 2026-10-13): varied stroke whooshes, a silent held miss.
describe('stroke whooshes', () => {
  const saber = {
    swingShort0: 'cb_ls_swingshrt1', swingShort1: 'cb_ls_swingshrt2', swingShort2: 'cb_ls_swingshrt3',
    swingLong0: 'cb_ls_swinglong1', swingLong1: 'cb_ls_swinglong2', swingLong2: 'cb_ls_swinglong3',
  };
  const blade = {
    swingShort0: 'cb_sw_blade1', swingShort1: 'cb_sw_blade1', swingShort2: 'cb_sw_blade1',
    swingLong0: 'cb_sw_blade1', swingLong1: 'cb_sw_blade1', swingLong2: 'cb_sw_blade1',
  };
  const quick = { speedMetresPerSecond: 1.8, twoHanded: false };
  const big = { speedMetresPerSecond: VR_LONG_STROKE_SPEED_METRES_PER_SECOND + 0.5, twoHanded: false };

  test('a saber rotates its three short takes, never the same twice running', () => {
    const picker = new VRStrokeWhooshPicker();
    const picks = Array.from({ length: 9 }, () => picker.pick(saber, quick)!.resref);
    expect(new Set(picks)).toEqual(new Set(['cb_ls_swingshrt1', 'cb_ls_swingshrt2', 'cb_ls_swingshrt3']));
    for (let i = 1; i < picks.length; i++) expect(picks[i]).not.toBe(picks[i - 1]);
  });

  test('a fast or two-handed stroke takes the long swings', () => {
    const picker = new VRStrokeWhooshPicker();
    expect(picker.pick(saber, big)!.resref).toMatch(/^cb_ls_swinglong[123]$/);
    expect(picker.pick(saber, { speedMetresPerSecond: 1, twoHanded: true })!.resref).toMatch(/^cb_ls_swinglong[123]$/);
  });

  test('a one-take family keeps its retail sample and varies the pitch', () => {
    const picker = new VRStrokeWhooshPicker();
    const picks = Array.from({ length: 3 }, () => picker.pick(blade, quick)!);
    expect(picks.every((p) => p.resref === 'cb_sw_blade1')).toBe(true);
    expect(new Set(picks.map((p) => p.rate)).size).toBe(3);
  });

  test('no row, no whoosh', () => {
    expect(new VRStrokeWhooshPicker().pick(null, quick)).toBeNull();
    expect(new VRStrokeWhooshPicker().pick({}, quick)).toBeNull();
  });
});

describe('VRStrokeResultLedger', () => {
  test('a held swing missing 2 s after its stroke is already voiced', () => {
    const ledger = new VRStrokeResultLedger();
    ledger.noteStroke(1000);
    expect(ledger.coversMiss(3000)).toBe(true);
    // One stroke, one result: a second miss with no stroke of its own is heard.
    expect(ledger.coversMiss(3100)).toBe(false);
  });

  test('a stroke, its hit, then a held stroke that misses', () => {
    const ledger = new VRStrokeResultLedger();
    ledger.noteStroke(0);
    ledger.noteStroke(400);
    ledger.noteResult(150);
    expect(ledger.coversMiss(3000)).toBe(true);
  });

  test('a miss long after any stroke still whooshes', () => {
    const ledger = new VRStrokeResultLedger();
    ledger.noteStroke(0);
    expect(ledger.coversMiss(VR_STROKE_RESULT_WINDOW_MS + 1)).toBe(false);
  });
});
