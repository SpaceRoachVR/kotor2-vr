/**
 * Combat results you can hear (critic review, 2026-09-29).
 *
 * The combat-feel pass (3.13, 3.14) told a hit, a miss and a critical apart
 * through controller haptics, and round 12 felt no pulse at all through
 * Chrome + Virtual Desktop. Feedback may not depend on one channel the game
 * does not control, so each result also plays a sound on the GUI channel.
 *
 * Every cue is a retail TSL sound from the game's own archives (Allen,
 * 2026-10-02: "make sure any sounds you add to the game are appropriate
 * retail sounds"). The first two versions synthesized tones. Chosen to match
 * what retail plays for the same event, by weapon where that differs:
 *
 * - miss: the swing whoosh (cb_sw_*); a blaster miss, a bolt striking metal
 * - hit: the weapon's flesh impact (cb_ht_*leth1); a critical plays it twice
 * - parried / deflected: the retail parry sounds (cb_pa_*)
 * - hurt: a body impact on the player
 * - force: the retail Force-use sound (v_useforce)
 * - ready / refused / saved: the retail interface sounds gui_actqueue,
 *   gui_error and gui_complete
 *
 * The roll is untouched; this only presents a result the engine has decided.
 */

export type VRCombatCue = 'miss' | 'hit' | 'critical' | 'parried' | 'deflected' | 'hurt' | 'hurt-critical' | 'force' | 'ready' | 'refused' | 'saved' | 'neck-zone';

/** Which weapon family picks the sound; null when nothing is equipped or known. */
export type VRCombatCueWeapon = 'melee' | 'ranged' | 'unarmed';

export interface VRCombatCueSound {
  /** Retail WAV resref. */
  readonly resref: string;
  /** Start, seconds after the cue. */
  readonly at: number;
  readonly gain: number;
  /** Playback rate; below 1 is lower and heavier (a critical). */
  readonly rate?: number;
}

const sound = (resref: string, at = 0, gain = 1, rate = 1): VRCombatCueSound => Object.freeze({ resref, at, gain, rate });

const IMPACT: Readonly<Record<VRCombatCueWeapon, string>> = Object.freeze({
  melee: 'cb_ht_bladeleth1',
  ranged: 'cb_ht_blastleth1',
  unarmed: 'cb_ht_unarmleth1',
});

const MISS: Readonly<Record<VRCombatCueWeapon, string>> = Object.freeze({
  melee: 'cb_sw_blade1',
  // A bolt striking the wall behind the target: stone, quieter (below), so a
  // miss never sounds more like a hit than a hit on a metal droid does
  // (critic run 9).
  ranged: 'cb_bu_stonemed',
  unarmed: 'cb_sw_unarmed1',
});

const PARRY: Readonly<Record<VRCombatCueWeapon, string>> = Object.freeze({
  melee: 'cb_pa_blade1',
  ranged: 'cb_pa_blade1',
  unarmed: 'cb_pa_unarm1',
});

/** The retail sounds a cue plays, for the player's weapon family. */
export function describeVRCombatCue(cue: VRCombatCue, weapon: VRCombatCueWeapon = 'melee'): readonly VRCombatCueSound[] {
  switch (cue) {
    case 'miss': return [sound(MISS[weapon], 0, weapon === 'ranged' ? 0.45 : 0.8)];
    case 'hit': return [sound(IMPACT[weapon])];
    // One impact, louder and pitched down: a heavier blow. Never the parry
    // clang (run 7), and not the same sample twice, which is a flam (run 8).
    case 'critical': return [sound(IMPACT[weapon], 0, 1.35, 0.85)];
    case 'parried': return [sound(PARRY[weapon])];
    case 'deflected': return [sound('cb_pa_blast1')];
    // A blow on you: an armour impact, unlike any sound of your own hits.
    // GameState replaces it with the attacker's weapon on your material.
    case 'hurt': return [sound('cb_ht_bladearm1')];
    case 'hurt-critical': return [sound('cb_ht_bladearm1', 0, 1.35, 0.85)];
    case 'force': return [sound('v_useforce')];
    // gui_actscroll decodes to 3 ms of sound; gui_actqueue is retail's
    // "action queued" click, 0.1 s.
    case 'ready': return [sound('gui_actqueue', 0, 0.7)];
    case 'refused': return [sound('gui_error')];
    case 'saved': return [sound('gui_complete')];
    // The armed item reached the neck: hold it there to use it.
    case 'neck-zone': return [sound('gui_invselect', 0, 0.8)];
    default: return [];
  }
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

export interface VRCombatCuePlayOptions {
  /** Retail sounds to play instead of the cue's defaults (the weapon's own row). */
  readonly sounds?: readonly VRCombatCueSound[];
  /** Where in the world it happened (game coordinates, which the audio listener uses). */
  readonly position?: { readonly x: number; readonly y: number; readonly z: number } | null;
}

/** Fetches a retail WAV as encoded bytes (AudioLoader.LoadSound). */
export type VRCombatCueSoundLoader = (resref: string) => Promise<ArrayBuffer | ArrayBufferLike | Uint8Array | undefined>;

export class VRCombatCueAudio {
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();

  constructor(
    private readonly context: BaseAudioContext,
    private readonly destination: AudioNode,
    private readonly loadSound: VRCombatCueSoundLoader,
  ) {
    if (!context || !destination) throw new TypeError('VR combat cue audio needs an audio context and a destination');
    if (typeof loadSound !== 'function') throw new TypeError('VR combat cue audio needs a retail sound loader');
  }

  /**
   * Plays `cue` now, or `delayMs` from now (a deflection waits for the bolt).
   * `options.sounds` replaces the cue's default retail sounds with the
   * weapon's own weaponsounds.2da row; `options.position` places it in the
   * world through a panner instead of in the head (critic run 6).
   */
  play(cue: VRCombatCue, delayMs = 0, weapon: VRCombatCueWeapon = 'melee', options: VRCombatCuePlayOptions = {}): Promise<void> {
    const requested = this.context.currentTime + Math.max(0, Number.isFinite(delayMs) ? delayMs : 0) / 1000;
    const specs = options.sounds && options.sounds.length ? options.sounds : describeVRCombatCue(cue, weapon);
    return Promise.all(specs.map(async (spec) => {
      const buffer = await this.decode(spec.resref);
      if (!buffer) return;
      // A sound decoded late (first use) still starts as close to the event
      // as it can, never in the past.
      const t0 = Math.max(this.context.currentTime, requested + spec.at);
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = buffer;
      if (spec.rate && spec.rate !== 1 && source.playbackRate) source.playbackRate.setValueAtTime(spec.rate, t0);
      gain.gain.setValueAtTime(spec.gain, t0);
      source.connect(gain);
      let panner: PannerNode | null = null;
      const at = options.position;
      if (at && typeof (this.context as any).createPanner === 'function') {
        panner = this.context.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1.5;
        panner.rolloffFactor = 0.6;
        if (panner.positionX) {
          panner.positionX.setValueAtTime(at.x, t0);
          panner.positionY.setValueAtTime(at.y, t0);
          panner.positionZ.setValueAtTime(at.z, t0);
        } else {
          (panner as any).setPosition(at.x, at.y, at.z);
        }
        gain.connect(panner);
        panner.connect(this.destination);
      } else {
        gain.connect(this.destination);
      }
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        panner?.disconnect();
      };
      source.start(t0);
    })).then((): void => undefined);
  }

  /** Loads and decodes sounds ahead of their first use (critic run 6: the first of each cue started late). */
  preload(resrefs: readonly string[]): Promise<void> {
    return Promise.all(resrefs.filter(Boolean).map((r) => this.decode(r))).then((): void => undefined);
  }

  /** Every default cue sound, for preloading. */
  static defaultSounds(): string[] {
    const all = new Set<string>();
    for (const cue of ['miss', 'hit', 'critical', 'parried', 'deflected', 'hurt', 'hurt-critical', 'force', 'ready', 'refused', 'saved', 'neck-zone'] as const) {
      for (const weapon of ['melee', 'ranged', 'unarmed'] as const) {
        for (const s of describeVRCombatCue(cue, weapon)) all.add(s.resref);
      }
    }
    return [...all];
  }

  /** Decodes each retail sound once; a sound that cannot load stays silent. */
  private decode(resref: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(resref);
    if (!pending) {
      pending = (async (): Promise<AudioBuffer | null> => {
        try {
          const data = await this.loadSound(resref);
          if (!data) return null;
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as ArrayBuffer);
          // decodeAudioData detaches its input; hand it a copy.
          return await this.context.decodeAudioData(bytes.slice().buffer);
        } catch (error) {
          console.warn(`[VR combat cue] retail sound ${resref} could not be played`, error);
          return null;
        }
      })();
      this.buffers.set(resref, pending);
    }
    return pending;
  }
}
