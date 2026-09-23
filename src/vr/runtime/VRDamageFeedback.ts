import * as THREE from 'three';

/**
 * Knowing you were hit, and from where (ROADMAP 3.14).
 *
 * With the avatar hidden in first person, the damage animation the engine
 * plays on the player is invisible, and in a fight with enemies on both sides
 * nothing said which one landed. The trigger is the controlled creature's own
 * hit points going down — that covers blaster fire, melee, grenades, Force
 * powers and traps alike. The side comes from the most recent attack roll
 * against the player, when there was one; damage with no recent attacker
 * (a mine, a poison tick) is shown on both edges.
 *
 * World is KOTOR's Z-up: the ground plane is XY.
 */

export type VRDamageSide = 'left' | 'right' | 'front' | 'behind' | 'unknown';

export interface VRDamageEvent {
  readonly side: VRDamageSide;
  readonly critical: boolean;
  readonly amount: number;
}

export interface VRDamageAttackRecord {
  readonly attackerPosition: THREE.Vector3;
  readonly critical: boolean;
  readonly timestampMs: number;
}

export interface VRDamageObservation {
  readonly actorId: number | null;
  readonly hitPoints: number | null;
  readonly playerPosition: THREE.Vector3 | null;
  /** The head's forward direction in world space; only its XY part is used. */
  readonly headForward: THREE.Vector3 | null;
  readonly nowMs: number;
}

/** How long an attack roll still explains a drop in hit points. */
const ATTACK_ATTRIBUTION_WINDOW_MS = 2_000;
/** Within this angle of straight ahead or straight behind, the hit reads as front or behind. */
const FRONT_BACK_HALF_ANGLE_COS = Math.cos(THREE.MathUtils.degToRad(40));

export function resolveVRDamageSide(
  attackerPosition: THREE.Vector3,
  playerPosition: THREE.Vector3,
  headForward: THREE.Vector3,
): VRDamageSide {
  const toAttacker = new THREE.Vector2(attackerPosition.x - playerPosition.x, attackerPosition.y - playerPosition.y);
  const forward = new THREE.Vector2(headForward.x, headForward.y);
  if (toAttacker.lengthSq() < 1e-6 || forward.lengthSq() < 1e-6) return 'unknown';
  toAttacker.normalize();
  forward.normalize();
  const dot = forward.dot(toAttacker);
  if (dot >= FRONT_BACK_HALF_ANGLE_COS) return 'front';
  if (dot <= -FRONT_BACK_HALF_ANGLE_COS) return 'behind';
  // Z-up, so a positive cross product means the attacker is counter-clockwise
  // from forward: on the player's left.
  return forward.x * toAttacker.y - forward.y * toAttacker.x > 0 ? 'left' : 'right';
}

export class VRDamageFeedbackTracker {
  private actorId: number | null = null;
  private lastHitPoints: number | null = null;
  private lastAttack: VRDamageAttackRecord | null = null;

  /** An attack roll that hit the player; used to attribute the next hit-point drop. */
  recordAttack(record: VRDamageAttackRecord): void {
    this.lastAttack = { ...record, attackerPosition: record.attackerPosition.clone() };
  }

  /** Returns a damage event on the frame the player's hit points go down. */
  observe(observation: Readonly<VRDamageObservation>): VRDamageEvent | null {
    const { actorId, hitPoints } = observation;
    if (actorId === null || hitPoints === null || !Number.isFinite(hitPoints)) {
      this.reset();
      return null;
    }
    // A party swap or a load gives a new baseline, never a "hit".
    if (actorId !== this.actorId || this.lastHitPoints === null) {
      this.actorId = actorId;
      this.lastHitPoints = hitPoints;
      this.lastAttack = null;
      return null;
    }
    const lost = this.lastHitPoints - hitPoints;
    this.lastHitPoints = hitPoints;
    if (!(lost > 0)) return null;

    const attack = this.lastAttack &&
      observation.nowMs - this.lastAttack.timestampMs <= ATTACK_ATTRIBUTION_WINDOW_MS
      ? this.lastAttack
      : null;
    this.lastAttack = null;
    const side = attack && observation.playerPosition && observation.headForward
      ? resolveVRDamageSide(attack.attackerPosition, observation.playerPosition, observation.headForward)
      : 'unknown';
    return Object.freeze({ side, critical: attack?.critical === true, amount: lost });
  }

  reset(): void {
    this.actorId = null;
    this.lastHitPoints = null;
    this.lastAttack = null;
  }
}
