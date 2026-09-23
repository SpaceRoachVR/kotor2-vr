/**
 * Pure rules behind TSL-only NWScript routines, kept free of engine imports so
 * they can be tested without booting GameState.
 *
 * Each rule was read off the retail scripts that call the routine (decompiled
 * with DeNCS from the shipped NCS) rather than off the routine comment alone.
 */

/** Odyssey creatures carry at most two classes. */
export const MAX_CREATURE_CLASSES = 2;

export interface VectorLike { x: number; y: number; z: number; }

/**
 * AngleToVector (144). Angles are anticlockwise degrees from due east, the
 * same convention SetFacing documents (0 = East, 90 = North), so the result is
 * the unit vector on the ground plane.
 */
export function angleToVector(degrees: number): VectorLike {
  const radians = (Number.isFinite(degrees) ? degrees : 0) * Math.PI / 180;
  return { x: Math.cos(radians), y: Math.sin(radians), z: 0 };
}

/**
 * FaceObjectAwayFromObject (553). The point to face is the facer's position
 * mirrored through itself away from the other object. Returns null when the
 * two stand on the same spot, where "away" has no direction.
 */
export function pointFacingAway(facer: VectorLike, awayFrom: VectorLike): VectorLike | null {
  const dx = facer.x - awayFrom.x;
  const dy = facer.y - awayFrom.y;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return null;
  return { x: facer.x + dx, y: facer.y + dy, z: facer.z };
}

export interface ClassLike { id: number; }

/**
 * AddMultiClass (389). a_makejedi gives Atton, Bao-Dur, the Handmaiden, Mira
 * and the Disciple a Jedi class. The class is added with no levels: the engine
 * levels the last class (`getMainClass`), so the next level-up goes into it.
 * Refused when the creature already has the class or already has two.
 */
export function canAddMultiClass(classes: readonly ClassLike[], classId: number, classCount: number): boolean {
  if (!Number.isInteger(classId) || classId < 0 || classId >= classCount) return false;
  if (classes.length >= MAX_CREATURE_CLASSES) return false;
  return !classes.some((cls) => cls.id === classId);
}

export interface EffectLike { type: number; getInt(index: number): number; }

/**
 * RemoveEffectByExactMatch (868): same effect type, and the same first two
 * integers. a_swapimplant builds a fresh EffectRegenerate / EffectAbilityIncrease
 * and removes the applied copy that matches it, so identity cannot be used.
 */
export function effectsMatchExactly(applied: EffectLike, probe: EffectLike): boolean {
  if (!applied || !probe) return false;
  return applied.type === probe.type &&
    (applied.getInt(0) || 0) === (probe.getInt(0) || 0) &&
    (applied.getInt(1) || 0) === (probe.getInt(1) || 0);
}
