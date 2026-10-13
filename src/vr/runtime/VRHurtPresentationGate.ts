/**
 * Hurt on the blow, not on the roll (combat redesign, Part D1).
 *
 * The engine applies an attack's damage when the round rolls it, which can be
 * most of a second before the attacker's blade lands (a Sith `c2a4`: HP drop
 * at 0.09 s, its animation's Hit event at 0.96 s), and before the attack
 * animation has even started. Presenting the hurt there tells the player they
 * were hit before they could see the swing.
 *
 * This gate leaves the engine's numbers alone and only holds what the player
 * is shown: a hit on the player is held until the attacker's Hit animation
 * event (melee) or the bolt's arrival (ranged), with a timeout for attacks
 * whose animation never sends one. While a hit is held, the hit points the
 * player is shown stay at their value before it.
 *
 * Pure: the caller feeds it the rolls, the Hit events and the live hit points
 * every frame, and reads back the hit points to show and the hits that land.
 */

export interface VRHurtHitRecord {
  readonly attackerId: string | number;
  readonly critical: boolean;
  /** A ranged attack: it lands when the bolt arrives. */
  readonly ranged: boolean;
  readonly nowMs: number;
}

export interface VRHurtRelease {
  readonly attackerId: string | number;
  readonly critical: boolean;
  /** Hit points this hit took (0 for a hit a shield or immunity absorbed). */
  readonly amount: number;
  /** What let it land: the attacker's Hit event, the bolt arriving, the timeout, or its damage arriving late. */
  readonly reason: 'blow' | 'bolt' | 'timeout' | 'late';
}

export interface VRHurtGateUpdate {
  /** The hit points to show: live, plus whatever held hits took. */
  readonly displayedHitPoints: number | null;
  /** Hits that landed this frame, oldest first. */
  readonly released: readonly VRHurtRelease[];
}

export interface VRHurtPresentationGateOptions {
  /** How long a presentation bolt flies (VRBlasterBoltHost.BOLT_TRAVEL_MS). */
  readonly boltTravelMs: number;
  /** A melee hit whose animation sends no Hit event lands after this long. */
  readonly meleeTimeoutMs?: number;
  /** How long after the roll a drop in hit points is still that roll's damage. */
  readonly assignWindowMs?: number;
}

/** Longer than any retail attack animation's Hit (a Sith c2a4 sends it at ~0.87 s). */
export const VR_HURT_MELEE_TIMEOUT_MS = 1_300;
/** Damage lands the same frame as the roll; a little slack for a later frame. */
export const VR_HURT_ASSIGN_WINDOW_MS = 200;
/** Never hold more than this many hits; the oldest lands first. */
const MAX_PENDING = 8;

interface PendingHit {
  readonly attackerId: string | number;
  readonly critical: boolean;
  readonly ranged: boolean;
  readonly atMs: number;
  amount: number;
  assigned: boolean;
  landed: boolean;
  late: boolean;
}

export class VRHurtPresentationGate {
  private readonly boltTravelMs: number;
  private readonly meleeTimeoutMs: number;
  private readonly assignWindowMs: number;
  private pending: PendingHit[] = [];
  private lastLiveHitPoints: number | null = null;

  constructor(options: VRHurtPresentationGateOptions) {
    this.boltTravelMs = Math.max(0, options.boltTravelMs);
    this.meleeTimeoutMs = Math.max(0, options.meleeTimeoutMs ?? VR_HURT_MELEE_TIMEOUT_MS);
    this.assignWindowMs = Math.max(0, options.assignWindowMs ?? VR_HURT_ASSIGN_WINDOW_MS);
  }

  /** An attack roll hit the player. Call before `update` on the same frame. */
  recordHit(hit: VRHurtHitRecord): void {
    this.pending.push({
      attackerId: hit.attackerId,
      critical: hit.critical,
      ranged: hit.ranged,
      atMs: hit.nowMs,
      amount: 0,
      assigned: false,
      landed: false,
      late: false,
    });
    if (this.pending.length > MAX_PENDING) {
      // Oldest first: it lands at the next update.
      this.pending[0].landed = true;
    }
  }

  /** The attacker's animation sent its Hit event: its oldest held melee hit lands. */
  noteBlowLanded(attackerId: string | number): void {
    const hit = this.pending.find((p) => !p.landed && !p.ranged && String(p.attackerId) === String(attackerId));
    if (hit) hit.landed = true;
  }

  /** Feed the live hit points every frame. */
  update(liveHitPoints: number | null, nowMs: number): VRHurtGateUpdate {
    if (liveHitPoints === null || !Number.isFinite(liveHitPoints)) {
      this.reset();
      return { displayedHitPoints: null, released: [] };
    }
    const previous = this.lastLiveHitPoints;
    this.lastLiveHitPoints = liveHitPoints;
    if (previous !== null) {
      const drop = previous - liveHitPoints;
      if (drop > 0) {
        // The roll applies its damage in the same frame: the drop is that
        // roll's, held for the blow. A drop that comes later than that (an
        // engine that applies damage at the blow itself) lands that hit now.
        // A drop with no roll behind it (a grenade, poison) is shown now.
        const fresh = this.pending.find((p) => !p.assigned && nowMs - p.atMs <= this.assignWindowMs);
        const owner = fresh ?? this.pending.find((p) => !p.assigned);
        if (owner) {
          owner.amount = drop;
          owner.assigned = true;
          if (!fresh) owner.late = true;
        }
      }
    }

    const released: VRHurtRelease[] = [];
    const kept: PendingHit[] = [];
    for (const hit of this.pending) {
      const reason = this.releaseReason(hit, nowMs);
      if (reason) {
        released.push({ attackerId: hit.attackerId, critical: hit.critical, amount: hit.amount, reason });
      } else {
        kept.push(hit);
      }
    }
    this.pending = kept;
    const held = kept.reduce((sum, hit) => sum + hit.amount, 0);
    return { displayedHitPoints: liveHitPoints + held, released };
  }

  /** True while a hit on the player is waiting for its blow to land. */
  get holding(): boolean {
    return this.pending.length > 0;
  }

  reset(): void {
    this.pending = [];
    this.lastLiveHitPoints = null;
  }

  private releaseReason(hit: PendingHit, nowMs: number): VRHurtRelease['reason'] | null {
    if (hit.late) return 'late';
    if (hit.landed) return hit.ranged ? 'bolt' : 'blow';
    if (hit.ranged) return nowMs - hit.atMs >= this.boltTravelMs ? 'bolt' : null;
    return nowMs - hit.atMs >= this.meleeTimeoutMs ? 'timeout' : null;
  }
}
