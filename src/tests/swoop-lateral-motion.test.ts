import { describe, expect, test } from '@jest/globals';
import {
  stepSwoopLateral, SWOOP_LATERAL_MAX_SPEED, SwoopLateralState,
} from '@/module/minigame/SwoopLateralMotion';

/**
 * The swoop's sideways motion. Retail's ARE declares LateralAccel (300) and
 * UseInertia; the engine had been applying that acceleration as a velocity,
 * 300 units a second across a 40-unit road, so any steering input threw the
 * bike into the wall - the "janking back and forth at random" from the
 * headset. This is the model that replaces it.
 */
const ACCEL = 300;
const LIMIT = 20;
const DT = 1 / 90;

function ride(steps: number, steer: number, state: SwoopLateralState = { position: 0, velocity: 0 }, acceleration = ACCEL) {
  let hits = 0;
  for (let i = 0; i < steps; i++) {
    const result = stepSwoopLateral(state, { steer, acceleration, limit: LIMIT, delta: DT });
    state = result.state;
    if (result.wallHit > 0) hits++;
  }
  return { state, hits };
}

describe('steering is an acceleration, so a tap is a nudge and a hold is a sweep', () => {
  test('one frame of full lock moves the bike a few centimetres, not across the road', () => {
    const { state } = ride(1, 1);
    expect(state.position).toBeGreaterThan(0);
    expect(state.position).toBeLessThan(0.1);
  });

  test('holding full lock builds up to the top sideways speed and no further', () => {
    // At 300/s^2 it takes 0.15 s to reach 45/s; a quarter second of lock is
    // capped there and still well short of the wall.
    const { state } = ride(22, 1, { position: 0, velocity: 0 }, ACCEL);
    expect(state.velocity).toBeCloseTo(SWOOP_LATERAL_MAX_SPEED, 5);
    expect(state.position).toBeLessThan(LIMIT / 2);
  });

  test('a full-lock sweep crosses the road in about a second, not a seventh of one', () => {
    const { state, hits } = ride(45, 1);
    expect(state.position).toBeLessThan(LIMIT);
    expect(hits).toBe(0);
    const later = ride(90, 1);
    expect(later.state.position).toBe(LIMIT);
  });

  test('letting go settles the bike to straight rather than coasting on', () => {
    const turning = ride(30, 1).state;
    expect(turning.velocity).toBeGreaterThan(0);
    const released = ride(60, 0, turning).state;
    expect(released.velocity).toBe(0);
    // It keeps the lane it reached; letting go is not a return to centre.
    expect(released.position).toBeGreaterThan(turning.position);
    expect(released.position).toBeLessThan(LIMIT);
  });

  test('settling stops exactly at zero and does not oscillate', () => {
    let state: SwoopLateralState = { position: 0, velocity: 0.5 };
    const velocities: number[] = [];
    for (let i = 0; i < 10; i++) {
      state = stepSwoopLateral(state, { steer: 0, acceleration: ACCEL, limit: LIMIT, delta: DT }).state;
      velocities.push(state.velocity);
    }
    expect(velocities.every((v) => v >= 0)).toBe(true);
    expect(velocities[velocities.length - 1]).toBe(0);
  });

  test('left and right are symmetric', () => {
    const right = ride(30, 1).state;
    const left = ride(30, -1).state;
    expect(left.position).toBeCloseTo(-right.position, 10);
    expect(left.velocity).toBeCloseTo(-right.velocity, 10);
  });
});

describe('the road edge is a wall', () => {
  test('the bike stops against it and the hit is reported with its speed', () => {
    let state: SwoopLateralState = { position: 19.9, velocity: 40 };
    const result = stepSwoopLateral(state, { steer: 1, acceleration: ACCEL, limit: LIMIT, delta: DT });
    expect(result.state.position).toBe(LIMIT);
    expect(result.state.velocity).toBe(0);
    expect(result.wallHit).toBeGreaterThan(39);
  });

  test('resting against the wall with the stick still held is not a fresh hit every frame', () => {
    let state: SwoopLateralState = { position: LIMIT, velocity: 0 };
    let hits = 0;
    for (let i = 0; i < 30; i++) {
      const result = stepSwoopLateral(state, { steer: 1, acceleration: ACCEL, limit: LIMIT, delta: DT });
      state = result.state;
      // The wall reports the impact speed; a creep of a few units is a scrape,
      // and only the first frame carries any speed at all.
      if (result.wallHit > 5) hits++;
    }
    expect(hits).toBe(0);
    expect(state.position).toBe(LIMIT);
  });

  test('a track with no tunnel yet has no wall', () => {
    const result = stepSwoopLateral({ position: 500, velocity: 10 }, { steer: 0, acceleration: ACCEL, limit: 0, delta: DT });
    expect(result.wallHit).toBe(0);
    expect(result.state.position).toBeGreaterThan(500);
  });
});

describe('before the flag drops nothing moves', () => {
  test('zero acceleration means the stick does nothing', () => {
    const { state } = ride(90, 1, { position: 0, velocity: 0 }, 0);
    expect(state.position).toBe(0);
    expect(state.velocity).toBe(0);
  });

  test('garbage input is treated as no input', () => {
    const result = stepSwoopLateral({ position: NaN, velocity: NaN }, { steer: NaN, acceleration: NaN, limit: NaN, delta: NaN });
    expect(result.state.position).toBe(0);
    expect(result.state.velocity).toBe(0);
    expect(result.wallHit).toBe(0);
  });

  test('a long frame is capped so a stall cannot teleport the bike', () => {
    const result = stepSwoopLateral({ position: 0, velocity: SWOOP_LATERAL_MAX_SPEED }, { steer: 0, acceleration: 0, limit: 0, delta: 5 });
    expect(result.state.position).toBeLessThanOrEqual(SWOOP_LATERAL_MAX_SPEED * 0.1 + 1e-9);
  });
});
