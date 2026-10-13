import { describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import { cueForVRCombatOutcome, describeVRCombatCue, VRCombatCueAudio } from '@/vr/runtime/VRCombatCueAudio';
import { resolveVRHealthWatchPlacement, shouldShowVRHealthPlate, VR_HEALTH_PLATE_LOW_FRACTION } from '@/vr/runtime/VRHealthPlateHost';
import { VRBladeSparkHost } from '@/vr/runtime/VRBladeSparkHost';

// Critic review 2026-09-29: round 12 felt no haptics, so every combat result
// also has a sound and, for the player's own hits, a spark on the target.
// Allen, 2026-10-02: "make sure any sounds you add to the game are
// appropriate retail sounds". Every cue names a WAV that TSL's chitin.key
// lists (read from the retail install), never a synthesized tone.
const RETAIL_WAVS = new Set([
  'cb_sw_blade1', 'cb_sw_unarmed1', 'cb_bu_stonemed',
  'cb_ht_bladeleth1', 'cb_ht_blastleth1', 'cb_ht_unarmleth1', 'cb_ht_bladearm1',
  'cb_pa_blade1', 'cb_pa_unarm1', 'cb_pa_blast1',
  'v_useforce', 'gui_actqueue', 'gui_error', 'gui_complete', 'gui_invselect',
]);
const ALL_CUES = ['miss', 'hit', 'critical', 'parried', 'deflected', 'hurt', 'hurt-critical', 'force', 'ready', 'refused', 'saved', 'neck-zone'] as const;

describe('combat cue sounds', () => {
  test('every cue, for every weapon, is a retail TSL sound', () => {
    for (const cue of ALL_CUES) {
      for (const weapon of ['melee', 'ranged', 'unarmed'] as const) {
        const sounds = describeVRCombatCue(cue, weapon);
        expect(sounds.length).toBeGreaterThan(0);
        for (const s of sounds) expect(RETAIL_WAVS.has(s.resref)).toBe(true);
      }
    }
  });

  test('hit, miss and critical are told apart; the weapon picks the sound', () => {
    expect(describeVRCombatCue('miss', 'melee')[0].resref).toBe('cb_sw_blade1');
    expect(describeVRCombatCue('miss', 'ranged')[0].resref).toBe('cb_bu_stonemed');
    expect(describeVRCombatCue('hit', 'ranged')[0].resref).toBe('cb_ht_blastleth1');
    // A critical is one sample, louder and pitched down: not a flam (critic run 8).
    const crit = describeVRCombatCue('critical', 'melee');
    expect(crit).toHaveLength(1);
    expect(crit[0].rate).toBeLessThan(1);
    expect(crit[0].gain).toBeGreaterThan(describeVRCombatCue('hit', 'melee')[0].gain);
    // A critical never contains the parried sound (critic run 7).
    for (const weapon of ['melee', 'ranged', 'unarmed'] as const) {
      const parried = new Set(describeVRCombatCue('parried', weapon).map((x) => x.resref));
      for (const cue of ['critical', 'hurt-critical'] as const) {
        for (const x of describeVRCombatCue(cue, weapon)) expect(parried.has(x.resref)).toBe(false);
      }
    }
    // Being hit is not the sound of your own unarmed hit (critic run 6).
    expect(describeVRCombatCue('hurt')[0].resref).not.toBe(describeVRCombatCue('hit', 'unarmed')[0].resref);
    expect(describeVRCombatCue('hit', 'melee')).toHaveLength(1);
    expect(describeVRCombatCue('refused')[0].resref).toBe('gui_error');
    expect(describeVRCombatCue('saved')[0].resref).toBe('gui_complete');
    expect(describeVRCombatCue('force')[0].resref).toBe('v_useforce');
  });

  test('every 3.13 outcome has a cue', () => {
    for (const outcome of ['hit', 'critical', 'miss', 'parried', 'deflected']) {
      expect(cueForVRCombatOutcome(outcome)).not.toBeNull();
    }
    expect(cueForVRCombatOutcome('something-else')).toBeNull();
  });

  test('decodes each retail sound once and plays it into the destination, delayed when asked', async () => {
    const started: number[] = [];
    const loads: string[] = [];
    const context: any = {
      currentTime: 10,
      decodeAudioData: jest.fn(async () => ({ duration: 0.2 })),
      createBufferSource: () => ({ buffer: null as unknown, playbackRate: { setValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn(), start: (t: number) => started.push(t), onended: null as any }),
      createGain: () => ({ gain: { setValueAtTime: jest.fn() }, connect: jest.fn(), disconnect: jest.fn() }),
    };
    const audio = new VRCombatCueAudio(context, {} as AudioNode, async (resref) => { loads.push(resref); return new Uint8Array([1, 2, 3]); });
    await audio.play('critical', 200, 'melee');
    expect(started).toHaveLength(1);
    expect(started[0]).toBeCloseTo(10.2, 6);
    // A critical doubles the impact into one heavier blow, decoded once.
    expect(loads).toEqual(['cb_ht_bladeleth1']);
  });

  test('a sound that cannot load stays silent instead of throwing', async () => {
    const context: any = { currentTime: 0, decodeAudioData: jest.fn(), createBufferSource: jest.fn(), createGain: jest.fn() };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const audio = new VRCombatCueAudio(context, {} as AudioNode, async () => { throw new Error('missing'); });
    await expect(audio.play('refused')).resolves.toBeUndefined();
    expect(context.createBufferSource).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('wrist health plate', () => {
  const vitals = (hp: number, max = 20) => ({ hitPoints: hp, maxHitPoints: max, forcePoints: 0, maxForcePoints: 0 });
  const up = new THREE.Vector3(0, 0, 1);

  test('shows when turned toward the face, like a watch', () => {
    expect(shouldShowVRHealthPlate(up, new THREE.Vector3(0.05, 0, 0.4), vitals(20))).toBe(true);
  });
  test('hidden when facing away or held far off', () => {
    expect(shouldShowVRHealthPlate(up, new THREE.Vector3(0.4, 0, -0.1), vitals(20))).toBe(false);
    expect(shouldShowVRHealthPlate(up, new THREE.Vector3(0, 0, 1.5), vitals(20))).toBe(false);
  });
  test('stays up while HP is low, wherever it faces', () => {
    const low = Math.floor(20 * VR_HEALTH_PLATE_LOW_FRACTION);
    expect(shouldShowVRHealthPlate(up, new THREE.Vector3(0.4, 0, -0.1), vitals(low))).toBe(true);
  });
  test('nothing to show without vitals', () => {
    expect(shouldShowVRHealthPlate(up, new THREE.Vector3(0, 0, 0.4), null)).toBe(false);
  });
});

describe('hit sparks', () => {
  test('a critical bursts larger than a hit', () => {
    const scene = new THREE.Scene();
    const host = new VRBladeSparkHost(scene, () => 0.5);
    host.spark(new THREE.Vector3(), 0);
    host.spark(new THREE.Vector3(), 0, 0, 2);
    host.update(100);
    const scales = host.object.children.filter((c) => c.visible).map((c) => c.scale.x);
    expect(scales).toHaveLength(2);
    expect(Math.max(...scales)).toBeCloseTo(Math.min(...scales) * 2, 6);
  });
});

describe('settings', () => {
  test('Combat Sounds and Wrist Health are comfort rows, on by default', () => {
    const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    expect(game).toContain("label: 'Combat Sounds'");
    expect(game).toContain("label: 'Wrist Health'");
    expect(game).toMatch(/combatSoundsEnabled: true,\s+healthPlateEnabled: true,/);
  });
});

// Round 14: "Force powers didn't seem to work at all" - they cast, unseen.
test('your own Force power cast is announced in VR', () => {
  const area = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleArea.ts'), 'utf8');
  expect(area).toContain('GameState.onSpellCast?.(spellInstance.owner, spellInstance.spell);');
  const game = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
  expect(game).toMatch(/classifyVRForcePower\(spell\) !== true\) return;\s+VRSpike\.presentLocalForceCast\(\);/);
  expect(describeVRCombatCue('force')[0].resref).toBe('v_useforce');
});

describe('health watch placement (on the back of the off-hand wrist)', () => {
  // Measured on the WebXR generic left hand closed on the grip, in grip space.
  const LEFT_WRIST_JOINT = new THREE.Vector3(-0.034, 0.081, 0.015);
  // The mesh's cross-section 9-10.5 cm up the forearm axis, where the band sits.
  const LEFT_WRIST_MESH = { minX: -0.053, maxX: -0.016, minZ: -0.007, maxZ: 0.045 };

  test('left: centred on the wrist, past the joint toward the elbow, face out of the back of the wrist', () => {
    const watch = resolveVRHealthWatchPlacement('left');
    expect(watch.centre.distanceTo(LEFT_WRIST_JOINT)).toBeLessThan(0.025);
    expect(watch.centre.y).toBeGreaterThan(LEFT_WRIST_JOINT.y);
    const face = watch.centre.clone().add(watch.faceOffset);
    expect(face.x).toBeLessThan(LEFT_WRIST_MESH.minX - 0.01);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(watch.faceQuaternion);
    expect(normal.x).toBeCloseTo(-1, 5);
    const twelve = new THREE.Vector3(0, 1, 0).applyQuaternion(watch.faceQuaternion);
    expect(twelve.z).toBeCloseTo(1, 5);
  });

  test('left: the band clears every corner of the wrist mesh', () => {
    const watch = resolveVRHealthWatchPlacement('left');
    for (const x of [LEFT_WRIST_MESH.minX, LEFT_WRIST_MESH.maxX]) {
      for (const z of [LEFT_WRIST_MESH.minZ, LEFT_WRIST_MESH.maxZ]) {
        expect(Math.hypot(x - watch.centre.x, z - watch.centre.z)).toBeLessThan(watch.bandRadiusMetres);
      }
    }
  });

  test('right (Dominant Hand: Left) mirrors it across the grip', () => {
    const left = resolveVRHealthWatchPlacement('left');
    const right = resolveVRHealthWatchPlacement('right');
    expect(right.centre.x).toBeCloseTo(-left.centre.x, 5);
    expect(right.centre.y).toBeCloseTo(left.centre.y, 5);
    expect(new THREE.Vector3(0, 0, 1).applyQuaternion(right.faceQuaternion).x).toBeCloseTo(1, 5);
  });
});
