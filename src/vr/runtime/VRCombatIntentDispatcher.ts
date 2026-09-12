import {
  VRCombatIntent,
  VRCombatIntentQueue,
  VRCombatRequiredInput,
} from "@/vr/runtime/VRCombatIntentQueue";

export interface VRCombatDispatchDependencies<TTarget, TResolvedIntent> {
  resolveLiveTarget(): TTarget | undefined;
  resolveIntent(intent: Readonly<VRCombatIntent>, target: TTarget): TResolvedIntent | undefined;
  dispatchIntent(intent: TResolvedIntent, target: TTarget): boolean;
  dispatchBasic(target: TTarget): boolean;
}

export interface VRCombatIntentDispatchInput {
  readonly currentWeaponSignature: string;
  readonly input: VRCombatRequiredInput;
}

export type VRCombatIntentDispatchResult =
  | Readonly<{ state: "basic-dispatched" }>
  | Readonly<{ state: "intent-dispatched"; intent: Readonly<VRCombatIntent> }>
  | Readonly<{ state: "intent-skipped-invalid"; intent: Readonly<VRCombatIntent>; basicDispatched: boolean }>
  | Readonly<{ state: "deferred-input-mismatch"; intent: Readonly<VRCombatIntent>; basicDispatched: boolean }>
  | Readonly<{ state: "deferred-weapon-mismatch"; intent: Readonly<VRCombatIntent>; basicDispatched: boolean }>
  | Readonly<{ state: "rejected"; reason: "target-unavailable" | "engine-rejected" }>;

/**
 * Dispatches exactly one player combat input. It never owns an engine object:
 * the injected resolvers make target and action validity current at the point
 * of the physical swing, trigger press, or force gesture.
 */
export class VRCombatIntentDispatcher<TTarget, TResolvedIntent> {
  constructor(
    private readonly queue: VRCombatIntentQueue,
    private readonly dependencies: Readonly<VRCombatDispatchDependencies<TTarget, TResolvedIntent>>,
  ) {
    if (!queue || !dependencies) {
      throw new TypeError("A combat queue and dispatch dependencies are required.");
    }
  }

  dispatch(input: Readonly<VRCombatIntentDispatchInput>): VRCombatIntentDispatchResult {
    const target = this.dependencies.resolveLiveTarget();
    if (!target) {
      return Object.freeze({ state: "rejected" as const, reason: "target-unavailable" as const });
    }

    const headStatus = this.queue.getHeadStatus(input);
    switch (headStatus.state) {
      case "empty":
        return this.dispatchBasic(target);
      case "input-mismatch":
        return Object.freeze({
          state: "deferred-input-mismatch" as const,
          intent: headStatus.intent,
          basicDispatched: this.dependencies.dispatchBasic(target),
        });
      case "weapon-mismatch":
        return Object.freeze({
          state: "deferred-weapon-mismatch" as const,
          intent: headStatus.intent,
          basicDispatched: this.dependencies.dispatchBasic(target),
        });
      case "ready":
        return this.dispatchHead(headStatus.intent, target);
    }
  }

  private dispatchHead(intent: Readonly<VRCombatIntent>, target: TTarget): VRCombatIntentDispatchResult {
    const resolvedIntent = this.dependencies.resolveIntent(intent, target);
    if (!resolvedIntent) {
      this.queue.consumeHead();
      return Object.freeze({
        state: "intent-skipped-invalid" as const,
        intent,
        basicDispatched: this.dependencies.dispatchBasic(target),
      });
    }
    if (!this.dependencies.dispatchIntent(resolvedIntent, target)) {
      return Object.freeze({ state: "rejected" as const, reason: "engine-rejected" as const });
    }
    this.queue.consumeHead();
    return Object.freeze({ state: "intent-dispatched" as const, intent });
  }

  private dispatchBasic(target: TTarget): VRCombatIntentDispatchResult {
    if (!this.dependencies.dispatchBasic(target)) {
      return Object.freeze({ state: "rejected" as const, reason: "engine-rejected" as const });
    }
    return Object.freeze({ state: "basic-dispatched" as const });
  }
}
