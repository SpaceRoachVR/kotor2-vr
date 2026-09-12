import { describe, expect, it } from "@jest/globals";
import {
  VRCombatDispatchDependencies,
  VRCombatIntentDispatcher,
} from "@/vr/runtime/VRCombatIntentDispatcher";
import { VRCombatIntent, VRCombatIntentQueue } from "@/vr/runtime/VRCombatIntentQueue";

const flurry: VRCombatIntent = {
  sourceKey: "feat:flurry",
  label: "Flurry",
  icon: "i_flurry",
  kind: "attack-feat",
  requiredInput: "dominant-swing",
  weaponSignature: "melee:vibroblade",
};

describe("VRCombatIntentDispatcher", () => {
  it("uses a basic attack when the queue is empty", () => {
    const queue = new VRCombatIntentQueue();
    const calls: string[] = [];
    const dispatcher = new VRCombatIntentDispatcher(queue, dependencies(calls));

    expect(dispatcher.dispatch({
      currentWeaponSignature: "melee:vibroblade",
      input: "dominant-swing",
    })).toEqual({ state: "basic-dispatched" });
    expect(calls).toEqual(["target", "basic:enemy-a"]);
  });

  it("resolves and consumes a matching head once at the live target", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    const calls: string[] = [];
    const dispatcher = new VRCombatIntentDispatcher(queue, dependencies(calls));

    expect(dispatcher.dispatch({
      currentWeaponSignature: "melee:vibroblade",
      input: "dominant-swing",
    })).toEqual({ state: "intent-dispatched", intent: flurry });
    expect(queue.getHead()).toBeUndefined();
    expect(calls).toEqual(["target", "resolve:feat:flurry:enemy-a", "intent:feat:flurry:enemy-a"]);
  });

  it("skips an invalid head then returns to basic tempo", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    const calls: string[] = [];
    const dispatcher = new VRCombatIntentDispatcher(queue, {
      ...dependencies(calls),
      resolveIntent: (): { id: string } | undefined => undefined,
    });

    expect(dispatcher.dispatch({
      currentWeaponSignature: "melee:vibroblade",
      input: "dominant-swing",
    })).toEqual({ state: "intent-skipped-invalid", intent: flurry, basicDispatched: true });
    expect(queue.getHead()).toBeUndefined();
    expect(calls).toEqual(["target", "basic:enemy-a"]);
  });

  it("keeps a mismatched head while allowing a valid basic input", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    const calls: string[] = [];
    const dispatcher = new VRCombatIntentDispatcher(queue, dependencies(calls));

    expect(dispatcher.dispatch({
      currentWeaponSignature: "melee:vibroblade",
      input: "dominant-trigger",
    })).toEqual({ state: "deferred-input-mismatch", intent: flurry, basicDispatched: true });
    expect(queue.getHead()).toEqual(flurry);
    expect(calls).toEqual(["target", "basic:enemy-a"]);
  });

  it("does not dispatch or consume without a current live lock", () => {
    const queue = new VRCombatIntentQueue();
    queue.enqueue(flurry);
    const calls: string[] = [];
    const dispatcher = new VRCombatIntentDispatcher(queue, {
      ...dependencies(calls),
      resolveLiveTarget: (): { id: string } | undefined => undefined,
    });

    expect(dispatcher.dispatch({
      currentWeaponSignature: "melee:vibroblade",
      input: "dominant-swing",
    })).toEqual({ state: "rejected", reason: "target-unavailable" });
    expect(queue.getHead()).toEqual(flurry);
    expect(calls).toEqual([]);
  });
});

function dependencies(calls: string[]): VRCombatDispatchDependencies<{ id: string }, { id: string }> {
  return {
    resolveLiveTarget: () => {
      calls.push("target");
      return { id: "enemy-a" };
    },
    resolveIntent: (intent: Readonly<VRCombatIntent>, target: { id: string }) => {
      calls.push(`resolve:${intent.sourceKey}:${target.id}`);
      return { id: intent.sourceKey };
    },
    dispatchIntent: (resolved: { id: string }, target: { id: string }) => {
      calls.push(`intent:${resolved.id}:${target.id}`);
      return true;
    },
    dispatchBasic: (target: { id: string }) => {
      calls.push(`basic:${target.id}`);
      return true;
    },
  };
}
