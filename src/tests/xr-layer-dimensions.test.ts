import { describe, expect, test } from '@jest/globals';
import { resolveXRLayerDimensions } from '@/vr/benchmark/XRLayerDimensions';

describe('resolveXRLayerDimensions', () => {
  test('reads framebuffer dimensions from an XRWebGLLayer', () => {
    expect(
      resolveXRLayerDimensions({ framebufferWidth: 4224, framebufferHeight: 2304 })
    ).toEqual({ width: 4224, height: 2304 });
  });

  test('reads texture dimensions from a WebXR Layers projection layer', () => {
    expect(resolveXRLayerDimensions({ textureWidth: 4224, textureHeight: 2304 })).toEqual({
      width: 4224,
      height: 2304,
    });
  });

  test('rejects missing, fractional, and non-positive dimensions', () => {
    expect(() => resolveXRLayerDimensions({})).toThrow(RangeError);
    expect(() =>
      resolveXRLayerDimensions({ textureWidth: 1.5, textureHeight: 2 })
    ).toThrow(RangeError);
    expect(() =>
      resolveXRLayerDimensions({ framebufferWidth: 0, framebufferHeight: 2 })
    ).toThrow(RangeError);
  });
});
