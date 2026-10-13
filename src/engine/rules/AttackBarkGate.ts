/**
 * How often a creature voices one of its soundset's attack lines (SSF
 * ATTACK_1-3) when it starts an attack.
 *
 * The engine plays one on every attack, which is the default policy here and
 * stays the behaviour unless a host chooses otherwise. A host may pick a
 * sparser policy for presentation: a chance per attack, and a minimum time
 * between two lines from the same creature. The roll, the attack and its
 * animation are untouched either way; only whether the line plays changes.
 */
export interface AttackBarkPolicy {
  /** Chance, 0..1, that an attack voices a line once the interval allows it. */
  readonly chance: number;
  /** No line within this long of the same creature's last one. */
  readonly minIntervalMs: number;
}

/** Every attack voices a line, as the engine always has. */
export const EVERY_ATTACK_BARK_POLICY: AttackBarkPolicy = Object.freeze({ chance: 1, minIntervalMs: 0 });

/** About one attack in three, and never twice from one creature within 4 s. */
export const SPARSE_ATTACK_BARK_POLICY: AttackBarkPolicy = Object.freeze({ chance: 1 / 3, minIntervalMs: 4000 });

export class AttackBarkGate {
  private readonly lastBarkAt = new WeakMap<object, number>();

  /**
   * Whether `creature` voices an attack line now. Records the line when it
   * does. `random` is injectable for tests.
   */
  shouldBark(
    creature: object,
    nowMs: number,
    policy: AttackBarkPolicy = EVERY_ATTACK_BARK_POLICY,
    random: () => number = Math.random,
  ): boolean {
    if (!creature || typeof creature !== 'object') return false;
    const chance = Number.isFinite(policy?.chance) ? Math.min(1, Math.max(0, policy.chance)) : 1;
    const interval = Number.isFinite(policy?.minIntervalMs) ? Math.max(0, policy.minIntervalMs) : 0;
    const last = this.lastBarkAt.get(creature);
    if (last !== undefined && Number.isFinite(nowMs) && nowMs >= last && nowMs - last < interval) return false;
    if (chance < 1 && !(random() < chance)) return false;
    if (Number.isFinite(nowMs)) this.lastBarkAt.set(creature, nowMs);
    return true;
  }
}
