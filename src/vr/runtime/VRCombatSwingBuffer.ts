import type { VRCombatTempoGateReason } from './VRCombatTempoGate';
import type { VRCombatRequiredInput } from './VRCombatIntentQueue';

/**
 * One physical swing or trigger pull, held for a moment until the player's
 * next round is ready.
 *
 * WHY
 *
 * Player-paced rounds (round 18): an idle player's stroke attacks at once,
 * and a stroke inside a running round only whooshes. The one stroke kept is
 * the one made just before the next round is ready (the silent hold,
 * VRRoundStrokeBudget): a fighter swinging in rhythm would otherwise lose
 * it by a frame or two. It is never shown and never announced; if it cannot
 * land when the round is ready, it is dropped without a word.
 *
 * It holds at most one entry, and a newer stroke replaces an older one. It
 * never decides *what* fires - the dispatcher does that from the intent
 * queue at release - and it never releases into a different fight than the
 * one it was aimed at.
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
 * Gate reasons that mean "the round is busy, try again when it opens". A
 * Force power or grenade committed then is scheduled into the round rather
 * than refused (isVRForceCastSchedulable). Every other refusal - no target, a
 * dead actor - means waiting would not make it valid.
 */
const BUFFERABLE_REASONS: ReadonlySet<VRCombatTempoGateReason> = new Set<VRCombatTempoGateReason>([
  'round-paused',
  'round-active',
  'scheduled-action-pending',
  'player-action-committed',
]);

export function isVRCombatSwingBufferable(reason: VRCombatTempoGateReason): boolean {
  return BUFFERABLE_REASONS.has(reason);
}

export class VRCombatSwingBuffer {
  private pending: VRCombatBufferedSwing | null = null;

  /** Holds `swing` for the next round, replacing any earlier one. */
  hold(swing: VRCombatBufferedSwing): void {
    validateSwing(swing);
    this.pending = Object.freeze({ ...swing });
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

/**
 * How long a held stroke has waited (round 18, the silent hold). It is held
 * only when the next round is a moment away, so it normally lands within a
 * frame or two of being held; this is the backstop for a round that did not
 * become ready after all. Game time only: the caller does not advance it
 * while the game is paused, so a stroke made before a pause keeps its place.
 */
export class VRHeldSwingLifetime {
  private heldMs = 0;

  constructor(private readonly maxHeldMs: number) {
    if (!Number.isFinite(maxHeldMs) || maxHeldMs <= 0) throw new TypeError('A held stroke needs a positive lifetime.');
  }

  /** A newer stroke replaced the held one. */
  restart(): void {
    this.heldMs = 0;
  }

  /** One running game frame on which the held stroke did not land. True once it has waited too long. */
  advance(deltaSeconds: number): boolean {
    const seconds = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    this.heldMs += seconds * 1000;
    return this.heldMs >= this.maxHeldMs;
  }
}

export interface VRFightStateInput {
  /** The player's own engine combat flag. */
  readonly actorInCombat: boolean;
  /** The locked target is alive, hostile and inside lock range. */
  readonly lockedTargetLive: boolean;
  /** A live hostile inside lock range is fighting a party member. */
  readonly hostileEngagedWithParty: boolean;
}

/**
 * Whether the fight is still on (and so whether a held stroke may still land). The player's own
 * combat flag is not enough: in a group fight it drops between the player's
 * rounds while hostiles shoot the companions, and every held trigger pull was
 * thrown away as "combat ended", slowing the cadence from 3 s to 4 s (round
 * 17, Tempo exp9).
 */
export function isVRFightOngoing(input: Readonly<VRFightStateInput>): boolean {
  return input.actorInCombat === true || input.lockedTargetLive === true || input.hostileEngagedWithParty === true;
}

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
