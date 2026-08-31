import { describe, expect, test } from '@jest/globals';
import {
  DEFAULT_RENDERER_CONTEXT_MODE,
  DEFAULT_RENDERER_DEPTH_MODE,
  DEFAULT_XR_FRAMEBUFFER_SCALE,
  MAXIMUM_XR_FRAMEBUFFER_SCALE,
  MINIMUM_XR_FRAMEBUFFER_SCALE,
  parseRendererContextMode,
  parseRendererDepthMode,
  parseXRFramebufferScale,
} from '@/utility/RendererOptions';

/**
 * `logarithmicDepthBuffer` compiles a `#define` into every shader, so it is
 * fixed at renderer construction and cannot be an in-game setting. It is read
 * from the launch URL instead, which is also how the A/B gets run.
 */
describe('renderer depth mode launch option', () => {
  test('defaults to the engine\'s inherited logarithmic depth', () => {
    expect(DEFAULT_RENDERER_DEPTH_MODE).toBe('logarithmic');
    expect(parseRendererDepthMode('')).toBe('logarithmic');
    expect(parseRendererDepthMode('?key=tsl')).toBe('logarithmic');
  });

  test('selects linear depth for the other half of the A/B', () => {
    expect(parseRendererDepthMode('?depth=linear')).toBe('linear');
    expect(parseRendererDepthMode('?key=tsl&depth=linear')).toBe('linear');
    expect(parseRendererDepthMode('depth=linear')).toBe('linear');
    expect(parseRendererDepthMode('?depth=LINEAR')).toBe('linear');
    expect(parseRendererDepthMode('?depth= linear ')).toBe('linear');
  });

  test('a typo falls back to current behaviour rather than failing to boot', () => {
    expect(parseRendererDepthMode('?depth=lienar')).toBe('logarithmic');
    expect(parseRendererDepthMode('?depth=')).toBe('logarithmic');
    expect(parseRendererDepthMode(undefined as unknown as string)).toBe('logarithmic');
  });
});

/**
 * Render resolution is the bluntest performance lever a VR title has, and this
 * build had no way to move it: Phase 0 measured a 4224x2304 XR target and lived
 * with it. Scaling is roughly quadratic in fill rate.
 */
describe('XR framebuffer scale launch option', () => {
  test('defaults to the runtime\'s own recommended resolution', () => {
    expect(DEFAULT_XR_FRAMEBUFFER_SCALE).toBe(1);
    expect(parseXRFramebufferScale('')).toBe(1);
    expect(parseXRFramebufferScale('?key=tsl')).toBe(1);
    expect(parseXRFramebufferScale('?xrscale=')).toBe(1);
  });

  test('accepts a scale on either side of the default', () => {
    expect(parseXRFramebufferScale('?xrscale=0.8')).toBeCloseTo(0.8);
    expect(parseXRFramebufferScale('?key=tsl&xrscale=1.2')).toBeCloseTo(1.2);
    expect(parseXRFramebufferScale('?xrscale= 0.75 ')).toBeCloseTo(0.75);
  });

  test('clamps rather than ignores an out-of-range request', () => {
    // "As low as you go" is a coherent request; silently rendering at full
    // resolution instead would read as the option not working.
    expect(parseXRFramebufferScale('?xrscale=0.1')).toBe(MINIMUM_XR_FRAMEBUFFER_SCALE);
    expect(parseXRFramebufferScale('?xrscale=99')).toBe(MAXIMUM_XR_FRAMEBUFFER_SCALE);
  });

  test('falls back to the default for input that is not a scale at all', () => {
    expect(parseXRFramebufferScale('?xrscale=half')).toBe(1);
    expect(parseXRFramebufferScale('?xrscale=0')).toBe(1);
    expect(parseXRFramebufferScale('?xrscale=-1')).toBe(1);
    expect(parseXRFramebufferScale('?xrscale=NaN')).toBe(1);
  });
});

/**
 * `WebGLRenderer` uses whatever context it is handed, so creating the canvas
 * context as `webgl` pinned the engine to WebGL 1 regardless of what the
 * browser supported.
 */
describe('renderer context launch option', () => {
  // The default is WebGL 1 because WebGL 2 renders the startup screens flat
  // green — captured from the same build at the same moment, see
  // evidence/greenscreen-webgl{1,2}.png. The option exists so that can be
  // investigated, not because WebGL 2 is ready.
  test('defaults to WebGL 1, which is the version that renders', () => {
    expect(DEFAULT_RENDERER_CONTEXT_MODE).toBe('webgl1');
    expect(parseRendererContextMode('')).toBe('webgl1');
    expect(parseRendererContextMode('?key=tsl')).toBe('webgl1');
  });

  test('WebGL 2 can still be selected deliberately, for investigating it', () => {
    expect(parseRendererContextMode('?gl=webgl2')).toBe('webgl2');
    expect(parseRendererContextMode('?key=tsl&gl=WEBGL2')).toBe('webgl2');
    expect(parseRendererContextMode('?gl= webgl2 ')).toBe('webgl2');
  });

  test('a typo does not silently pick the other one', () => {
    expect(parseRendererContextMode('?gl=webgl')).toBe('webgl1');
    expect(parseRendererContextMode('?gl=')).toBe('webgl1');
    expect(parseRendererContextMode('?gl=3')).toBe('webgl1');
  });
});
