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
 * other refusal — no target, a dead actor — drops the swing, because nothing
 * about waiting would make it valid. (The player's own pause is not a gate
 * reason: a swing held when the game is paused keeps its place, round 17.)
 */
const BUFFERABLE_REASONS: ReadonlySet<VRCombatTempoGateReason> = new Set<VRCombatTempoGateReason>([
  // The engine holds a round paused for the whole of an attack
  // (ActionPhysicalAttacks pauses it ROUND_LENGTH) and for half a round when
  // the creature is attacked, so in a real fight almost every swing between
  // round openings lands here. Not buffering it threw those swings away
  // (critic run 3); the player's own pause is EngineState.PAUSED, not this.
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

/** How long after its round opens a held swing may still release. */
export const VR_HELD_SWING_OPENING_GRACE_SECONDS = 0.5;
/** Two rounds: a backstop for a round that never opens at all. */
export const VR_HELD_SWING_MAX_HELD_SECONDS = 6;

export type VRHeldSwingExpiry = 'opening-passed' | 'opening-missed' | 'held-too-long';

/**
 * How long a held swing lives (round 17, locked): it belongs to the next
 * round opening only. It releases within 0.5 s of that opening, or it drops.
 *
 * Counting missed openings let it outlive its moment: a round that opens with
 * the target out of reach never closes, so the swing waited for the 6 s cap
 * and fired 4.6 s after its stroke the moment the player stepped back in
 * (Tempo exp6). A stroke made then would be a new swing; this one is stale.
 *
 * Game time only. The caller does not advance it while the game is paused,
 * so a swing made before a pause keeps its place (round 17, locked).
 */
export class VRHeldSwingLifetime {
  private wasOpen = false;
  private openSeconds = 0;
  private heldSeconds = 0;

  /** A newer swing replaced the held one: its own next opening counts. */
  restart(): void {
    this.wasOpen = false;
    this.openSeconds = 0;
    this.heldSeconds = 0;
  }

  /**
   * One running game frame on which the held swing did not release. Returns
   * why it expires, or null while it may still release.
   */
  advance(roundOpen: boolean, deltaSeconds: number): VRHeldSwingExpiry | null {
    const seconds = Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0;
    this.heldSeconds += seconds;
    if (this.wasOpen && !roundOpen) return 'opening-missed';
    if (roundOpen) {
      if (this.wasOpen) this.openSeconds += seconds;
      if (this.openSeconds >= VR_HELD_SWING_OPENING_GRACE_SECONDS) return 'opening-passed';
    }
    this.wasOpen = roundOpen;
    if (this.heldSeconds >= VR_HELD_SWING_MAX_HELD_SECONDS) return 'held-too-long';
    return null;
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
 * Whether the fight a held swing was made in is still on. The player's own
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
