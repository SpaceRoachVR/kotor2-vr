import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';

/**
 * Which hostile creature the weapon hand is pointing at, for combat only.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE INTERACTION RAY
 *
 * Combat target nomination used to read `VRSpike.interactionAimedTargetId`,
 * which is resolved against the interaction target set. That set deliberately
 * drops anything further away than its per-type use distance —
 * `getVRInteractionRange` falls back to 3 m for a creature, because selecting a
 * distant object in the original engine queues a walk-to-target action that
 * drags the player across the level (see the note in
 * `ModuleObjectInteractionTarget`). That rule is right for doors and
 * containers and must stay.
 *
 * It is wrong for shooting. `resolveVRCombatRange` allows 15 m with a ranged
 * weapon, so every hostile between 3 m and 15 m was targetable by the rules of
 * combat and simultaneously invisible to aim resolution. Reported from a
 * headset session as the action wheel opening with no Attacks wedge and no
 * target highlight while four hostile droids stood in the room — the console
 * recorded `aimedTargetId=null, candidate=none, selectableHostiles=4`.
 *
 * Keeping this resolver separate means widening combat reach cannot widen
 * "Use" reach, so the walk-to-target branch stays unreachable.
 *
 * The world is Z-up here: the ground plane is XY, matching the walkmesh and
 * the rest of the locomotion and interaction code.
 */
export interface VRCombatAimCandidate {
  readonly id: number;
  /** The creature's base position in world space, i.e. at its feet. */
  readonly position: THREE.Vector3;
  /**
   * Optional per-creature bounding radius. Omitted candidates use
   * `DEFAULT_TARGET_RADIUS_METRES`, which is the same default the interaction
   * registry applies to an object with no usable bounds.
   */
  readonly radiusMetres?: number;
}

export interface VRCombatAimRequest {
  /** The weapon hand's target ray. Its -Z axis is the aim direction. */
  readonly rayPose: XRWorldPose;
  /** The attacker, whose ground distance to a candidate defines combat range. */
  readonly actorPosition: THREE.Vector3;
  readonly candidates: readonly VRCombatAimCandidate[];
  /** `resolveVRCombatRange` — 15 m with a ranged weapon, 2 m otherwise. */
  readonly maxRangeMetres: number;
  /**
   * Extra radius added to every candidate so a distant creature stays
   * practically hittable. A sensor droid subtends well under a degree across a
   * room, and holding a controller steady enough to intersect its true bounding
   * sphere at 12 m is not a skill the game ever asked for — KOTOR's own
   * targeting is a click on a screen-space reticle, not a physical aim. Opt-in
   * so tests can measure the geometry without it.
   */
  readonly aimAssistRadiusMetres?: number;
}

const DEFAULT_TARGET_RADIUS_METRES = 0.5;

/**
 * Creature positions sit on the floor, but a player aims at a body. Without
 * lifting the test sphere the ray only resolves when it is pointed at the
 * creature's feet, which reads as the target being unselectable while it is
 * plainly in the crosshair.
 */
const AIM_TARGET_HEIGHT_METRES = 0.9;

/**
 * Nearest hostile along the aim ray that is also inside combat range, or null.
 *
 * Range is measured across the ground rather than along the ray, matching
 * `isWithinVRCombatRange` exactly — the two must agree, or the wheel would
 * offer an attack that `getCombatContext` then refuses to nominate.
 */
export function resolveVRCombatAimedTargetId(request: VRCombatAimRequest): number | null {
  const { rayPose, actorPosition, candidates, maxRangeMetres } = request;
  if (!Number.isFinite(maxRangeMetres) || maxRangeMetres <= 0) {
    throw new RangeError('maxRangeMetres must be finite and positive');
  }
  if (!rayPose || !actorPosition || !Array.isArray(candidates)) return null;

  const assist = request.aimAssistRadiusMetres ?? 0;
  if (!Number.isFinite(assist) || assist < 0) {
    throw new RangeError('aimAssistRadiusMetres must be a non-negative finite number');
  }

  const origin = new THREE.Vector3().copy(rayPose.position);
  if (!isFiniteVector(origin)) return null;
  const direction = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(rayPose.orientation)
    .normalize();
  if (!isFiniteVector(direction) || direction.lengthSq() <= Number.EPSILON) return null;

  let bestId: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (!candidate || !Number.isInteger(candidate.id) || !candidate.position) continue;
    if (!isFiniteVector(candidate.position)) continue;

    // Ground distance, so a creature on a gantry overhead is judged by how far
    // the attacker would have to walk, not by the hypotenuse.
    const groundDistance = Math.hypot(
      actorPosition.x - candidate.position.x,
      actorPosition.y - candidate.position.y,
    );
    if (!Number.isFinite(groundDistance) || groundDistance > maxRangeMetres) continue;

    const radius = (Number.isFinite(candidate.radiusMetres) && (candidate.radiusMetres as number) > 0
      ? (candidate.radiusMetres as number)
      : DEFAULT_TARGET_RADIUS_METRES) + assist;

    const centre = new THREE.Vector3(
      candidate.position.x,
      candidate.position.y,
      candidate.position.z + AIM_TARGET_HEIGHT_METRES,
    );

    const distance = intersectRaySphere(origin, direction, centre, radius);
    if (distance === null) continue;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = candidate.id;
    }
  }

  return bestId;
}

/**
 * Mirrors `InteractionTargetRegistry.intersectRaySphere` deliberately: the two
 * resolvers must agree about what "pointing at it" means, or an object would
 * highlight under one system and not the other. Returns 0 when the origin is
 * already inside the sphere.
 */
function intersectRaySphere(
  origin: THREE.Vector3,
  normalizedDirection: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): number | null {
  const originToCenter = origin.clone().sub(center);
  const c = originToCenter.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  const b = originToCenter.dot(normalizedDirection);
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const distance = -b - Math.sqrt(discriminant);
  return distance >= 0 ? distance : null;
}

function isFiniteVector(vector: THREE.Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}
