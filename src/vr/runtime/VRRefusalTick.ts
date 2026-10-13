/**
 * Part F (decision 2 of 2026-10-13, locked by Allen): an input the game
 * refuses plays the soft refused tick and nothing else - no text. An
 * off-target Force gesture, a trigger pull that cannot serve the queue head
 * (Force Push queued: Push needs a flick), a fourth wheel pick on a full
 * queue, a pull that does nothing. Before, each of these was silent and
 * read as a dead control (Bolt, Hilt, Spark, Tempo, run 2).
 *
 * Throttled so that it never spams: a held trigger or a burst of flicks is
 * one tick, not a stutter of them.
 */
export type VRRefusalTickReason =
  | 'force-gesture-off-target'
  | 'trigger-cannot-serve-head'
  | 'queue-full'
  | 'pull-did-nothing'
  // A swing or shot at a target out of weapon reach (round 18: it used to
  // say "Too far: step in"; a stroke that does nothing shows no text).
  | 'stroke-out-of-reach';

/** No two refusal ticks closer than this, whatever their reasons. */
export const VR_REFUSAL_TICK_MIN_GAP_MS = 700;
/** The same refusal again within this long stays silent. */
export const VR_REFUSAL_TICK_SAME_REASON_GAP_MS = 2500;

export class VRRefusalTickThrottle {
  private lastAt = Number.NEGATIVE_INFINITY;
  private readonly lastByReason = new Map<VRRefusalTickReason, number>();

  /** Whether this refusal may tick now; records it when it may. */
  allow(reason: VRRefusalTickReason, nowMs: number): boolean {
    if (!Number.isFinite(nowMs)) return false;
    if (nowMs - this.lastAt < VR_REFUSAL_TICK_MIN_GAP_MS) return false;
    const previous = this.lastByReason.get(reason) ?? Number.NEGATIVE_INFINITY;
    if (nowMs - previous < VR_REFUSAL_TICK_SAME_REASON_GAP_MS) return false;
    this.lastAt = nowMs;
    this.lastByReason.set(reason, nowMs);
    return true;
  }

  reset(): void {
    this.lastAt = Number.NEGATIVE_INFINITY;
    this.lastByReason.clear();
  }
}

/** The queue head a gesture or pull was refused against, as far as the tick needs it. */
export interface VRRefusalQueueHead {
  readonly kind: string;
  readonly requiredInput: string;
  readonly label: string;
}

/**
 * Whether an input the VR layer could not spend was aimed at something the
 * player had queued, and so deserves the tick. A flick with nothing queued is
 * just a swing; a palm opening with no power queued is just a hand.
 */
export function isVRRefusedInputMeaningful(
  input: 'push' | 'pull' | 'cast' | 'idle-trigger',
  head: Readonly<VRRefusalQueueHead> | null | undefined,
  context: { readonly fightOn: boolean; readonly blaster: boolean },
): boolean {
  if (input === 'idle-trigger') {
    if (!context.fightOn) return false;
    // A blaster pull in a fight is always a shot; a melee pull is only an
    // input while a trigger-cast power waits at the head.
    return context.blaster || (head?.kind === 'force-power' && head.requiredInput === 'dominant-trigger');
  }
  if (!head || head.kind !== 'force-power') return false;
  if (input === 'cast') return head.requiredInput === 'dominant-trigger';
  return head.requiredInput === 'directional-force-gesture' && new RegExp(`\\b${input}\\b`, 'i').test(head.label);
}
