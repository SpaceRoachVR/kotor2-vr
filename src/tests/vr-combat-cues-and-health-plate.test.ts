import { describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';

import { cueForVRCombatOutcome, describeVRCombatCue, VRCombatCueAudio } from '@/vr/runtime/VRCombatCueAudio';
import { shouldShowVRHealthPlate, VR_HEALTH_PLATE_LOW_FRACTION } from '@/vr/runtime/VRHealthPlateHost';
import { VRBladeSparkHost } from '@/vr/runtime/VRBladeSparkHost';

// Critic review 2026-09-29: round 12 felt no haptics, so every combat result
// also has a sound and, for the player's own hits, a spark on the target.
describe('combat cue sounds', () => {
  test('hit, miss and critical are told apart by count, pitch and loudness', () => {
    const miss = describeVRCombatCue('miss');
    const hit = describeVRCombatCue('hit');
    const crit = describeVRCombatCue('critical');
    expect(miss).toHaveLength(1);
    expect(hit).toHaveLength(1);
    expect(crit).toHaveLength(2);
    expect(hit[0].gain).toBeGreaterThan(miss[0].gain * 2);
    expect(crit[0].frequency).toBeGreaterThan(hit[0].frequency);
    expect(miss[0].frequency).toBeLessThan(hit[0].frequency);
  });

  test('every 3.13 outcome has a cue', () => {
    for (const outcome of ['hit', 'critical', 'miss', 'parried', 'deflected']) {
      expect(cueForVRCombatOutcome(outcome)).not.toBeNull();
    }
    expect(cueForVRCombatOutcome('something-else')).toBeNull();
  });

  test('plays one oscillator per tone into the destination, delayed when asked', () => {
    const started: number[] = [];
    const osc = () => ({
      type: 'sine',
      frequency: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      connect: jest.fn(),
      disconnect: jest.fn(),
      start: (t: number) => started.push(t),
      stop: jest.fn(),
      onended: null as any,
    });
    const gain = () => ({
      gain: { setValueAtTime: jest.fn(), exponentialRampToValueAtTime: jest.fn() },
      connect: jest.fn(),
      disconnect: jest.fn(),
    });
    const context: any = { currentTime: 10, createOscillator: osc, createGain: gain };
    const audio = new VRCombatCueAudio(context, {} as AudioNode);
    audio.play('critical', 200);
    expect(started).toHaveLength(2);
    expect(started[0]).toBeCloseTo(10.2, 6);
    expect(started[1]).toBeGreaterThan(started[0]);
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
