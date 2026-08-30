import { describe, expect, test } from '@jest/globals';
import { resolveXRRuntimeRate } from '@/vr/benchmark/XRRuntimeRate';

describe('resolveXRRuntimeRate', () => {
  test('keeps runtime cadence independent from the acceptance floor', () => {
    expect(resolveXRRuntimeRate(72)).toBe(72);
    expect(resolveXRRuntimeRate(undefined)).toBe(72);
    expect(resolveXRRuntimeRate(Number.NaN)).toBe(72);
  });

  test('rejects an invalid fallback instead of inventing cadence evidence', () => {
    expect(() => resolveXRRuntimeRate(undefined, 0)).toThrow(RangeError);
  });
});
