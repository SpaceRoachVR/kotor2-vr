export const DEFAULT_XR_RUNTIME_HZ = 72;

/**
 * Resolve runtime cadence without coupling it to the product acceptance floor.
 * WebXR implementations may omit XRSession.frameRate even when the active
 * headset rate is known from the configured target profile.
 */
export function resolveXRRuntimeRate(
  frameRate: unknown,
  fallbackHz = DEFAULT_XR_RUNTIME_HZ
): number {
  if (!Number.isFinite(fallbackHz) || fallbackHz <= 0) {
    throw new RangeError('fallbackHz must be a positive finite number');
  }
  return typeof frameRate === 'number' && Number.isFinite(frameRate) && frameRate > 0
    ? frameRate
    : fallbackHz;
}
