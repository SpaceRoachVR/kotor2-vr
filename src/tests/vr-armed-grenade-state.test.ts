import { describe, expect, it } from "@jest/globals";
import {
  VRArmedGrenadeDescriptor,
  VRArmedGrenadeState,
} from "@/vr/runtime/VRArmedGrenadeState";

const plasmaGrenade: VRArmedGrenadeDescriptor = {
  sourceKey: "item:plasma-grenade:42",
  itemObjectId: 42,
  label: "Plasma Grenade",
  icon: "i_grenade_plasma",
};

describe("VRArmedGrenadeState", () => {
  it("arms a grenade independently from the special queue", () => {
    const state = new VRArmedGrenadeState();

    expect(state.arm(plasmaGrenade)).toEqual({ armed: plasmaGrenade });
    expect(state.requestCommit()).toEqual({ state: "armed", grenade: plasmaGrenade });
  });

  it("replaces an armed grenade with the latest wheel selection", () => {
    const state = new VRArmedGrenadeState();
    state.arm(plasmaGrenade);
    const sonicGrenade = { ...plasmaGrenade, sourceKey: "item:sonic-grenade:43", itemObjectId: 43 };

    expect(state.arm(sonicGrenade)).toEqual({ armed: sonicGrenade });
  });

  it("retains the grenade until the engine accepts the triggered throw", () => {
    const state = new VRArmedGrenadeState();
    state.arm(plasmaGrenade);

    expect(state.completeCommit({ sourceKey: plasmaGrenade.sourceKey, engineAccepted: false }))
      .toEqual({ armed: plasmaGrenade });
    expect(state.completeCommit({ sourceKey: plasmaGrenade.sourceKey, engineAccepted: true }))
      .toEqual({ armed: undefined });
  });

  it("does not clear a newly armed grenade when a stale dispatch response arrives", () => {
    const state = new VRArmedGrenadeState();
    state.arm(plasmaGrenade);
    const sonicGrenade = { ...plasmaGrenade, sourceKey: "item:sonic-grenade:43", itemObjectId: 43 };
    state.arm(sonicGrenade);

    expect(state.completeCommit({ sourceKey: plasmaGrenade.sourceKey, engineAccepted: true }))
      .toEqual({ armed: sonicGrenade });
  });

  it("cancels armed state for every lifecycle reset", () => {
    const state = new VRArmedGrenadeState();
    state.arm(plasmaGrenade);

    state.cancel();

    expect(state.getSnapshot()).toEqual({ armed: undefined });
    expect(state.requestCommit()).toEqual({ state: "empty" });
  });

  it("rejects malformed descriptors without changing an armed grenade", () => {
    const state = new VRArmedGrenadeState();
    state.arm(plasmaGrenade);

    expect(() => state.arm({ ...plasmaGrenade, itemObjectId: Number.NaN })).toThrow(RangeError);
    expect(state.getSnapshot()).toEqual({ armed: plasmaGrenade });
  });
});
