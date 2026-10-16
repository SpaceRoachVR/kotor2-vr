import { describe, expect, test } from '@jest/globals';
import { PreviewRenderThrottle } from '@/game/tsl/menu/upgradePreviewThrottle';

/**
 * Final review finding 1: the saber preview renders at 24 Hz, not every XR
 * frame, because each render makes the VR panel re-composite the whole GUI.
 */

function rendersOver(throttle: PreviewRenderThrottle, frames: number, delta: number): number[] {
  const elapsed: number[] = [];
  for (let i = 0; i < frames; i++) {
    const e = throttle.tick(delta);
    if (e !== undefined) elapsed.push(e);
  }
  return elapsed;
}

describe('PreviewRenderThrottle', () => {
  test('the first tick renders (a new view shows at once)', () => {
    expect(new PreviewRenderThrottle(24).tick(1 / 72)).toBeCloseTo(1 / 72, 9);
  });

  test('72 Hz frames give about 24 renders a second', () => {
    const throttle = new PreviewRenderThrottle(24);
    throttle.tick(0);
    const renders = rendersOver(throttle, 72 * 10, 1 / 72);
    expect(renders.length).toBeGreaterThanOrEqual(239);
    expect(renders.length).toBeLessThanOrEqual(241);
  });

  test('90 Hz and 60 Hz frames stay near 24 a second', () => {
    for (const hz of [60, 90, 120]) {
      const throttle = new PreviewRenderThrottle(24);
      throttle.tick(0);
      const n = rendersOver(throttle, hz * 10, 1 / hz).length;
      expect(n).toBeGreaterThanOrEqual(200);
      expect(n).toBeLessThanOrEqual(241);
    }
  });

  test('each render advances animations by the true time since the last one', () => {
    const throttle = new PreviewRenderThrottle(24);
    throttle.tick(0);
    const renders = rendersOver(throttle, 72, 1 / 72);
    const total = renders.reduce((a, b) => a + b, 0);
    // Everything up to the last render is passed on; at most one interval is still pending.
    expect(total).toBeGreaterThan(1 - 1 / 24 - 1e-9);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
  });

  test('a forced render happens on the very next tick', () => {
    const throttle = new PreviewRenderThrottle(24);
    throttle.tick(0);
    expect(throttle.tick(1 / 72)).toBeUndefined();
    throttle.force();
    expect(throttle.tick(1 / 72)).toBeCloseTo(2 / 72, 9);
    // And the interval starts over after it.
    expect(throttle.tick(1 / 72)).toBeUndefined();
    expect(throttle.tick(1 / 72)).toBeUndefined();
    expect(throttle.tick(1 / 72)).toBeCloseTo(3 / 72, 9);
  });

  test('a stall renders once, not a burst', () => {
    const throttle = new PreviewRenderThrottle(24);
    throttle.tick(0);
    expect(throttle.tick(1)).toBeCloseTo(1, 9);
    expect(throttle.tick(1 / 72)).toBeUndefined();
  });
});
