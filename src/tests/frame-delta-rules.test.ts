import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { MAX_FRAME_DELTA, clampFrameDelta } from '@/engine/FrameDeltaRules';

/**
 * The first frame after a module load was handed the whole load as its delta
 * (~5 s arriving in 103PER from the Harbinger) and the Exile's movement
 * vector, still set from the push into the transition trigger, carried her
 * 10.5 m in one step through the fuel pipe's wall.
 */
describe('clampFrameDelta', () => {
  test('ordinary frames pass through unchanged', () => {
    expect(clampFrameDelta(1 / 60)).toBeCloseTo(1 / 60, 10);
    expect(clampFrameDelta(1 / 30)).toBeCloseTo(1 / 30, 10);
    expect(clampFrameDelta(MAX_FRAME_DELTA)).toBe(MAX_FRAME_DELTA);
  });

  test('a stall the length of a module load simulates only one long frame', () => {
    // 103PER arrival: 5.58 s between placement and the first collision pass.
    expect(clampFrameDelta(5.58)).toBe(MAX_FRAME_DELTA);
    // At the Exile's run speed that is well under a metre, not ten.
    const runSpeed = 2.0;
    expect(clampFrameDelta(5.58) * runSpeed).toBeLessThan(0.5);
  });

  test('a broken clock reading simulates nothing rather than exploding', () => {
    expect(clampFrameDelta(Number.NaN)).toBe(0);
    expect(clampFrameDelta(-0.5)).toBe(0);
    expect(clampFrameDelta(Number.POSITIVE_INFINITY)).toBe(0);
  });

  test('refuses a nonsensical ceiling', () => {
    expect(() => clampFrameDelta(0.01, 0)).toThrow(RangeError);
    expect(() => clampFrameDelta(0.01, Number.NaN)).toThrow(RangeError);
  });

  test('the main loop reads its delta through the clamp', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'GameState.ts'), 'utf8');
    expect(source).toContain('const delta = clampFrameDelta(GameState.clock.getDelta());');
  });

  test('a module load clears the player\'s momentum before the first frame', () => {
    // Force alone was reset; speed and the unit direction VR had written into
    // forceVector survived the transition and were scaled by the first delta.
    const area = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleArea.ts'), 'utf8');
    const start = area.indexOf('async loadPlayer(): Promise<void> {');
    const body = area.slice(start, area.indexOf('async loadParty(): Promise<void> {', start));
    expect(body).toContain('GameState.PartyManager.Player.force = 0;');
    expect(body).toContain('GameState.PartyManager.Player.speed = 0;');
    expect(body).toContain('GameState.PartyManager.Player.forceVector.set(0, 0, 0);');
  });
});
