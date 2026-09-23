/**
 * The one GetFirstObjectInShape / GetNextObjectInShape iterator a script has,
 * as retail keeps it: GetFirst takes the whole matching list at once, GetNext
 * walks that list, and a nested GetFirst replaces it.
 *
 * The engine used to keep only a cursor, keyed by shape type, and rebuild the
 * list on every GetNext from that call's own radius and centre. k_ai_master
 * nests shape loops (a 40 m scan whose body runs 4 m scans around each
 * creature, all spheres), so after an inner scan the outer loop resumed at the
 * inner loop's small cursor, came back to an earlier creature, rescanned around
 * it and never ended. Three droids near an assassin droid in 103PER were enough
 * to run it ~140,000 times a second and freeze the game (rounds 6 and 12).
 *
 * With one stored list a nested scan cuts the outer loop short, as in retail,
 * but every loop ends.
 */
export class ShapeQueryIterator<T> {
  private objects: readonly T[] = [];
  private index = -1;

  /** Starts a new iteration over `objects`; returns the first, if any. */
  first(objects: readonly T[] | null | undefined): T | undefined {
    this.objects = Array.isArray(objects) ? objects.slice() : [];
    this.index = 0;
    return this.objects[0];
  }

  /** The next object of the current iteration, or undefined once it is spent. */
  next(): T | undefined {
    if (this.index < 0 || this.index >= this.objects.length) return undefined;
    this.index += 1;
    return this.objects[this.index];
  }

  reset(): void {
    this.objects = [];
    this.index = -1;
  }
}
