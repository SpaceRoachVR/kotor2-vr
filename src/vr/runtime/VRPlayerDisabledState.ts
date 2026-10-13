/**
 * The low notice that says why the player cannot act: stunned, knocked
 * down, paralysed, choked, held, frightened, asleep. Any source - Force Stun,
 * a stun grenade, Horror, a feat - not only the feat stun (critic run 7).
 *
 * Never for a cutscene hold (EffectCutSceneParalyze / Stunned / Horrified mark
 * their effect as a cutscene effect): Peragus's T3 jumps put one on the leader
 * and start a new module, and "Paralysed" sat over the loading screen
 * (round 18). Never outside play either: while a module loads, a menu or a
 * movie is up, or a conversation or scene runs (critic run 8).
 */
export type VRDisabledEffect =
  | { kind: 'knockdown' }
  | { kind: 'set-state'; state: number; cutscene: boolean };

export interface VRPlayerDisabledInput {
  mode: 'ingame' | 'minigame' | 'other';
  loading: boolean;
  scene: boolean;
  effects: readonly VRDisabledEffect[];
}

const SET_STATE_LABELS: Readonly<Record<number, string>> = {
  1: 'Confused',
  2: 'Frightened',
  3: 'Stunned',
  4: 'Stunned',
  5: 'Paralysed',
  6: 'Asleep',
  7: 'Choked',
  8: 'Horrified',
  9: 'Knocked back',
  10: 'Held',
};

export function resolveVRPlayerDisabledLabel(input: VRPlayerDisabledInput): string | null {
  if (input.mode === 'other' || input.loading || input.scene) return null;
  for (const effect of input.effects) {
    if (effect.kind === 'knockdown') return 'Knocked down';
    if (effect.cutscene) continue;
    const label = SET_STATE_LABELS[effect.state];
    if (label) return label;
  }
  return null;
}
