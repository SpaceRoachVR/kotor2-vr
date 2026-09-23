import * as THREE from 'three';

/**
 * Turns per-frame combat state into one-shot visual events: blaster bolts and
 * droid explosions.
 *
 * WHY AN OBSERVER RATHER THAN AN ENGINE HOOK
 *
 * Nothing in this engine ever spawns a projectile. `EventBroadcastSafeProjectile`
 * exists but its only construction site is `GameEventFactory.EventFromStruct`,
 * i.e. rehydrating a saved event — so no ranged attack has ever drawn a bolt.
 * Rather than reach into `CombatRound` (whose animation path is correct and was
 * misdiagnosed repeatedly), this watches the state the engine already publishes
 * and derives the visuals from transitions. Same reasoning that put
 * `vrAttackStance.observeRound` outside `CombatRound.endCombatRound`: detecting
 * the boundary by observation keeps the engine untouched.
 *
 * WHY THE PLAYER NEEDS THIS AT ALL
 *
 * In first person the player's own avatar is hidden (`hidePlayerBodyForFirstPerson`),
 * so the attack animation the engine plays for them is on a body they cannot
 * see. Reported from a headset session as "no blaster animation for T3" — the
 * animation was in fact playing. A bolt is the part that was genuinely missing.
 */

/** Attack results that mean a shot actually left the weapon. */
const FIRED_ATTACK_RESULTS: ReadonlySet<number> = new Set([
  1, // HIT_SUCCESSFUL
  2, // CRITICAL_HIT
  3, // AUTOMATIC_HIT
  4, // MISS — a miss still fires; the bolt goes wide
  5, // ATTACK_RESISTED
  8, // PARRIED
  9, // DEFLECTED
]);
// Deliberately excluded: INVALID (0) and ATTACK_FAILED (6) — no shot occurred.

export interface VRCombatActorSnapshot {
  readonly id: number;
  /** Creature base position (feet), engine Z-up world space. */
  readonly position: THREE.Vector3;
  /** Whether an explosion is appropriate when this actor dies. */
  readonly isDroid: boolean;
  /** `ModuleCreature.deathStarted` — the engine's own one-shot death latch. */
  readonly deathStarted: boolean;
  /**
   * `ModuleCreature.isDead()` — true the frame HP reaches zero, which can be
   * before `deathStarted` latches.
   */
  readonly isDead?: boolean;
  /** `CombatRoundAction.resultsCalculated` — flips true the frame a roll lands. */
  readonly attackResultsCalculated: boolean;
  /** True when the composed attack animation is a ranged one (`attackKey === 'b'`). */
  readonly attackIsRanged: boolean;
  /** `CombatRoundAction.attackResult`. */
  readonly attackResult: number;
  /** Where the shot is aimed. Null when the action has no positioned target. */
  readonly attackTargetPosition: THREE.Vector3 | null;
  /**
   * False when the round is aimed at a door or placeable — a Bash. Absent is
   * treated as a creature, which keeps the player's own bolt suppressed.
   */
  readonly attackTargetIsCreature?: boolean;
  /**
   * Where on a non-creature target the bolt lands (its bounds centre). A
   * footlocker is knee-high, so the creature chest height would fly over it.
   */
  readonly attackTargetAimPoint?: THREE.Vector3 | null;
  /** The attack's target object id, when it has one (ROADMAP 3.13). */
  readonly attackTargetId?: number | null;
  /** Current hit points, so the player's own damage can be felt (ROADMAP 3.14). */
  readonly hitPoints?: number | null;
}

export interface VRBlasterBoltEvent {
  readonly kind: 'bolt';
  readonly actorId: number;
  readonly from: THREE.Vector3;
  readonly to: THREE.Vector3;
  readonly attackResult: number;
  /** False for a Bash on a door or placeable; see VRSpike.updateCombatVisuals. */
  readonly targetIsCreature: boolean;
  /** The shot's target id, so a bolt deflected by the player can meet their blade. */
  readonly targetId: number | null;
}

export interface VRDroidExplosionEvent {
  readonly kind: 'explosion';
  readonly actorId: number;
  readonly at: THREE.Vector3;
}

export type VRCombatVisualEvent = VRBlasterBoltEvent | VRDroidExplosionEvent;

interface ActorMemory {
  attackResultsCalculated: boolean;
  /** Dead by either signal: `deathStarted` or `isDead`. */
  deathStarted: boolean;
}

/**
 * Muzzle height above a creature's origin.
 *
 * Creature positions sit on the floor, so a bolt drawn from the origin comes
 * out of the actor's feet. This is only used for actors whose weapon position
 * is not otherwise known — the local player's bolt starts at the controller's
 * ray anchor instead, which is where their weapon actually is.
 */
export const VR_MUZZLE_HEIGHT_METRES = 1.2;

function isDying(snapshot: VRCombatActorSnapshot): boolean {
  return !!snapshot.deathStarted || !!snapshot.isDead;
}

export class VRCombatVisualEventObserver {
  private readonly memory = new Map<number, ActorMemory>();

  /**
   * Diffs this frame's snapshots against the last and returns what just
   * happened.
   *
   * An actor seen for the first time is recorded WITHOUT emitting: loading into
   * a module where a fight is already in progress, or a creature spawning
   * mid-round, would otherwise spray bolts for attacks that already resolved.
   * Only a genuine false→true transition counts.
   */
  observe(snapshots: readonly VRCombatActorSnapshot[]): VRCombatVisualEvent[] {
    const events: VRCombatVisualEvent[] = [];
    const seen = new Set<number>();

    for (const snapshot of snapshots) {
      if (!snapshot || !Number.isInteger(snapshot.id) || !snapshot.position) continue;
      if (!isFiniteVector(snapshot.position)) continue;
      seen.add(snapshot.id);

      const previous = this.memory.get(snapshot.id);
      if (!previous) {
        this.memory.set(snapshot.id, {
          attackResultsCalculated: !!snapshot.attackResultsCalculated,
          deathStarted: isDying(snapshot),
        });
        continue;
      }

      if (!previous.attackResultsCalculated && snapshot.attackResultsCalculated) {
        const target = snapshot.attackTargetPosition;
        if (snapshot.attackIsRanged &&
          target && isFiniteVector(target) &&
          FIRED_ATTACK_RESULTS.has(snapshot.attackResult)) {
          const aimPoint = snapshot.attackTargetAimPoint;
          events.push({
            kind: 'bolt',
            actorId: snapshot.id,
            from: snapshot.position.clone().setZ(snapshot.position.z + VR_MUZZLE_HEIGHT_METRES),
            to: aimPoint && isFiniteVector(aimPoint)
              ? aimPoint.clone()
              : target.clone().setZ(target.z + VR_MUZZLE_HEIGHT_METRES),
            attackResult: snapshot.attackResult,
            targetIsCreature: snapshot.attackTargetIsCreature !== false,
            targetId: resolveTargetId(snapshot),
          });
        }
      }

      // Either death signal counts. The Ebon Hawk Sensor Droids are killed and
      // faded out by script, and waiting for `deathStarted` alone meant the
      // droid could leave the area's creature list before the latch was ever
      // observed — reported twice as "Sensor Droids still missing destroy
      // animation" while bolts, driven by the same observer, worked.
      const dying = isDying(snapshot);
      if (!previous.deathStarted && dying && snapshot.isDroid) {
        events.push({
          kind: 'explosion',
          actorId: snapshot.id,
          at: snapshot.position.clone().setZ(snapshot.position.z + VR_MUZZLE_HEIGHT_METRES * 0.5),
        });
      }

      previous.attackResultsCalculated = !!snapshot.attackResultsCalculated;
      previous.deathStarted = dying;
    }

    // Forget actors that are gone, so a module with different creatures reusing
    // ids cannot inherit another area's latch state.
    for (const id of Array.from(this.memory.keys())) {
      if (!seen.has(id)) this.memory.delete(id);
    }

    return events;
  }

  /** Drops all remembered state — used on module transition and session end. */
  reset(): void {
    this.memory.clear();
  }
}

/**
 * Every attack roll that lands, melee or ranged — the moment
 * `CombatRoundAction.resultsCalculated` flips true (ROADMAP 3.13).
 *
 * Separate from `VRCombatVisualEventObserver` because that one only reports
 * what draws a bolt or an explosion; a melee hit draws neither but is exactly
 * what the player needs to feel. Same first-sighting rule: an actor seen for
 * the first time mid-round reports nothing, so loading into a fight does not
 * replay rolls that already landed.
 */
export interface VRCombatAttackResultEvent {
  readonly attackerId: number;
  readonly targetId: number | null;
  readonly attackResult: number;
  readonly ranged: boolean;
  readonly targetIsCreature: boolean;
}

/** `INVALID` and `ATTACK_FAILED` — no attack happened, so there is nothing to feel. */
const NON_ATTACK_RESULTS: ReadonlySet<number> = new Set([0, 6]);

export class VRCombatAttackResultObserver {
  private readonly calculated = new Map<number, boolean>();

  observe(snapshots: readonly VRCombatActorSnapshot[]): VRCombatAttackResultEvent[] {
    const events: VRCombatAttackResultEvent[] = [];
    const seen = new Set<number>();
    for (const snapshot of snapshots) {
      if (!snapshot || !Number.isInteger(snapshot.id)) continue;
      seen.add(snapshot.id);
      const now = !!snapshot.attackResultsCalculated;
      const previous = this.calculated.get(snapshot.id);
      this.calculated.set(snapshot.id, now);
      if (previous !== false || !now) continue;
      if (!Number.isInteger(snapshot.attackResult) || NON_ATTACK_RESULTS.has(snapshot.attackResult)) continue;
      events.push({
        attackerId: snapshot.id,
        targetId: resolveTargetId(snapshot),
        attackResult: snapshot.attackResult,
        ranged: !!snapshot.attackIsRanged,
        targetIsCreature: snapshot.attackTargetIsCreature !== false,
      });
    }
    for (const id of Array.from(this.calculated.keys())) {
      if (!seen.has(id)) this.calculated.delete(id);
    }
    return events;
  }

  reset(): void {
    this.calculated.clear();
  }
}

function resolveTargetId(snapshot: VRCombatActorSnapshot): number | null {
  return Number.isInteger(snapshot.attackTargetId) ? snapshot.attackTargetId as number : null;
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}
