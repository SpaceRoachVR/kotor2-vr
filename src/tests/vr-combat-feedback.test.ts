import { describe, expect, it } from "@jest/globals";
import * as THREE from "three";
import { VR_COMBAT_HAPTICS, resolveVRCombatFeedback } from "@/vr/runtime/VRCombatFeedback";
import {
  VRCombatAttackResultObserver,
  type VRCombatActorSnapshot,
} from "@/vr/runtime/VRCombatVisualEvents";
import { VRBladeSparkHost } from "@/vr/runtime/VRBladeSparkHost";
import { BOLT_TRAVEL_MS, VRBlasterBoltHost } from "@/vr/runtime/VRBlasterBoltHost";

const PLAYER = 7;
const ENEMY = 42;

describe("resolveVRCombatFeedback (ROADMAP 3.13)", () => {
  const mine = (attackResult: number) =>
    resolveVRCombatFeedback({ attackerId: PLAYER, targetId: ENEMY, attackResult, localActorId: PLAYER });
  const theirs = (attackResult: number, targetId = PLAYER) =>
    resolveVRCombatFeedback({ attackerId: ENEMY, targetId, attackResult, localActorId: PLAYER });

  it("gives hit, miss and critical patterns that differ in strength and count", () => {
    expect(mine(1)?.pulses).toEqual([VR_COMBAT_HAPTICS.hit]);
    expect(mine(3)?.outcome).toBe("hit");
    expect(mine(4)?.pulses).toEqual([VR_COMBAT_HAPTICS.miss]);
    expect(mine(5)?.outcome).toBe("miss");
    expect(mine(2)?.pulses).toHaveLength(2);
    expect(mine(2)?.outcome).toBe("critical");

    const peak = (result: number) => Math.max(...mine(result)!.pulses.map((pulse) => pulse.amplitude));
    expect(peak(4)).toBeLessThan(peak(1));
    expect(peak(1)).toBeLessThan(peak(2));
  });

  it("stays clear of the 25 ms round-ready tick", () => {
    for (const result of [1, 2, 4, 8, 9]) {
      for (const pulse of mine(result)?.pulses ?? []) {
        expect(pulse).not.toEqual({ durationMs: 25, amplitude: 0.25 });
      }
    }
  });

  it("sparks when the player's attack is parried or the player parries", () => {
    expect(mine(8)).toMatchObject({ role: "attacker", outcome: "parried", effect: "clash" });
    expect(theirs(8)).toMatchObject({ role: "defender", outcome: "parried", effect: "clash" });
  });

  it("draws an incoming bolt the player deflected to their blade", () => {
    expect(theirs(9)).toMatchObject({ role: "defender", effect: "deflect" });
    // The player's own bolt batted away by a Jedi is a miss for the shooter.
    expect(mine(9)).toMatchObject({ role: "attacker", outcome: "deflected", effect: "none" });
  });

  it("leaves being hit to 3.14 and ignores fights the player is not in", () => {
    expect(theirs(1)).toBeNull();
    expect(theirs(2)).toBeNull();
    expect(theirs(8, 99)).toBeNull();
    expect(resolveVRCombatFeedback({ attackerId: PLAYER, targetId: ENEMY, attackResult: 1, localActorId: null }))
      .toBeNull();
  });

  it("feels nothing for INVALID or ATTACK_FAILED", () => {
    expect(mine(0)).toBeNull();
    expect(mine(6)).toBeNull();
  });
});

describe("VRCombatAttackResultObserver", () => {
  const snapshot = (overrides: Partial<VRCombatActorSnapshot> = {}): VRCombatActorSnapshot => ({
    id: PLAYER,
    position: new THREE.Vector3(),
    isDroid: false,
    deathStarted: false,
    attackResultsCalculated: false,
    attackIsRanged: false,
    attackResult: 1,
    attackTargetPosition: new THREE.Vector3(1, 0, 0),
    attackTargetId: ENEMY,
    ...overrides,
  });

  it("reports melee rolls, which draw no bolt, once per landing", () => {
    const observer = new VRCombatAttackResultObserver();
    observer.observe([snapshot()]);
    expect(observer.observe([snapshot({ attackResultsCalculated: true, attackResult: 2 })])).toEqual([{
      attackerId: PLAYER, targetId: ENEMY, attackResult: 2, ranged: false, targetIsCreature: true,
    }]);
    expect(observer.observe([snapshot({ attackResultsCalculated: true, attackResult: 2 })])).toEqual([]);
  });

  it("does not replay a roll that had already landed when the actor was first seen", () => {
    const observer = new VRCombatAttackResultObserver();
    expect(observer.observe([snapshot({ attackResultsCalculated: true })])).toEqual([]);
  });

  it("skips INVALID and ATTACK_FAILED", () => {
    for (const attackResult of [0, 6]) {
      const observer = new VRCombatAttackResultObserver();
      observer.observe([snapshot()]);
      expect(observer.observe([snapshot({ attackResultsCalculated: true, attackResult })])).toEqual([]);
    }
  });
});

describe("delayed presentation for a deflection", () => {
  it("keeps a delayed bolt hidden until it launches", () => {
    const scene = new THREE.Group();
    const host = new VRBlasterBoltHost(scene);
    host.fire({ from: new THREE.Vector3(), to: new THREE.Vector3(5, 0, 0), attackResult: 9, delayMs: BOLT_TRAVEL_MS }, 1_000);
    const bolt = host.object.children[0];
    expect(bolt.visible).toBe(false);
    host.update(1_000 + BOLT_TRAVEL_MS / 2);
    expect(bolt.visible).toBe(false);
    host.update(1_000 + BOLT_TRAVEL_MS + 10);
    expect(bolt.visible).toBe(true);
    host.update(1_000 + BOLT_TRAVEL_MS * 2 + 10);
    expect(bolt.visible).toBe(false);
  });

  it("bursts sparks after the delay and retires them", () => {
    const scene = new THREE.Group();
    const host = new VRBladeSparkHost(scene, () => 0.7);
    host.spark(new THREE.Vector3(1, 2, 3), 1_000, 100);
    const burst = host.object.children[0];
    host.update(1_050);
    expect(burst.visible).toBe(false);
    host.update(1_150);
    expect(burst.visible).toBe(true);
    expect(burst.position.toArray()).toEqual([1, 2, 3]);
    host.update(1_400);
    expect(burst.visible).toBe(false);
  });
});
