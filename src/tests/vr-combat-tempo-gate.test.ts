import { describe, expect, it } from "@jest/globals";
import { VRCombatTempoGate } from "@/vr/runtime/VRCombatTempoGate";

describe("VRCombatTempoGate", () => {
  it("opens only for a living actor with a valid target and an idle engine round", () => {
    const gate = new VRCombatTempoGate();

    expect(gate.evaluate({
      actorCanAct: true,
      hasLiveTarget: true,
      combatRound: {
        roundStarted: false,
        roundPaused: false,
        scheduledActionCount: 0,
        playerActionCommitted: false,
        additionalActionWindowOpen: false,
      },
    })).toEqual({ eligible: true, reason: "ready" });
  });

  it.each([
    ["actor cannot act", {
      actorCanAct: false,
      hasLiveTarget: true,
      combatRound: idleRound(),
    }, "actor-unavailable"],
    ["target is missing", {
      actorCanAct: true,
      hasLiveTarget: false,
      combatRound: idleRound(),
    }, "target-unavailable"],
    ["combat round is missing", {
      actorCanAct: true,
      hasLiveTarget: true,
    }, "combat-round-unavailable"],
    ["round is paused", {
      actorCanAct: true,
      hasLiveTarget: true,
      combatRound: { ...idleRound(), roundPaused: true },
    }, "round-paused"],
    ["a user action is already committed", {
      actorCanAct: true,
      hasLiveTarget: true,
      combatRound: { ...idleRound(), playerActionCommitted: true },
    }, "player-action-committed"],
    ["an action is waiting for ActionCombat", {
      actorCanAct: true,
      hasLiveTarget: true,
      combatRound: { ...idleRound(), scheduledActionCount: 1 },
    }, "scheduled-action-pending"],
    ["the normal round is already active", {
      actorCanAct: true,
      hasLiveTarget: true,
      combatRound: { ...idleRound(), roundStarted: true },
    }, "round-active"],
  ] as const)("rejects when %s", (_description, snapshot, reason) => {
    const gate = new VRCombatTempoGate();

    expect(gate.evaluate(snapshot)).toEqual({ eligible: false, reason });
  });

  it("honors an engine-exposed extra-attack window without a local cooldown", () => {
    const gate = new VRCombatTempoGate();

    expect(gate.evaluate({
      actorCanAct: true,
      hasLiveTarget: true,
      combatRound: {
        roundStarted: true,
        roundPaused: false,
        scheduledActionCount: 0,
        playerActionCommitted: false,
        additionalActionWindowOpen: true,
      },
    })).toEqual({ eligible: true, reason: "engine-extra-attack-window" });
  });
});

function idleRound() {
  return {
    roundStarted: false,
    roundPaused: false,
    scheduledActionCount: 0,
    playerActionCommitted: false,
    additionalActionWindowOpen: false,
  };
}
