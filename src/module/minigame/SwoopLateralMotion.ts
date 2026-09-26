/**
 * The swoop's sideways motion, as one pure step so it can be tested without
 * the engine and shared by the flatscreen keys and the VR controls.
 *
 * Retail's ARE declares `LateralAccel` (300 on 211TEL) and `UseInertia`, and
 * the flatscreen keys set `lateralForce` to +/- that acceleration for as long
 * as they are held. The engine treated that as a velocity - 300 units a second,
 * across a 40-unit road in a seventh of a second, so a tap of the key threw the
 * bike into the wall. Here it is what its name says: the input is an
 * acceleration, the bike carries sideways velocity, and letting go decelerates
 * back to straight at the same rate. That is what makes a tap a nudge and a
 * hold a sweep.
 */

export interface SwoopLateralState {
  /** Sideways offset from the lane centre, in game units. */
  position: number;
  /** Sideways velocity, in game units per second. */
  velocity: number;
}

export interface SwoopLateralInput {
  /** -1 full left .. +1 full right. Anything else is treated as 0. */
  steer: number;
  /** Acceleration the race granted, units/s^2. 0 before the flag drops. */
  acceleration: number;
  /** Half the width of the lane the rider may use, from the tunnel bounds. */
  limit: number;
  /** Seconds since the last step. */
  delta: number;
}

export interface SwoopLateralResult {
  readonly state: SwoopLateralState;
  /** The bike ran into the edge of the road this step, and how hard (units/s). */
  readonly wallHit: number;
}

/**
 * The fastest the bike moves sideways, units per second.
 *
 * Not authored anywhere: retail clamps it in code. Chosen so a full-lock sweep
 * crosses 211TEL's 40-unit road in a little under a second, which is quick
 * enough to dodge a row of mines and slow enough to read. One named constant,
 * so a ride that feels wrong changes one number.
 */
export const SWOOP_LATERAL_MAX_SPEED = 45;

/**
 * How much faster the bike settles to straight than it turns, as a multiple of
 * the acceleration. Letting go should feel like the bike righting itself, not
 * like it coasting on across the road.
 */
export const SWOOP_LATERAL_SETTLE_FACTOR = 1.5;

/**
 * Impact speed below which touching the wall is a scrape rather than a bump.
 * Held against the edge, the bike creeps into it by acceleration * dt each
 * frame (about 0.4 units/s at 90fps), which must not read as a hit.
 */
export const SWOOP_WALL_BUMP_MIN_SPEED = 8;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function stepSwoopLateral(
  state: SwoopLateralState, input: SwoopLateralInput,
): SwoopLateralResult {
  const delta = Number.isFinite(input.delta) && input.delta > 0 ? Math.min(input.delta, 0.1) : 0;
  const steer = Number.isFinite(input.steer) ? clamp(input.steer, -1, 1) : 0;
  const acceleration = Number.isFinite(input.acceleration) ? Math.max(0, input.acceleration) : 0;
  const limit = Number.isFinite(input.limit) ? Math.max(0, input.limit) : 0;

  let velocity = Number.isFinite(state.velocity) ? state.velocity : 0;
  let position = Number.isFinite(state.position) ? state.position : 0;

  if (steer !== 0 && acceleration > 0) {
    velocity += steer * acceleration * delta;
  } else {
    // Settle towards straight, and stop exactly there rather than oscillating.
    const settle = acceleration * SWOOP_LATERAL_SETTLE_FACTOR * delta;
    if (Math.abs(velocity) <= settle) velocity = 0;
    else velocity -= Math.sign(velocity) * settle;
  }
  velocity = clamp(velocity, -SWOOP_LATERAL_MAX_SPEED, SWOOP_LATERAL_MAX_SPEED);
  position += velocity * delta;

  let wallHit = 0;
  if (limit > 0 && Math.abs(position) > limit) {
    // The wall is a wall: the bike stops dead against it. The impact speed is
    // reported so the caller can shake the rider by how hard they hit.
    wallHit = Math.abs(velocity);
    position = clamp(position, -limit, limit);
    velocity = 0;
  }
  return { state: { position, velocity }, wallHit };
}
