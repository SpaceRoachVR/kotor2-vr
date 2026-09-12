import { describe, expect, it } from "@jest/globals";
import {
  VRCombatIntent,
  VRCombatIntentQueue,
} from "@/vr/runtime/VRCombatIntentQueue";

const flurry: VRCombatIntent = {
  sourceKey: "feat:flurry",
  label: "Flurry",
  icon: "i_flurry",
  kind: "attack-feat",
  requiredInput: "dominant-swing",
  weaponSignature: "melee:vibroblade",
};

const powerAttack: VRCombatIntent = {
  sourceKey: "feat:power-attack",
  label: "Power Attack",
  icon: "i_powerattack",
  kind: "attack-feat",
  requiredInput: "dominant-swing",
  weaponSignature: "melee:vibroblade",
};

const forceLightning: VRCombatIntent = {
  sourceKey: "spell:force-lightning",
  label: "Force Lightning",
  icon: "ip_fe_lightning",
  kind: "force-power",
  requiredInput: "dominant-trigger",
  weaponSignature: "any",
};

describe("VRCombatIntentQueue", () => {
  it("keeps up to three selected specials in FIFO order", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    queue.enqueue(powerAttack);
    queue.enqueue(forceLightning);

    const fourth = queue.enqueue({ ...flurry, sourceKey: "feat:critical" });

    expect(fourth.accepted).toBe(false);
    expect(fourth.reason).toBe("full");
    expect(queue.getSnapshot().entries.map((entry) => entry.sourceKey)).toEqual([
      "feat:flurry",
      "feat:power-attack",
      "spell:force-lightning",
    ]);
  });

  it("consumes only the FIFO head", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    queue.enqueue(powerAttack);

    expect(queue.consumeHead().consumed).toEqual(flurry);
    expect(queue.getHead()).toEqual(powerAttack);
  });

  it("reports a head mismatch without consuming or leapfrogging later entries", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    queue.enqueue(forceLightning);

    expect(queue.getHeadStatus({
      currentWeaponSignature: "melee:vibroblade",
      input: "dominant-trigger",
    })).toMatchObject({ state: "input-mismatch", intent: flurry });
    expect(queue.getSnapshot().entries).toHaveLength(2);
    expect(queue.getHead()).toEqual(flurry);
  });

  it("reports a weapon mismatch without changing the selected order", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);

    expect(queue.getHeadStatus({
      currentWeaponSignature: "ranged:blaster-rifle",
      input: "dominant-swing",
    })).toMatchObject({ state: "weapon-mismatch", intent: flurry });
    expect(queue.getHead()).toEqual(flurry);
  });

  it("returns immutable snapshots and clears every entry on weapon change", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    const snapshot = queue.getSnapshot();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.entries)).toBe(true);
    expect(Object.isFrozen(snapshot.entries[0])).toBe(true);

    queue.clearForWeaponChange();
    expect(queue.getSnapshot().entries).toEqual([]);
  });

  it("rejects malformed intents without altering a valid queue", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);

    expect(() => queue.enqueue({ ...flurry, sourceKey: "" })).toThrow(RangeError);
    expect(() => queue.enqueue({ ...flurry, requiredInput: "release" as never })).toThrow(RangeError);
    expect(queue.getHead()).toEqual(flurry);
  });
});
