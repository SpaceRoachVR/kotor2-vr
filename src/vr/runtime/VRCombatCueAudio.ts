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

export type VRCombatCue = 'miss' | 'hit' | 'critical' | 'parried' | 'deflected' | 'hurt' | 'hurt-critical' | 'force' | 'ready' | 'refused';

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
  // Round 14: the first set sat at 55-420 Hz and went unnoticed through the
  // Quest's built-in speakers, which barely reproduce that range. Everything
  // now sits at 260-2600 Hz, where they are loudest, in the same order.
  miss: [tone(0, 520, 380, 0.08, 0.25, 'sine')],
  hit: [tone(0, 900, 600, 0.11, 0.6, 'triangle')],
  critical: [tone(0, 1300, 900, 0.1, 0.75, 'triangle'), tone(0.12, 1500, 1000, 0.13, 0.8, 'triangle')],
  parried: [tone(0, 2000, 1800, 0.08, 0.35, 'square')],
  deflected: [tone(0, 2600, 2400, 0.06, 0.3, 'sine')],
  hurt: [tone(0, 420, 260, 0.18, 0.55, 'square')],
  'hurt-critical': [tone(0, 420, 260, 0.18, 0.6, 'square'), tone(0.16, 380, 240, 0.2, 0.6, 'square')],
  // Rising, unlike every combat knock: your own Force power going off.
  force: [tone(0, 600, 1200, 0.24, 0.4, 'sine'), tone(0.06, 900, 1800, 0.22, 0.25, 'triangle')],
  // The round is open: a swing now counts. Short and quiet, since it plays
  // every three seconds of a fight; the haptic tick it stands in for is not
  // available through Chrome on VDXR (critic run 3).
  ready: [tone(0, 1800, 1700, 0.035, 0.16, 'sine')],
  // Something you asked for was refused (out of range, no target, can't save
  // now): two short low falling blips, unlike any hit.
  refused: [tone(0, 360, 300, 0.07, 0.35, 'square'), tone(0.1, 300, 250, 0.08, 0.35, 'square')],
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
