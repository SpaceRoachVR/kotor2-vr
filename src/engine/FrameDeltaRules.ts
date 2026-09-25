/**
 * How much simulated time one engine frame may cover.
 *
 * The clock keeps running through a module load, the load screen, a movie,
 * a debugger pause or a tab in the background, and the first frame afterwards
 * used to be handed the whole gap as its delta. Movement scales by delta, so
 * a creature whose movement vector was still set from before the stall took
 * the entire stall's worth of travel in a single step: arriving in 103PER
 * from the Harbinger, the Exile's first frame was delta ~5 s and she moved
 * 10.5 m north in one collision pass, straight through the fuel pipe's wall
 * onto the deck (four sub-steps of 2.6 m never touched the wall's edge test),
 * and T3-M4 was sealed off behind it.
 *
 * Retail effectively pauses simulation while it loads; treating anything over
 * MAX_FRAME_DELTA as a hitch to be skipped, not simulated, is the same rule.
 * 100 ms is ten frames a second: no ordinary frame is that long, and a hitch
 * that long is not worth integrating.
 */
export const MAX_FRAME_DELTA = 0.1;

/**
 * The delta an engine frame should simulate for a measured clock gap: never
 * negative, never NaN, never more than MAX_FRAME_DELTA.
 */
export function clampFrameDelta(measured: number, max: number = MAX_FRAME_DELTA): number {
  if (!Number.isFinite(max) || max <= 0) {
    throw new RangeError('max frame delta must be a positive finite number');
  }
  if (!Number.isFinite(measured) || measured < 0) return 0;
  return measured > max ? max : measured;
}
