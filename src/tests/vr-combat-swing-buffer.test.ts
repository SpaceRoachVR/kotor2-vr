import { describe, expect, it } from "@jest/globals";
import {
  VRCombatSwingBuffer,
  isVRCombatSwingBufferable,
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

  it.each(["round-active", "scheduled-action-pending", "player-action-committed"] as const)(
    "buffers %s",
    (reason) => expect(isVRCombatSwingBufferable(reason)).toBe(true),
  );

  it.each([
    "ready",
    "actor-unavailable",
    "target-unavailable",
    "combat-round-unavailable",
    "round-paused",
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
