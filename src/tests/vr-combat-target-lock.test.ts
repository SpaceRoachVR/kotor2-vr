import { describe, expect, it } from "@jest/globals";
import { VRCombatTargetLock } from "@/vr/runtime/VRCombatTargetLock";

describe("VRCombatTargetLock", () => {
  it("acquires the first valid aimed target immediately", () => {
    const lock = new VRCombatTargetLock();

    expect(lock.update({ candidateTargetId: "enemy-a", nowMilliseconds: 100 })).toEqual({
      lockedTargetId: "enemy-a",
      pendingTargetId: undefined,
      lockExpiresAtMilliseconds: 600,
      pendingSinceMilliseconds: undefined,
    });
  });

  it("retains a lock through its 500 ms aim-loss grace and clears after it", () => {
    const lock = new VRCombatTargetLock();
    lock.update({ candidateTargetId: "enemy-a", nowMilliseconds: 100 });

    expect(lock.update({ nowMilliseconds: 600 }).lockedTargetId).toBe("enemy-a");
    expect(lock.update({ nowMilliseconds: 601 }).lockedTargetId).toBeUndefined();
  });

  it("requires continuous 180 ms dwell before switching to another target", () => {
    const lock = new VRCombatTargetLock();
    lock.update({ candidateTargetId: "enemy-a", nowMilliseconds: 0 });

    expect(lock.update({ candidateTargetId: "enemy-b", nowMilliseconds: 20 })).toEqual({
      lockedTargetId: "enemy-a",
      pendingTargetId: "enemy-b",
      lockExpiresAtMilliseconds: 500,
      pendingSinceMilliseconds: 20,
    });
    expect(lock.update({ candidateTargetId: "enemy-b", nowMilliseconds: 199 }).lockedTargetId).toBe("enemy-a");
    expect(lock.update({ candidateTargetId: "enemy-b", nowMilliseconds: 200 })).toEqual({
      lockedTargetId: "enemy-b",
      pendingTargetId: undefined,
      lockExpiresAtMilliseconds: 700,
      pendingSinceMilliseconds: undefined,
    });
  });

  it("cancels a pending switch when aim returns to the lock", () => {
    const lock = new VRCombatTargetLock();
    lock.update({ candidateTargetId: "enemy-a", nowMilliseconds: 0 });
    lock.update({ candidateTargetId: "enemy-b", nowMilliseconds: 20 });

    expect(lock.update({ candidateTargetId: "enemy-a", nowMilliseconds: 40 })).toEqual({
      lockedTargetId: "enemy-a",
      pendingTargetId: undefined,
      lockExpiresAtMilliseconds: 540,
      pendingSinceMilliseconds: undefined,
    });
  });

  it("rejects unsafe frame input without corrupting its existing lock", () => {
    const lock = new VRCombatTargetLock();
    lock.update({ candidateTargetId: "enemy-a", nowMilliseconds: 0 });

    expect(() => lock.update({ candidateTargetId: "", nowMilliseconds: 1 })).toThrow(RangeError);
    expect(() => lock.update({ candidateTargetId: "enemy-b", nowMilliseconds: Number.NaN })).toThrow(RangeError);
    expect(lock.getSnapshot().lockedTargetId).toBe("enemy-a");
  });

  describe("switching when the barrel is clearly on another target", () => {
    const offsets = (entries: Record<string, number>) => new Map(Object.entries(entries));

    it("switches at once when the barrel is clearly closer to the new target", () => {
      // Bolt, round 17: barrel 1.3 degrees from trooper C, 8 from the locked A.
      // The 400 ms dwell sent every snap shot in that window to A.
      const lock = new VRCombatTargetLock({ switchDwellMilliseconds: 400 });
      lock.update({ candidateTargetId: "a", nowMilliseconds: 0 });
      expect(lock.update({
        candidateTargetId: "c",
        nowMilliseconds: 16,
        aimOffsetsDegrees: offsets({ a: 8, c: 1.3 }),
      }).lockedTargetId).toBe("c");
    });

    it("keeps the dwell for targets within 3 degrees of each other", () => {
      const lock = new VRCombatTargetLock({ switchDwellMilliseconds: 400 });
      lock.update({ candidateTargetId: "a", nowMilliseconds: 0 });
      const aimOffsetsDegrees = offsets({ a: 2.5, c: 0.5 });
      expect(lock.update({ candidateTargetId: "c", nowMilliseconds: 16, aimOffsetsDegrees }).lockedTargetId).toBe("a");
      expect(lock.update({ candidateTargetId: "c", nowMilliseconds: 415, aimOffsetsDegrees }).lockedTargetId).toBe("a");
      expect(lock.update({ candidateTargetId: "c", nowMilliseconds: 416, aimOffsetsDegrees }).lockedTargetId).toBe("c");
    });

    it("switches at once when the locked target is out of the aim set altogether", () => {
      const lock = new VRCombatTargetLock({ switchDwellMilliseconds: 400 });
      lock.update({ candidateTargetId: "a", nowMilliseconds: 0 });
      expect(lock.update({
        candidateTargetId: "c",
        nowMilliseconds: 16,
        aimOffsetsDegrees: offsets({ c: 1 }),
      }).lockedTargetId).toBe("c");
    });

    it("keeps the old dwell when no offsets are given", () => {
      const lock = new VRCombatTargetLock({ switchDwellMilliseconds: 400 });
      lock.update({ candidateTargetId: "a", nowMilliseconds: 0 });
      expect(lock.update({ candidateTargetId: "c", nowMilliseconds: 16 }).lockedTargetId).toBe("a");
    });

    it("keeps the dwell when the new candidate has no offset of its own", () => {
      const lock = new VRCombatTargetLock({ switchDwellMilliseconds: 400 });
      lock.update({ candidateTargetId: "a", nowMilliseconds: 0 });
      expect(lock.update({
        candidateTargetId: "c",
        nowMilliseconds: 16,
        aimOffsetsDegrees: offsets({ a: 9 }),
      }).lockedTargetId).toBe("a");
    });
  });
});
