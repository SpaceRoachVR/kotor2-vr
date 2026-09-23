import type { VRCombatTempoGateReason } from './VRCombatTempoGate';
import type { VRCombatRequiredInput } from './VRCombatIntentQueue';

/**
 * One physical swing or trigger pull, held until the combat round opens.
 *
 * WHY (ROADMAP 3.12)
 *
 * The tempo gate refuses input while the engine owns the round, and a refused
 * swing used to be discarded. In a fight the round is running most of the
 * time, so a player swinging naturally lost most of their swings — reported
 * from headset round 5 as "rounds failed several times and did not register a
 * swing". Flatscreen lets you queue the next action while the current round
 * plays; this is the embodied equivalent.
 *
 * It holds at most one entry, and a newer swing replaces an older one: several
 * swings during one round still mean one attack next round. It never decides
 * *what* fires — the dispatcher does that from the intent queue at release —
 * and it never releases into a different fight than the one it was aimed at.
 */
export interface VRCombatBufferedSwing {
  readonly actorId: string;
  readonly targetId: string;
  readonly input: VRCombatRequiredInput;
  readonly weaponSignature: string;
}

export interface VRCombatSwingBufferReleaseContext {
  readonly actorId: string;
  readonly weaponSignature: string;
  readonly inCombat: boolean;
  /** Whether the buffered target is still alive and in weapon reach. */
  isTargetLive(targetId: string): boolean;
}

export type VRCombatSwingBufferRelease =
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'released'; swing: VRCombatBufferedSwing }>
  | Readonly<{ state: 'dropped'; reason: VRCombatSwingDropReason }>;

export type VRCombatSwingDropReason =
  | 'actor-changed'
  | 'weapon-changed'
  | 'combat-ended'
  | 'target-invalid';

/**
 * Gate reasons that mean "the round is busy, try again when it opens". Every
 * other refusal — no target, a dead actor, a paused game — drops the swing,
 * because nothing about waiting would make it valid, and a swing held through
 * a pause would fire on resume with nobody asking for it.
 */
const BUFFERABLE_REASONS: ReadonlySet<VRCombatTempoGateReason> = new Set<VRCombatTempoGateReason>([
  'round-active',
  'scheduled-action-pending',
  'player-action-committed',
]);

export function isVRCombatSwingBufferable(reason: VRCombatTempoGateReason): boolean {
  return BUFFERABLE_REASONS.has(reason);
}

export class VRCombatSwingBuffer {
  private pending: VRCombatBufferedSwing | null = null;

  /** Holds `swing`, replacing any earlier one. Returns false for a refusal that must not wait. */
  offer(swing: VRCombatBufferedSwing, reason: VRCombatTempoGateReason): boolean {
    if (!isVRCombatSwingBufferable(reason)) return false;
    validateSwing(swing);
    this.pending = Object.freeze({ ...swing });
    return true;
  }

  get hasPending(): boolean {
    return this.pending !== null;
  }

  peek(): VRCombatBufferedSwing | null {
    return this.pending;
  }

  /**
   * Called when the round has opened. Returns the swing to dispatch, or why it
   * was dropped. Either way the buffer is empty afterwards.
   */
  release(context: Readonly<VRCombatSwingBufferReleaseContext>): VRCombatSwingBufferRelease {
    const swing = this.pending;
    if (!swing) return EMPTY;
    const dropReason = this.resolveDropReason(swing, context);
    this.pending = null;
    return dropReason
      ? Object.freeze({ state: 'dropped' as const, reason: dropReason })
      : Object.freeze({ state: 'released' as const, swing });
  }

  /**
   * Drops the pending swing when it can no longer be valid, without waiting
   * for the round to open. Run every frame so a stale swing does not sit on
   * the hilt as "armed" after its target has died.
   */
  invalidate(context: Readonly<VRCombatSwingBufferReleaseContext>): VRCombatSwingDropReason | null {
    const swing = this.pending;
    if (!swing) return null;
    const dropReason = this.resolveDropReason(swing, context);
    if (dropReason) this.pending = null;
    return dropReason;
  }

  clear(): void {
    this.pending = null;
  }

  private resolveDropReason(
    swing: VRCombatBufferedSwing,
    context: Readonly<VRCombatSwingBufferReleaseContext>,
  ): VRCombatSwingDropReason | null {
    if (swing.actorId !== context.actorId) return 'actor-changed';
    if (swing.weaponSignature !== context.weaponSignature) return 'weapon-changed';
    if (!context.inCombat) return 'combat-ended';
    if (!context.isTargetLive(swing.targetId)) return 'target-invalid';
    return null;
  }
}

const EMPTY = Object.freeze({ state: 'empty' as const });

function validateSwing(swing: VRCombatBufferedSwing): void {
  if (!swing || typeof swing !== 'object') throw new TypeError('A buffered swing is required.');
  for (const key of ['actorId', 'targetId', 'weaponSignature'] as const) {
    if (typeof swing[key] !== 'string' || !swing[key].trim()) {
      throw new TypeError(`buffered swing ${key} must be a non-empty string`);
    }
  }
  if (swing.input !== 'dominant-swing' && swing.input !== 'dominant-trigger') {
    throw new TypeError('only a swing or a trigger pull can be buffered');
  }
}
