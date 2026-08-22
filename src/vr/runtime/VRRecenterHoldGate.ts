/**
 * Long-press gate for Recenter.
 *
 * Recentring on the Meta platform is a long press, and this mirrors it. The
 * system's own recenter is a long press of the Meta button, but that button is
 * reserved by the OS for the universal menu and is never delivered to WebXR —
 * the right controller exposes only trigger, squeeze, thumbstick, A, B, and
 * thumbrest — so the gesture lives on the dominant thumbstick click.
 *
 * The hold is not only convention. That stick is also Turn, so a press-triggered
 * recenter would fire on any stray click mid-turn, and an unwanted recenter is a
 * genuine comfort event rather than a cosmetic bug.
 */
export const DEFAULT_RECENTER_HOLD_MS = 700;

export class VRRecenterHoldGate {
  private pressedSince: number | null = null;
  private firedForPress = false;

  constructor(private readonly holdMs: number = DEFAULT_RECENTER_HOLD_MS) {
    if (!Number.isFinite(holdMs) || holdMs <= 0) {
      throw new RangeError('holdMs must be a positive finite number');
    }
  }

  /**
   * Returns true on the single frame the hold threshold is crossed.
   *
   * Deliberately once per press, not once per frame while held: recentring
   * every frame would pin the head to the rig origin and fight the player's
   * real movement.
   */
  update(pressed: boolean, timestampMs: number): boolean {
    if (!pressed) {
      this.reset();
      return false;
    }
    if (!Number.isFinite(timestampMs)) return false;
    if (this.pressedSince === null) {
      this.pressedSince = timestampMs;
      return false;
    }
    // A timestamp that jumps backwards (session restart, clock rebase) would
    // otherwise leave the press stuck below threshold forever.
    if (timestampMs < this.pressedSince) {
      this.pressedSince = timestampMs;
      return false;
    }
    if (this.firedForPress) return false;
    if (timestampMs - this.pressedSince < this.holdMs) return false;
    this.firedForPress = true;
    return true;
  }

  /** Progress through the hold, 0..1 — for a future on-screen hold indicator. */
  progress(timestampMs: number): number {
    if (this.pressedSince === null || !Number.isFinite(timestampMs)) return 0;
    if (this.firedForPress) return 1;
    const held = timestampMs - this.pressedSince;
    if (held <= 0) return 0;
    return Math.min(1, held / this.holdMs);
  }

  reset(): void {
    this.pressedSince = null;
    this.firedForPress = false;
  }
}
