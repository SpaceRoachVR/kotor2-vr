/**
 * Recovering a blueprint reference that a saved module dropped.
 *
 * Saves written by earlier builds of this engine embed module GITs whose object
 * structs carry no `TemplateResRef` at all — measured across the existing saves:
 * `000003` holds 001EBO and 002ebo, `000002` holds 101per, 103per and 106per,
 * every one of them with zero occurrences. Loading such a module takes the saved
 * branch in `Module.GetModuleArchives`, which never consults the pristine
 * archive, so `ModulePlaceable.load()` finds no resref and skips merging the
 * `.utp` blueprint entirely: 68 fields where a cold load reaches 130.
 *
 * The pristine archive still has the answer. Matching a saved instance back to
 * its pristine counterpart is the whole problem, and the two sides do not
 * describe objects the same way:
 *
 *   - A **pristine** placeable struct is a stub: seven fields, resref and
 *     position, and no tag at all, because the tag lives in the `.utp`.
 *   - A **saved** struct is the opposite: the full object state including the
 *     tag, but no resref.
 *   - **List order** is not stable. Objects are created and destroyed during
 *     play, so the nth saved placeable is not the nth pristine one.
 *   - **Tag** is not unique even where both sides have one. Modules reuse tags
 *     across identical props.
 *
 * So the key the two reliably share is where the object stands, and for objects
 * that have not moved the coordinates are bit-identical between them. Position
 * carries most of the work; tag is used to disambiguate when both sides have it,
 * and as a last resort for an object that moved during play. Doors are what made
 * this obvious - they carry tags on both sides and were the only objects
 * matching before position-only lookup existed.
 *
 * Anything ambiguous is left alone. A wrong blueprint is worse than a missing
 * one, because it would silently give an object another object's behaviour.
 *
 * Positions are compared at a tolerance rather than exactly. A saved object has
 * usually moved slightly or been re-serialised through a float round trip, so
 * exact equality misses matches that are obviously the same object.
 *
 * Import-free so it can be tested directly; the GFF plumbing stays in Module.ts.
 *
 * @file TemplateResRefRecovery.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

/** One instance as read from a GIT list. */
export interface GitInstance {
  tag: string;
  x: number;
  y: number;
  z: number;
}

/** A pristine instance, which still knows its blueprint. */
export interface PristineInstance extends GitInstance {
  templateResRef: string;
}

export interface RecoveryIndex {
  /** tag + quantised position -> resref, only where that key is unambiguous. */
  byTagAndPosition: Map<string, string>;
  /** quantised position -> resref, ignoring tags entirely. */
  byPosition: Map<string, string>;
  /** tag -> resref, only for tags held by exactly one pristine instance. */
  byUniqueTag: Map<string, string>;
}

/** Position tolerance in game units. Generous enough for a float round trip and
 * for props that settle, tight enough not to collide with a neighbour. */
const POSITION_TOLERANCE = 0.25;

const quantise = (value: number): number =>
  Math.round((Number.isFinite(value) ? value : 0) / POSITION_TOLERANCE);

const cell = (instance: GitInstance): string =>
  `${quantise(instance.x)},${quantise(instance.y)},${quantise(instance.z)}`;

const positionKey = (instance: GitInstance): string =>
  `${String(instance.tag || '').toLowerCase()}@${cell(instance)}`;

const bareKey = (instance: GitInstance): string => cell(instance);

/**
 * Build the lookup from the pristine GIT's instances.
 *
 * Keys that more than one instance would claim, with differing resrefs, are
 * dropped rather than resolved arbitrarily.
 */
export function buildRecoveryIndex(instances: PristineInstance[]): RecoveryIndex {
  const positionCandidates = new Map<string, Set<string>>();
  const bareCandidates = new Map<string, Set<string>>();
  const tagCandidates = new Map<string, Set<string>>();

  for (const instance of instances || []) {
    const resref = String(instance?.templateResRef || '');
    if (!resref) { continue; }
    const tag = String(instance?.tag || '').toLowerCase();

    const pKey = positionKey(instance);
    if (!positionCandidates.has(pKey)) { positionCandidates.set(pKey, new Set()); }
    positionCandidates.get(pKey)!.add(resref);

    const bKey = bareKey(instance);
    if (!bareCandidates.has(bKey)) { bareCandidates.set(bKey, new Set()); }
    bareCandidates.get(bKey)!.add(resref);

    if (tag) {
      if (!tagCandidates.has(tag)) { tagCandidates.set(tag, new Set()); }
      tagCandidates.get(tag)!.add(resref);
    }
  }

  const collapse = (candidates: Map<string, Set<string>>): Map<string, string> => {
    const out = new Map<string, string>();
    for (const [key, resrefs] of candidates) {
      // Two instances agreeing on the same resref is not ambiguity; two
      // disagreeing is, and there is no safe way to pick.
      if (resrefs.size === 1) { out.set(key, resrefs.values().next().value as string); }
    }
    return out;
  };

  return {
    byTagAndPosition: collapse(positionCandidates),
    byPosition: collapse(bareCandidates),
    byUniqueTag: collapse(tagCandidates),
  };
}

/**
 * @returns the recovered resref, or undefined when no unambiguous match exists
 */
export function recoverTemplateResRef(
  index: RecoveryIndex,
  instance: GitInstance,
): string | undefined {
  if (!index || !instance) { return undefined; }

  // Tag and position together are the strong signal; try the exact cell first,
  // then its immediate neighbours, so an object sitting just across a quantisation
  // boundary from where it started is still matched.
  const tag = String(instance.tag || '').toLowerCase();
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const key = `${tag}@${quantise(instance.x) + dx},${quantise(instance.y) + dy},${quantise(instance.z) + dz}`;
        const hit = index.byTagAndPosition.get(key);
        if (hit) { return hit; }
      }
    }
  }

  // Position alone, for the common case where the two sides share no tag: a
  // pristine placeable stub has none, and the saved struct's tag came from the
  // blueprint. An object that has not moved sits in the same cell.
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const key = `${quantise(instance.x) + dx},${quantise(instance.y) + dy},${quantise(instance.z) + dz}`;
        const hit = index.byPosition.get(key);
        if (hit) { return hit; }
      }
    }
  }

  // An object that moved during play keeps its tag. Only trust it when that tag
  // belongs to exactly one pristine instance.
  if (tag) { return index.byUniqueTag.get(tag); }
  return undefined;
}
