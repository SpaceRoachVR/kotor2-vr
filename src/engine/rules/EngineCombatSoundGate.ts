/**
 * Which of the engine's own combat animation sounds play, given the attack
 * that the creature's round is resolving and whether VR voices it.
 *
 * The gates used to read `combatData.combatAction`, which nothing assigns:
 * from eb47d579 no creature's impact played, flatscreen included, and the
 * VR de-duplication did nothing (critic run 9). They now read the round's
 * live action (`combatRound.action`).
 *
 * - Hit: only a blow that landed makes an impact; in VR a blow given or
 *   taken by the player is voiced by the VR cue at the target instead.
 * - Swing: a swing that hits keeps its whoosh. A player's own missed swing
 *   is voiced by the VR miss cue. An enemy's missed swing at the player has
 *   no VR cue, so it keeps the engine's whoosh (critic run 9).
 * - Parry: VR voices a parry the player gives or takes.
 */
export type EngineCombatSoundEvent = 'swing' | 'parry' | 'hit';

export interface EngineCombatSoundInput {
  readonly event: EngineCombatSoundEvent;
  /** The round's attack landed (hit, critical or automatic hit). */
  readonly landed: boolean;
  /** The swinging creature is the VR player. */
  readonly swingerIsPlayer: boolean;
  /** VR is presenting with combat cues on, and the player is attacker or target. */
  readonly vrVoices: boolean;
}

export function shouldPlayEngineCombatSound(input: EngineCombatSoundInput): boolean {
  switch (input.event) {
    case 'hit':
      return input.landed && !input.vrVoices;
    case 'swing':
      return input.landed || !(input.vrVoices && input.swingerIsPlayer);
    case 'parry':
      return !input.vrVoices;
  }
}

const CANONICAL_ANIMATION_EVENTS: ReadonlyMap<string, string> = new Map([
  ['snd_footstep', 'snd_footstep'], ['swingshort', 'Swingshort'], ['swinglong', 'Swinglong'],
  ['hitparry', 'HitParry'], ['contact', 'Contact'], ['clash', 'Clash'], ['hit', 'Hit'],
]);

/** An animation event name in the spelling playEvent matches, whatever case the model used. */
export function canonicalAnimationEvent(name: unknown): string {
  const raw = String(name ?? '');
  return CANONICAL_ANIMATION_EVENTS.get(raw.toLowerCase()) ?? raw;
}
