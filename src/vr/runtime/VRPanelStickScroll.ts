/**
 * Scrolling a menu list with the thumbstick (round 14, S2).
 *
 * Long lists - the level-up feat grid, inventory, the journal - could only be
 * scrolled by aiming at the little scrollbar arrows. Pushing the pointer
 * hand's stick up or down now scrolls whatever list is under the pointer: one
 * row on the push, then a row every `REPEAT_SECONDS` while it is held, faster
 * after a moment, as a held key repeats.
 */
export const VR_PANEL_STICK_DEADZONE = 0.55;
const FIRST_REPEAT_SECONDS = 0.35;
const REPEAT_SECONDS = 0.12;

export class VRPanelStickScroll {
  private direction = 0;
  private untilNext = 0;

  /**
   * `stickY` is the thumbstick's vertical axis (WebXR: negative is pushed
   * forward/up). Returns rows to scroll this frame: negative up, positive down.
   */
  update(stickY: number, deltaSeconds: number): number {
    const y = Number.isFinite(stickY) ? stickY : 0;
    const direction = y <= -VR_PANEL_STICK_DEADZONE ? -1 : y >= VR_PANEL_STICK_DEADZONE ? 1 : 0;
    if (direction === 0) {
      this.direction = 0;
      return 0;
    }
    if (direction !== this.direction) {
      this.direction = direction;
      this.untilNext = FIRST_REPEAT_SECONDS;
      return direction;
    }
    this.untilNext -= Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
    let rows = 0;
    while (this.untilNext <= 0) {
      rows += direction;
      this.untilNext += REPEAT_SECONDS;
    }
    return rows;
  }

  reset(): void {
    this.direction = 0;
  }
}
