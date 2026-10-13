/**
 * A conversation held in the world shows its dialogue on a dark plate below
 * the eyeline (round 7; the 0.9 backing is round 15's). Headset round 18
 * reported "black boxes before and after interactions, sometimes for the
 * whole interaction - like the text backdrops, but large and empty".
 *
 * Measured in the emulator (101PER Kolto Tank, "Enter the tank."): the plate
 * was presented whenever the dialogue menu was up, text or not. A node with no
 * spoken text (kolto.dlg entry 1; TSL uses them for camera, animation and
 * delay beats, and sithspawn_dlg, 106droid and hangcam have nothing else)
 * left the dialogue with nothing to bound, so the plate fell back to the
 * whole lower half of the view: a 0.65 x 0.43 m slab at 0.9 opacity with no
 * pixel of text on it. At the start of every conversation the line is also
 * hidden while the letterbox closes in (about 0.3 s), so the plate showed
 * empty first.
 *
 * The plate is shown only while there is something on it.
 */
export interface VRWorldDialogueContent {
  /** The spoken line is set and drawn (its label and every parent visible). */
  readonly messageDrawn: boolean;
  /** Replies listed for the player to pick. */
  readonly replyCount: number;
}

export function shouldPresentVRWorldDialoguePlate(content: Readonly<VRWorldDialogueContent> | null | undefined): boolean {
  if (!content) return false;
  return content.messageDrawn === true || (Number.isFinite(content.replyCount) && content.replyCount > 0);
}
