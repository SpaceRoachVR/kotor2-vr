import { describe, expect, test } from '@jest/globals';
import { VRCutsceneFadeEnvelope } from '@/vr/runtime/VRCutsceneFadeHost';

describe('VRCutsceneFadeEnvelope', () => {
  test('is zero before any trigger', () => {
    const envelope = new VRCutsceneFadeEnvelope({ totalDurationMilliseconds: 200 });
    expect(envelope.sample(1000)).toBe(0);
  });

  test('ramps up then back down over the configured duration, triangular envelope', () => {
    const envelope = new VRCutsceneFadeEnvelope({ totalDurationMilliseconds: 200 });
    envelope.trigger(1000);

    expect(envelope.sample(1000)).toBeCloseTo(0);
    expect(envelope.sample(1050)).toBeCloseTo(0.5);
    expect(envelope.sample(1100)).toBeCloseTo(1);
    expect(envelope.sample(1150)).toBeCloseTo(0.5);
    expect(envelope.sample(1200)).toBe(0);
    expect(envelope.sample(1300)).toBe(0);
  });

  test('a new trigger restarts the envelope from the new timestamp', () => {
    const envelope = new VRCutsceneFadeEnvelope({ totalDurationMilliseconds: 200 });
    envelope.trigger(1000);
    envelope.trigger(5000);

    expect(envelope.sample(1100)).toBe(0);
    expect(envelope.sample(5100)).toBeCloseTo(1);
  });

  test('reset() clears the envelope back to zero', () => {
    const envelope = new VRCutsceneFadeEnvelope({ totalDurationMilliseconds: 200 });
    envelope.trigger(1000);
    envelope.reset();
    expect(envelope.sample(1050)).toBe(0);
  });

  test('rejects a non-finite trigger or sample timestamp', () => {
    const envelope = new VRCutsceneFadeEnvelope();
    expect(() => envelope.trigger(Number.NaN)).toThrow(TypeError);
    expect(() => envelope.sample(Number.NaN)).toThrow(TypeError);
  });

  test('rejects an invalid configuration', () => {
    expect(() => new VRCutsceneFadeEnvelope({ totalDurationMilliseconds: 0 })).toThrow(RangeError);
  });
});
