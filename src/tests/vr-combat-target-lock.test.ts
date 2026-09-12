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
});
