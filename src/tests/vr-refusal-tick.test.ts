import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  isVRRefusedInputMeaningful,
  VR_REFUSAL_TICK_MIN_GAP_MS,
  VR_REFUSAL_TICK_SAME_REASON_GAP_MS,
  VRRefusalTickThrottle,
} from '@/vr/runtime/VRRefusalTick';

describe('VRRefusalTickThrottle', () => {
  test('the first refusal ticks; a repeat inside the gap does not', () => {
    const throttle = new VRRefusalTickThrottle();
    expect(throttle.allow('queue-full', 1000)).toBe(true);
    expect(throttle.allow('queue-full', 1000 + VR_REFUSAL_TICK_SAME_REASON_GAP_MS - 1)).toBe(false);
    expect(throttle.allow('queue-full', 1000 + VR_REFUSAL_TICK_SAME_REASON_GAP_MS)).toBe(true);
  });

  test('two different refusals never tick closer than the minimum gap', () => {
    const throttle = new VRRefusalTickThrottle();
    expect(throttle.allow('queue-full', 0)).toBe(true);
    expect(throttle.allow('pull-did-nothing', VR_REFUSAL_TICK_MIN_GAP_MS - 1)).toBe(false);
    expect(throttle.allow('pull-did-nothing', VR_REFUSAL_TICK_MIN_GAP_MS)).toBe(true);
  });

  test('a held trigger at 30 fps for 3 s is two ticks at most', () => {
    const throttle = new VRRefusalTickThrottle();
    let ticks = 0;
    for (let t = 0; t < 3000; t += 33) if (throttle.allow('trigger-cannot-serve-head', t)) ticks += 1;
    expect(ticks).toBeLessThanOrEqual(2);
  });
});

describe('isVRRefusedInputMeaningful', () => {
  const push = { kind: 'force-power', requiredInput: 'directional-force-gesture', label: 'Force Push' };
  const stun = { kind: 'force-power', requiredInput: 'dominant-trigger', label: 'Stun' };
  const feat = { kind: 'attack-feat', requiredInput: 'dominant-swing', label: 'Power Attack' };
  const fight = { fightOn: true, blaster: false };

  test('an off-target push flick ticks only with Push queued', () => {
    expect(isVRRefusedInputMeaningful('push', push, fight)).toBe(true);
    expect(isVRRefusedInputMeaningful('pull', push, fight)).toBe(false);
    expect(isVRRefusedInputMeaningful('push', null, fight)).toBe(false);
    expect(isVRRefusedInputMeaningful('push', feat, fight)).toBe(false);
  });

  test('an off-target palm thrust ticks only with a trigger-cast power queued', () => {
    expect(isVRRefusedInputMeaningful('cast', stun, fight)).toBe(true);
    expect(isVRRefusedInputMeaningful('cast', push, fight)).toBe(false);
    expect(isVRRefusedInputMeaningful('cast', undefined, fight)).toBe(false);
  });

  test('a pull at nothing ticks in a fight with a blaster, or a melee power waiting for it', () => {
    expect(isVRRefusedInputMeaningful('idle-trigger', null, { fightOn: true, blaster: true })).toBe(true);
    expect(isVRRefusedInputMeaningful('idle-trigger', null, { fightOn: false, blaster: true })).toBe(false);
    expect(isVRRefusedInputMeaningful('idle-trigger', null, fight)).toBe(false);
    expect(isVRRefusedInputMeaningful('idle-trigger', stun, fight)).toBe(true);
  });
});

/** The wiring: GameState cannot be imported here, so these pin the edits that reach the tick. */
describe('refusal tick wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/GameState.ts'), 'utf8');
  const spike = fs.readFileSync(path.join(process.cwd(), 'src/vr/VRSpike.ts'), 'utf8');

  test('a full queue ticks', () => {
    expect(source).toMatch(/if \(!vrCombatIntentQueue\.enqueue\(intent\)\.accepted\) tickVRRefusal\('queue-full'\)/);
  });

  test('a trigger pull that cannot serve the head ticks', () => {
    expect(source).toContain("tickVRRefusal('trigger-cannot-serve-head')");
  });

  test('the tick is the refused cue alone, with no notice', () => {
    const body = source.slice(source.indexOf('function tickVRRefusal('));
    const fn = body.slice(0, body.indexOf('\n}'));
    expect(fn).toContain('VRSpike.playRefusedCue()');
    expect(fn).not.toMatch(/showNotice|signalRefusal|signalVRRefusal/);
  });

  test('an off-target Force gesture and an idle pull reach the host', () => {
    expect(spike.match(/onRefusedInput\?\.\(/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
