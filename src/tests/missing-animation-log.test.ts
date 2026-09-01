import { describe, expect, test } from '@jest/globals';
import { shouldReportMissingAnimation } from '@/module/MissingAnimationLog';

/**
 * An object whose animation state resolves to no animation logged an error on
 * every frame, and the fallback state it then set resolved to no animation
 * either — so the log repeated forever. In the 82-module sweep that was 84% of
 * all console errors: 1194 in 702KOR and 965 in 501OND, each traced to a single
 * creature that could not resolve one animation.
 *
 * Unlike the other guards landed from this sweep, this one is testable directly:
 * the helper deliberately takes no engine imports.
 */
describe('shouldReportMissingAnimation', () => {

  test('reports a state once, then stays quiet', () => {
    const reported = new Set<number>();
    expect(shouldReportMissingAnimation(reported, 3)).toBe(true);
    for (let frame = 0; frame < 500; frame += 1) {
      expect(shouldReportMissingAnimation(reported, 3)).toBe(false);
    }
  });

  test('still reports a different state', () => {
    const reported = new Set<number>();
    expect(shouldReportMissingAnimation(reported, 3)).toBe(true);
    expect(shouldReportMissingAnimation(reported, 4)).toBe(true);
    expect(shouldReportMissingAnimation(reported, 3)).toBe(false);
  });

  test('objects do not silence each other', () => {
    // The set is per object, so one creature reporting a state must not hide
    // the same fault on another.
    const first = new Set<number>();
    const second = new Set<number>();
    expect(shouldReportMissingAnimation(first, 7)).toBe(true);
    expect(shouldReportMissingAnimation(second, 7)).toBe(true);
  });

  test('an unusable state value is still reported once, not every frame', () => {
    // animationState?.index is undefined when the state object itself is
    // missing — the flood must not come back through that door.
    const reported = new Set<number>();
    expect(shouldReportMissingAnimation(reported, undefined as unknown as number)).toBe(true);
    expect(shouldReportMissingAnimation(reported, undefined as unknown as number)).toBe(false);
    expect(shouldReportMissingAnimation(reported, NaN)).toBe(false);
  });

});
