/**
 * Combat results you can hear (critic review, 2026-09-29).
 *
 * The combat-feel pass (3.13, 3.14) told a hit, a miss and a critical apart
 * through controller haptics, and round 12 felt no pulse at all through
 * Chrome + Virtual Desktop. Whatever the cause turns out to be, feedback may
 * not depend on one channel the game does not control. These are short
 * synthesized knocks on the GUI channel, chosen, like the haptic patterns, to
 * be told apart with eyes closed:
 *
 * - miss: one soft, low tap
 * - hit: one firm knock
 * - critical: two hard, higher knocks
 * - parry / clash: a short bright ring
 * - deflect: a higher ping
 * - hurt: a dull thump
 *
 * The roll is untouched; this only presents a result the engine has decided.
 */

export type VRCombatCue = 'miss' | 'hit' | 'critical' | 'parried' | 'deflected' | 'hurt' | 'hurt-critical';

export interface VRCombatCueTone {
  /** Start, seconds after the cue. */
  readonly at: number;
  readonly frequency: number;
  /** Frequency at the end of the tone; a falling pitch reads as an impact. */
  readonly endFrequency: number;
  readonly duration: number;
  readonly gain: number;
  readonly wave: 'sine' | 'triangle' | 'square';
}

const tone = (at: number, frequency: number, endFrequency: number, duration: number, gain: number, wave: VRCombatCueTone['wave']): VRCombatCueTone =>
  Object.freeze({ at, frequency, endFrequency, duration, gain, wave });

const CUES: Readonly<Record<VRCombatCue, readonly VRCombatCueTone[]>> = Object.freeze({
  miss: [tone(0, 140, 90, 0.06, 0.12, 'sine')],
  hit: [tone(0, 260, 120, 0.09, 0.45, 'triangle')],
  critical: [tone(0, 380, 160, 0.08, 0.6, 'triangle'), tone(0.09, 420, 170, 0.12, 0.7, 'triangle')],
  parried: [tone(0, 1250, 1100, 0.07, 0.22, 'square')],
  deflected: [tone(0, 1650, 1500, 0.05, 0.18, 'sine')],
  hurt: [tone(0, 95, 55, 0.14, 0.5, 'sine')],
  'hurt-critical': [tone(0, 95, 55, 0.14, 0.6, 'sine'), tone(0.12, 80, 45, 0.18, 0.6, 'sine')],
});

export function describeVRCombatCue(cue: VRCombatCue): readonly VRCombatCueTone[] {
  return CUES[cue] ?? [];
}

/** Maps a 3.13 feedback outcome to the cue that sounds for it. */
export function cueForVRCombatOutcome(outcome: string): VRCombatCue | null {
  switch (outcome) {
    case 'hit': return 'hit';
    case 'critical': return 'critical';
    case 'miss': return 'miss';
    case 'parried': return 'parried';
    case 'deflected': return 'deflected';
    default: return null;
  }
}

export class VRCombatCueAudio {
  constructor(
    private readonly context: BaseAudioContext,
    private readonly destination: AudioNode,
  ) {
    if (!context || !destination) throw new TypeError('VR combat cue audio needs an audio context and a destination');
  }

  /** Plays `cue` now, or `delayMs` from now (a deflection waits for the bolt). */
  play(cue: VRCombatCue, delayMs = 0): void {
    const start = this.context.currentTime + Math.max(0, Number.isFinite(delayMs) ? delayMs : 0) / 1000;
    for (const spec of describeVRCombatCue(cue)) {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const t0 = start + spec.at;
      const t1 = t0 + spec.duration;
      oscillator.type = spec.wave;
      oscillator.frequency.setValueAtTime(spec.frequency, t0);
      oscillator.frequency.exponentialRampToValueAtTime(spec.endFrequency, t1);
      // A 4 ms attack avoids the click of a tone starting at full volume.
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(spec.gain, t0 + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t1);
      oscillator.connect(gain);
      gain.connect(this.destination);
      oscillator.start(t0);
      oscillator.stop(t1 + 0.01);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    }
  }
}
