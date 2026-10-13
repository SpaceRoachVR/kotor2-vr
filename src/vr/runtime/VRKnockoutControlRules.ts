/**
 * Who you control while the party member you control is knocked out
 * (decision 6 of 2026-10-13).
 *
 * Retail keeps a downed member down until the fight is over, then revives
 * them; only a party with nobody standing is a defeat (dialog.tlk 41883), and
 * retail lets you take a standing companion meanwhile. In VR you lay on the
 * floor watching for the rest of the fight: the Exile at -19 HP stayed down
 * while the companions fought on for 12 s (Hive, run 2). So control moves to
 * the nearest standing member a moment after yours goes down, and comes back
 * to the Exile once she is up again and the fight is over. Revival and game
 * over are the engine's, unchanged.
 */

export interface VRControlMember {
  /** SwitchPlayerCharacter's argument: an NPC slot, or -1 for the Exile. */
  readonly npcId: number;
  readonly isExile: boolean;
  readonly downed: boolean;
  /** Metres from the member in control. */
  readonly distance: number;
}

export interface VRKnockoutControlInput {
  readonly controlled: VRControlMember | null;
  /** Every other party member in the area. */
  readonly others: readonly VRControlMember[];
  readonly fightOn: boolean;
  /** Control left the Exile because of a knockout and has not come back. */
  readonly knockoutSwitched: boolean;
  /** How long the member in control has been down; 0 while standing. */
  readonly controlledDownSeconds: number;
}

export type VRKnockoutControlDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'switch'; readonly npcId: number }
  | { readonly kind: 'return' };

/** Long enough to see yourself fall before the view moves. */
export const VR_KNOCKOUT_SWITCH_DELAY_SECONDS = 0.8;

export function decideVRKnockoutControl(input: VRKnockoutControlInput): VRKnockoutControlDecision {
  const controlled = input.controlled;
  if (!controlled) return { kind: 'none' };
  if (controlled.downed) {
    if (!(input.controlledDownSeconds >= VR_KNOCKOUT_SWITCH_DELAY_SECONDS)) return { kind: 'none' };
    const standing = input.others.filter((member) => !member.downed)
      .sort((a, b) => a.distance - b.distance);
    // Nobody standing is the engine's defeat screen, not a switch.
    return standing.length ? { kind: 'switch', npcId: standing[0].npcId } : { kind: 'none' };
  }
  if (input.knockoutSwitched && !controlled.isExile && !input.fightOn) {
    const exile = input.others.find((member) => member.isExile);
    if (exile && !exile.downed) return { kind: 'return' };
  }
  return { kind: 'none' };
}
