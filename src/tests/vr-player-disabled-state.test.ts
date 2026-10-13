import { describe, expect, test } from '@jest/globals';
import { resolveVRPlayerDisabledLabel } from '../vr/runtime/VRPlayerDisabledState';

const KNOCKDOWN = 'knockdown';
const setState = (state: number, cutscene = false) => ({ kind: 'set-state' as const, state, cutscene });

/**
 * Round 18: "Paralysed" sat over the loading screen. Peragus's T3 jumps
 * (a_106perjump, a_101perjump) apply EffectCutSceneParalyze to the leader for
 * 3-4 s and call StartNewModule, so the hold outlived the load. A cutscene
 * hold is the game moving the body for a scene, not a combat state.
 */
describe('the VR disabled plate', () => {
  const play = { mode: 'ingame' as const, loading: false, scene: false };

  test('a combat stun or paralysis names itself in play', () => {
    expect(resolveVRPlayerDisabledLabel({ ...play, effects: [setState(4)] })).toBe('Stunned');
    expect(resolveVRPlayerDisabledLabel({ ...play, effects: [setState(5)] })).toBe('Paralysed');
    expect(resolveVRPlayerDisabledLabel({ ...play, effects: [{ kind: KNOCKDOWN }] })).toBe('Knocked down');
  });

  test('a cutscene hold never shows', () => {
    expect(resolveVRPlayerDisabledLabel({ ...play, effects: [setState(5, true)] })).toBeNull();
    expect(resolveVRPlayerDisabledLabel({ ...play, effects: [setState(4, true)] })).toBeNull();
    expect(resolveVRPlayerDisabledLabel({ ...play, effects: [setState(8, true)] })).toBeNull();
  });

  test('nothing shows while a module loads, a menu or a movie is up, or a scene runs', () => {
    const effects = [setState(5)];
    expect(resolveVRPlayerDisabledLabel({ ...play, loading: true, effects })).toBeNull();
    expect(resolveVRPlayerDisabledLabel({ ...play, mode: 'other', effects })).toBeNull();
    expect(resolveVRPlayerDisabledLabel({ ...play, scene: true, effects })).toBeNull();
  });

  test('a minigame still shows a real state', () => {
    expect(resolveVRPlayerDisabledLabel({ ...play, mode: 'minigame', effects: [setState(4)] })).toBe('Stunned');
  });
});
