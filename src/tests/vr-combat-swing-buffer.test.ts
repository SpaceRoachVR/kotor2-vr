import { describe, expect, it } from "@jest/globals";
import {
  VRCombatSwingBuffer,
  VRHeldSwingLifetime,
  isVRCombatSwingBufferable,
  isVRFightOngoing,
  type VRCombatBufferedSwing,
  type VRCombatSwingBufferReleaseContext,
} from "@/vr/runtime/VRCombatSwingBuffer";

const swing = (overrides: Partial<VRCombatBufferedSwing> = {}): VRCombatBufferedSwing => ({
  actorId: "7",
  targetId: "42",
  input: "dominant-swing",
  weaponSignature: "melee-one-handed",
  ...overrides,
});

const context = (
  overrides: Partial<VRCombatSwingBufferReleaseContext> = {},
): VRCombatSwingBufferReleaseContext => ({
  actorId: "7",
  weaponSignature: "melee-one-handed",
  inCombat: true,
  isTargetLive: () => true,
  ...overrides,
});

describe("VRCombatSwingBuffer", () => {
  it("holds a swing refused because the round is busy and releases it once", () => {
    const buffer = new VRCombatSwingBuffer();
    expect(buffer.offer(swing(), "round-active")).toBe(true);
    expect(buffer.hasPending).toBe(true);

    expect(buffer.release(context())).toEqual({ state: "released", swing: swing() });
    expect(buffer.hasPending).toBe(false);
    expect(buffer.release(context())).toEqual({ state: "empty" });
  });

  it.each(["round-paused", "round-active", "scheduled-action-pending", "player-action-committed"] as const)(
    "buffers %s",
    (reason) => expect(isVRCombatSwingBufferable(reason)).toBe(true),
  );

  it.each([
    "ready",
    "actor-unavailable",
    "target-unavailable",
    "combat-round-unavailable",
    "engine-extra-attack-window",
  ] as const)("does not buffer %s", (reason) => {
    const buffer = new VRCombatSwingBuffer();
    expect(buffer.offer(swing(), reason)).toBe(false);
    expect(buffer.hasPending).toBe(false);
  });

  it("keeps only the latest swing: several swings in one round are one attack", () => {
    const buffer = new VRCombatSwingBuffer();
    buffer.offer(swing({ targetId: "1" }), "round-active");
    buffer.offer(swing({ targetId: "2" }), "round-active");
    buffer.offer(swing({ targetId: "3" }), "round-active");

    const released = buffer.release(context());
    expect(released).toEqual({ state: "released", swing: swing({ targetId: "3" }) });
  });

  it("never releases at a new enemy after the buffered target died", () => {
    const buffer = new VRCombatSwingBuffer();
    buffer.offer(swing({ targetId: "42" }), "round-active");

    const released = buffer.release(context({ isTargetLive: (id) => id !== "42" }));
    expect(released).toEqual({ state: "dropped", reason: "target-invalid" });
    expect(buffer.hasPending).toBe(false);
  });

  it.each([
    ["a party swap", { actorId: "8" }, "actor-changed"],
    ["a weapon change", { weaponSignature: "blaster" }, "weapon-changed"],
    ["the end of combat", { inCombat: false }, "combat-ended"],
  ] as const)("drops on %s", (_name, overrides, reason) => {
    const buffer = new VRCombatSwingBuffer();
    buffer.offer(swing(), "round-active");
    expect(buffer.release(context(overrides))).toEqual({ state: "dropped", reason });
  });

  it("invalidates a stale swing without waiting for the round to open", () => {
    const buffer = new VRCombatSwingBuffer();
    buffer.offer(swing(), "round-active");

    expect(buffer.invalidate(context())).toBeNull();
    expect(buffer.hasPending).toBe(true);
    expect(buffer.invalidate(context({ isTargetLive: () => false }))).toBe("target-invalid");
    expect(buffer.hasPending).toBe(false);
  });

  it("does not hold a Force gesture, which has its own queue route", () => {
    const buffer = new VRCombatSwingBuffer();
    expect(() => buffer.offer(swing({ input: "directional-force-gesture" }), "round-active"))
      .toThrow(TypeError);
  });

  it("stores a copy, so a caller mutating its event cannot retarget the swing", () => {
    const buffer = new VRCombatSwingBuffer();
    const event = { ...swing() } as { -readonly [K in keyof VRCombatBufferedSwing]: VRCombatBufferedSwing[K] };
    buffer.offer(event, "round-active");
    event.targetId = "99";
    expect(buffer.peek()?.targetId).toBe("42");
  });
});

/**
 * Round 17 (Tempo finding 1, locked by Allen): a held swing belongs to the
 * next round opening only. It releases within 0.5 s of that opening or drops;
 * it never fires on stepping back into reach seconds later. Game time only:
 * a pause neither ages it nor clears it.
 */
describe("VRHeldSwingLifetime", () => {
  const frames = (lifetime: VRHeldSwingLifetime, roundOpen: boolean, seconds: number, step = 1 / 30) => {
    let expired: ReturnType<VRHeldSwingLifetime["advance"]> = null;
    for (let t = 0; t < seconds - 1e-9 && !expired; t += step) expired = lifetime.advance(roundOpen, step);
    return expired;
  };

  it("lives through the busy round that held it", () => {
    const lifetime = new VRHeldSwingLifetime();
    expect(frames(lifetime, false, 2.9)).toBeNull();
  });

  it("drops 0.5 s after the opening when it could not release (out of reach at the opening)", () => {
    const lifetime = new VRHeldSwingLifetime();
    frames(lifetime, false, 1.5);
    expect(frames(lifetime, true, 0.45)).toBeNull();
    expect(frames(lifetime, true, 0.1)).toBe("opening-passed");
  });

  it("drops when the opening closes again without it", () => {
    const lifetime = new VRHeldSwingLifetime();
    frames(lifetime, false, 1);
    frames(lifetime, true, 0.2);
    expect(lifetime.advance(false, 1 / 30)).toBe("opening-missed");
  });

  it("never outlives two rounds, even if no round ever opens", () => {
    const lifetime = new VRHeldSwingLifetime();
    expect(frames(lifetime, false, 6.1)).toBe("held-too-long");
  });

  it("restarts for a newer swing", () => {
    const lifetime = new VRHeldSwingLifetime();
    frames(lifetime, false, 1);
    frames(lifetime, true, 0.4);
    lifetime.restart();
    expect(frames(lifetime, false, 2)).toBeNull();
    expect(frames(lifetime, true, 0.45)).toBeNull();
  });

  it("ignores a non-finite or negative frame time", () => {
    const lifetime = new VRHeldSwingLifetime();
    expect(lifetime.advance(true, Number.NaN)).toBeNull();
    expect(lifetime.advance(true, -5)).toBeNull();
    expect(lifetime.advance(true, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

/**
 * Round 17 (Tempo finding 2): in a group fight the player's own combat flag
 * drops between its rounds while hostiles shoot the companions, and the held
 * swing was thrown away as "combat ended". The fight decides, not the flag.
 */
describe("isVRFightOngoing", () => {
  it.each([
    [{ actorInCombat: true, lockedTargetLive: false, hostileEngagedWithParty: false }, true],
    [{ actorInCombat: false, lockedTargetLive: true, hostileEngagedWithParty: false }, true],
    [{ actorInCombat: false, lockedTargetLive: false, hostileEngagedWithParty: true }, true],
    [{ actorInCombat: false, lockedTargetLive: false, hostileEngagedWithParty: false }, false],
  ] as const)("%o -> %s", (input, expected) => {
    expect(isVRFightOngoing(input)).toBe(expected);
  });
});
