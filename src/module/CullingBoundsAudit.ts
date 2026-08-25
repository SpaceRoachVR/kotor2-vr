/**
 * Finds objects whose culling bounds cannot describe where they actually are.
 *
 * `ModuleObject.updateModelVisibility` hides anything `isOnScreen()` rejects,
 * and `isOnScreen()` tests `box.getBoundingSphere(sphere)` against the viewport
 * frustum. An **empty** `Box3` yields a sphere at the world origin with radius
 * zero (verified against three r149), so such an object is drawn only while the
 * world origin happens to sit inside the view frustum — and is invisible
 * everywhere else, while remaining fully interactable because interaction uses
 * `position`, not the box.
 *
 * That is the signature reported from the headset: "invisible assets sometimes
 * become visible when they're only in the extreme left side of my vision."
 * `001EBO` sits around x 20..60, y 20..80, so the origin lies off to one side
 * of the ship and swings through view as the player turns.
 *
 * A box that is merely *stale* — computed before the object was positioned —
 * produces the same class of fault with a centre parked somewhere unrelated, so
 * that is reported too.
 *
 * This is diagnosis, not repair: it names the offenders so a headset session
 * settles which objects are affected instead of another round of speculation.
 */
export interface Vec3Like {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BoundsSample {
  readonly name: string;
  readonly kind: string;
  readonly position: Vec3Like;
  /** Whether the object's Box3 is empty (min > max on any axis). */
  readonly empty: boolean;
  /** Centre of the bounding sphere derived from the box. */
  readonly center: Vec3Like;
  readonly radius: number;
}

export type BoundsAnomalyReason =
  | 'empty-box'
  | 'zero-radius'
  | 'detached-from-object';

export interface BoundsAnomaly extends BoundsSample {
  readonly reason: BoundsAnomalyReason;
  /** Distance from the object's own position to its bounding-sphere centre. */
  readonly offset: number;
}

/** How far a bounding centre may sit from its object before it is suspect. */
export const DETACHED_BOUNDS_DISTANCE = 5;

function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function isFiniteVec(v: Vec3Like | undefined): v is Vec3Like {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function findCullingBoundsAnomalies(
  samples: readonly BoundsSample[],
  detachedDistance: number = DETACHED_BOUNDS_DISTANCE,
): BoundsAnomaly[] {
  if (!Array.isArray(samples)) return [];
  const anomalies: BoundsAnomaly[] = [];

  for (const sample of samples) {
    if (!sample || !isFiniteVec(sample.position) || !isFiniteVec(sample.center)) continue;
    const offset = distance(sample.position, sample.center);

    // Order matters: an empty box is the root fault and already explains a
    // zero radius and a centre at the origin, so report it once, not three times.
    let reason: BoundsAnomalyReason | null = null;
    if (sample.empty) {
      reason = 'empty-box';
    } else if (!Number.isFinite(sample.radius) || sample.radius <= 0) {
      reason = 'zero-radius';
    } else if (offset > detachedDistance) {
      reason = 'detached-from-object';
    }

    if (reason) anomalies.push({ ...sample, reason, offset });
  }

  return anomalies;
}

/** One-line-per-offender summary, most detached first. */
export function describeCullingBoundsAnomalies(anomalies: readonly BoundsAnomaly[]): string {
  if (!anomalies.length) return 'culling bounds: no anomalies';
  const ordered = [...anomalies].sort((a, b) => b.offset - a.offset);
  const counts = ordered.reduce<Record<string, number>>((acc, a) => {
    acc[a.reason] = (acc[a.reason] ?? 0) + 1;
    return acc;
  }, {});
  const header = `culling bounds: ${ordered.length} anomalies (` +
    Object.entries(counts).map(([reason, n]) => `${reason}=${n}`).join(', ') + ')';
  const lines = ordered.map((a) =>
    `  ${a.kind} '${a.name}' ${a.reason}` +
    ` at (${a.position.x.toFixed(2)}, ${a.position.y.toFixed(2)}, ${a.position.z.toFixed(2)})` +
    ` bounds centre (${a.center.x.toFixed(2)}, ${a.center.y.toFixed(2)}, ${a.center.z.toFixed(2)})` +
    ` r=${a.radius.toFixed(2)} offset=${a.offset.toFixed(2)}m`);
  return [header, ...lines].join('\n');
}
