/**
 * Startup-only renderer options.
 *
 * These configure `WebGLRenderer` at construction and cannot be changed
 * afterwards — `logarithmicDepthBuffer` compiles a `#define` into every
 * shader — so they are read once from the launch URL rather than exposed as
 * in-game settings.
 *
 * @file RendererOptions.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

/**
 * How the depth buffer is driven.
 *
 * `logarithmic` is the engine's inherited default. It costs real fill rate:
 * three's logarithmic path writes `gl_FragDepthEXT` in every fragment shader,
 * which defeats early depth rejection on essentially every GPU and is
 * disproportionately expensive on the tile-based GPU in a standalone headset.
 * Where `EXT_frag_depth` is absent it degrades instead of costing — three
 * falls back to interpolating depth across the triangle, which is visibly
 * wrong on the large wall and floor triangles Odyssey rooms are built from.
 *
 * `linear` is ordinary depth. Whether it is usable here is a question about
 * precision across the camera's range, and the answer is a measurement, not
 * an argument: the VR camera runs 0.05–15000, and how much of that range a
 * 24-bit depth buffer resolves without z-fighting depends on the area. Run
 * both and look.
 */
export type RendererDepthMode = 'logarithmic' | 'linear';

/**
 * Reads a startup option from the launch URL, falling back to `localStorage`.
 *
 * The URL is the natural place for these, and it is how the browser build and
 * the emulator harness pass them. Electron is not so lucky: it loads over
 * `file://` with a query the app builds itself, so there is nowhere for a
 * person to append `&gl=webgl1` — and Electron is the documented environment
 * for engine work. `localStorage` covers it: set the value from DevTools
 * (Ctrl+Shift+I) and restart.
 *
 *   localStorage.setItem('kotor2vr.gl', 'webgl1')
 *
 * The URL wins where both are present, so a harness run is never influenced by
 * whatever a previous manual session left behind.
 */
export function readLaunchOption(search: string, name: string): string {
  let value: string | null = null;
  if (typeof search === 'string' && search) {
    try {
      value = new URLSearchParams(search).get(name);
    } catch { /* a malformed query must not stop the engine booting */ }
  }
  if (typeof value !== 'string' || !value.trim()) {
    try {
      value = typeof localStorage !== 'undefined'
        ? localStorage.getItem(`kotor2vr.${name}`)
        : null;
    } catch { /* storage can be unavailable or blocked; treat as unset */ }
  }
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export const DEFAULT_RENDERER_DEPTH_MODE: RendererDepthMode = 'logarithmic';

/**
 * Reads the depth mode from a launch query string.
 *
 * Unknown, absent, or malformed values fall back to the default rather than
 * throwing: a typo in a launch URL must not stop the engine booting, and a
 * silent fallback to current behaviour is the safe direction.
 *
 * @param search - a `location.search` string, with or without its leading `?`
 */
export function parseRendererDepthMode(search: string): RendererDepthMode {
  const normalized = readLaunchOption(search, 'depth');
  return normalized === 'linear' || normalized === 'logarithmic'
    ? normalized
    : DEFAULT_RENDERER_DEPTH_MODE;
}

/**
 * Which WebGL version the renderer's context is created at.
 *
 * The engine created its context explicitly as `webgl` and handed it to
 * `WebGLRenderer`, which uses the context it is given — so `isWebGL2` was
 * false engine-wide regardless of what the browser supported.
 *
 * WebGL 2 brings instancing without an extension, integer textures,
 * `texStorage` (fewer driver re-validations on upload, which matters more as
 * mod packs enlarge every upload), and non-power-of-two textures with mipmaps
 * and repeat wrapping, which WebGL 1 forbids. It is also the precondition for
 * any future multiview path.
 *
 * **WebGL 2 is not currently usable here, and the default is `webgl1`.**
 * Switching the default to WebGL 2 rendered the startup screens as flat green:
 * captured side by side from the same build at the same moment, `?gl=webgl1`
 * draws the LucasArts legal screen correctly and `?gl=webgl2` draws nothing but
 * green (`tools/vr-emulator/evidence/greenscreen-webgl{1,2}.png`).
 *
 * Nothing in the loader is at fault — under WebGL 2 the Override index still
 * builds across mod layers and every sampled loading screen still resolves and
 * decodes. The break is in rendering, and it is *not* a shader compile failure:
 * the console carried no shader errors and the page threw nothing. Most likely
 * a texture upload path that WebGL 2 treats differently, which is a real
 * investigation and not a one-line fix.
 *
 * The option stays so that investigation can run without re-plumbing anything.
 */
export type RendererContextMode = 'webgl2' | 'webgl1';

export const DEFAULT_RENDERER_CONTEXT_MODE: RendererContextMode = 'webgl1';

/** Reads the context version from a launch query string. */
export function parseRendererContextMode(search: string): RendererContextMode {
  const normalized = readLaunchOption(search, 'gl');
  return normalized === 'webgl1' || normalized === 'webgl2'
    ? normalized
    : DEFAULT_RENDERER_CONTEXT_MODE;
}

/**
 * 1.0 asks WebXR for the runtime's own recommended resolution, which is what
 * three requests by default.
 */
export const DEFAULT_XR_FRAMEBUFFER_SCALE = 1;

/** Below this the image is too soft to read text through a lens; above it, few GPUs cope. */
export const MINIMUM_XR_FRAMEBUFFER_SCALE = 0.5;
export const MAXIMUM_XR_FRAMEBUFFER_SCALE = 2;

/**
 * Reads the XR framebuffer scale from a launch query string.
 *
 * Render resolution is the bluntest performance lever a VR title has, and this
 * one had no way to move it at all — Phase 0 measured a 4224x2304 XR target and
 * simply lived with it. Scaling the framebuffer trades sharpness for fill rate
 * roughly quadratically, so 0.8 is about a third less work per eye.
 *
 * Clamped rather than rejected: an out-of-range value is a request for "as low
 * as you go" or "as high as you go", and honouring the nearest legal value is
 * more useful than silently ignoring it. Non-numeric input falls back to the
 * default, like the depth option.
 */
export function parseXRFramebufferScale(search: string): number {
  const value = readLaunchOption(search, 'xrscale');
  if (!value) return DEFAULT_XR_FRAMEBUFFER_SCALE;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_XR_FRAMEBUFFER_SCALE;
  return Math.min(MAXIMUM_XR_FRAMEBUFFER_SCALE, Math.max(MINIMUM_XR_FRAMEBUFFER_SCALE, parsed));
}
