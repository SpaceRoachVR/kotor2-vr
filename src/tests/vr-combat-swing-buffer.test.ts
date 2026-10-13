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
  it("holds a stroke and releases it once", () => {
    const buffer = new VRCombatSwingBuffer();
    buffer.hold(swing());
    expect(buffer.hasPending).toBe(true);

    expect(buffer.release(context())).toEqual({ state: "released", swing: swing() });
    expect(buffer.hasPending).toBe(false);
    expect(buffer.release(context())).toEqual({ state: "empty" });
  });

  it.each(["round-paused", "round-active", "scheduled-action-pending", "player-action-committed"] as const)(
    "a Force power committed during %s waits for the round",
    (reason) => expect(isVRCombatSwingBufferable(reason)).toBe(true),
  );

  it.each([
    "ready",
    "actor-unavailable",
    "target-unavailable",
    "combat-round-unavailable",
    "engine-extra-attack-window",
  ] as const)("%s is not a busy round", (reason) => {
    expect(isVRCombatSwingBufferable(reason)).toBe(false);
  });

  it("keeps only the latest stroke: several strokes are one attack", () => {
    const buffer = new VRCombatSwingBuffer();
    buffer.hold(swing({ targetId: "1" }));
    buffer.hold(swing({ targetId: "2" }));
    buffer.hold(swing({ targetId: "3" }));

    const released = buffer.release(context());
    expect(released).toEqual({ state: "released", swing: swing({ targetId: "3" }) });
  });

  it("never releases at a new enemy after the held target died", () => {
    const buffer = new VRCombatSwingBuffer();
    buffer.hold(swing({ targetId: "42" }));

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
    buffer.hold(swing());
    expect(buffer.release(context(overrides))).toEqual({ state: "dropped", reason });
  });

  it("invalidates a stale stroke without waiting for the round", () => {
    const buffer = new VRCombatSwingBuffer();
    buffer.hold(swing());

    expect(buffer.invalidate(context())).toBeNull();
    expect(buffer.hasPending).toBe(true);
    expect(buffer.invalidate(context({ isTargetLive: () => false }))).toBe("target-invalid");
    expect(buffer.hasPending).toBe(false);
  });

  it("does not hold a Force gesture, which has its own queue route", () => {
    const buffer = new VRCombatSwingBuffer();
    expect(() => buffer.hold(swing({ input: "directional-force-gesture" }))).toThrow(TypeError);
  });

  it("stores a copy, so a caller mutating its event cannot retarget the stroke", () => {
    const buffer = new VRCombatSwingBuffer();
    const event = { ...swing() } as { -readonly [K in keyof VRCombatBufferedSwing]: VRCombatBufferedSwing[K] };
    buffer.hold(event);
    event.targetId = "99";
    expect(buffer.peek()?.targetId).toBe("42");
  });
});

/**
 * Round 18 (the silent hold): a stroke is held only when the next round is a
 * moment away. Game time only: a pause neither ages it nor clears it.
 */
describe("VRHeldSwingLifetime", () => {
  const frames = (lifetime: VRHeldSwingLifetime, seconds: number, step = 1 / 30) => {
    let expired = false;
    for (let t = 0; t < seconds - 1e-9 && !expired; t += step) expired = lifetime.advance(step);
    return expired;
  };

  it("lives for its short hold", () => {
    expect(frames(new VRHeldSwingLifetime(600), 0.55)).toBe(false);
  });

  it("drops, silently, once it has waited too long", () => {
    expect(frames(new VRHeldSwingLifetime(600), 0.65)).toBe(true);
  });

  it("restarts for a newer stroke", () => {
    const lifetime = new VRHeldSwingLifetime(600);
    frames(lifetime, 0.5);
    lifetime.restart();
    expect(frames(lifetime, 0.5)).toBe(false);
  });

  it("ignores a non-finite or negative frame time", () => {
    const lifetime = new VRHeldSwingLifetime(600);
    expect(lifetime.advance(Number.NaN)).toBe(false);
    expect(lifetime.advance(-5)).toBe(false);
    expect(lifetime.advance(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("needs a positive lifetime", () => {
    expect(() => new VRHeldSwingLifetime(0)).toThrow(TypeError);
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
