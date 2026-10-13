/**
 * Which retail voice and impact sounds a combat moment uses (combat redesign,
 * Part D). Every resref here is a retail TSL WAV, checked against the install's
 * chitin.key (sounds.bif) or StreamSounds:
 *
 * - The PC's pain, low-health and critical barks. Retail TSL has no SSF for
 *   the PC (soundset.2da stops at row 65 and the save names row 85), but
 *   dialog.tlk carries the PC soundset's lines: StrRefs 37416/37417 are
 *   `p_plyermw_hit1/2` ("Pain Grunt"), 37418 `p_plyermw_low2`, 37420
 *   `p_plyermw_crit2`; the female set is 37355-37359 (`p_plyerfw_*`).
 *   The low-health and critical lines use all three retail takes so a line
 *   heard every few fights does not repeat word for word.
 * - A lightsaber's critical: `cb_ls_hithard1/2`, retail's heavy saber impact,
 *   in place of the hit sample re-pitched (Spark, Finding 5).
 */

export type VRCombatBarkKind = 'pain' | 'low-health' | 'critical';
export type VRPlayerVoice = 'male' | 'female';

const PLAYER_BARKS: Readonly<Record<VRPlayerVoice, Readonly<Record<VRCombatBarkKind, readonly string[]>>>> = Object.freeze({
  male: Object.freeze({
    pain: Object.freeze(['p_plyermw_hit1', 'p_plyermw_hit2']),
    'low-health': Object.freeze(['p_plyermw_low1', 'p_plyermw_low2', 'p_plyermw_low3']),
    critical: Object.freeze(['p_plyermw_crit1', 'p_plyermw_crit2', 'p_plyermw_crit3']),
  }),
  female: Object.freeze({
    pain: Object.freeze(['p_plyerfw_hit1', 'p_plyerfw_hit2']),
    'low-health': Object.freeze(['p_plyerfw_low1', 'p_plyerfw_low2', 'p_plyerfw_low3']),
    critical: Object.freeze(['p_plyerfw_crit1', 'p_plyerfw_crit2', 'p_plyerfw_crit3']),
  }),
});

/** The PC's retail bark takes for a moment, by the PC's gender (0 male, 1 female). */
export function describeVRPlayerBarks(kind: VRCombatBarkKind, gender: number): readonly string[] {
  return PLAYER_BARKS[gender === 1 ? 'female' : 'male'][kind];
}

/** One of the takes, or '' when there are none. */
export function pickVRBark(takes: readonly string[], random: () => number = Math.random): string {
  const usable = takes.filter(Boolean);
  if (!usable.length) return '';
  return usable[Math.min(usable.length - 1, Math.floor(random() * usable.length))];
}

/**
 * How often a struck enemy voices its pain bark: often enough to sell the
 * blow, rare enough that it is not on every hit (Spark, option A1).
 */
export const VR_TARGET_PAIN_CHANCE = 0.4;

export function shouldVoiceTargetPain(critical: boolean, random: () => number = Math.random): boolean {
  return critical || random() < VR_TARGET_PAIN_CHANCE;
}

const SABER_CRITICAL_IMPACTS = Object.freeze(['cb_ls_hithard1', 'cb_ls_hithard2']);

/** A lightsaber's critical impact, or null for other weapons (they keep the heavier hit). */
export function resolveVRCriticalImpact(hitImpactResRef: string, random: () => number = Math.random): string | null {
  if (!/^cb_ls_/i.test(String(hitImpactResRef || ''))) return null;
  return pickVRBark(SABER_CRITICAL_IMPACTS, random);
}

/** Every bark and impact this module can pick, for preloading. */
export function describeVRCombatVoicingSounds(): string[] {
  const out = new Set<string>(SABER_CRITICAL_IMPACTS);
  for (const voice of Object.values(PLAYER_BARKS)) {
    for (const takes of Object.values(voice)) for (const t of takes) out.add(t);
  }
  return [...out];
}

/**
 * Part F (decision 4 of 2026-10-13): the stroke's whoosh varies. One sample on
 * every stroke (`cb_ls_swingshrt1`, 16 of 16) read as a loop (Spark, run 2).
 * The weapon's own weaponsounds.2da row has three short and three long swing
 * takes; retail's Lightsaber row names `cb_ls_swingshrt1-3` and
 * `cb_ls_swinglong1-3`. Blade (`cb_sw_blade1`), Large_Blade
 * (`cb_sw_bldlrg1`) and Unarmed (`cb_sw_unarmed1`) have one take in all six
 * columns, so those rotate a slight pitch instead - the same retail WAV.
 */
export interface VRStrokeWhooshRow {
  readonly swingShort0?: string;
  readonly swingShort1?: string;
  readonly swingShort2?: string;
  readonly swingLong0?: string;
  readonly swingLong1?: string;
  readonly swingLong2?: string;
}

export interface VRStrokeShape {
  readonly speedMetresPerSecond: number;
  readonly twoHanded: boolean;
}

/** A stroke at least this fast at the hand, or any two-handed stroke, is a long swing. */
export const VR_LONG_STROKE_SPEED_METRES_PER_SECOND = 2.8;
/** A one-take family rotates these rates so neighbouring strokes differ. */
const ONE_TAKE_RATES = Object.freeze([1, 0.94, 1.06]);

export class VRStrokeWhooshPicker {
  private lastResref = '';
  private turn = 0;

  /** The whoosh for this stroke, or null when the row names none. */
  pick(row: Readonly<VRStrokeWhooshRow> | null | undefined, stroke: Readonly<VRStrokeShape>): { resref: string; rate: number } | null {
    if (!row) return null;
    const long = stroke.twoHanded === true ||
      (Number.isFinite(stroke.speedMetresPerSecond) && stroke.speedMetresPerSecond >= VR_LONG_STROKE_SPEED_METRES_PER_SECOND);
    const takes = (long
      ? [row.swingLong0, row.swingLong1, row.swingLong2]
      : [row.swingShort0, row.swingShort1, row.swingShort2])
      .map((resref) => String(resref ?? '').trim().toLowerCase())
      .filter((resref) => resref && resref !== '****');
    const distinct = [...new Set(takes)];
    if (!distinct.length) {
      // A row with only the short swings filled still swings on a long stroke.
      if (long) return this.pick(row, { speedMetresPerSecond: 0, twoHanded: false });
      return null;
    }
    this.turn += 1;
    if (distinct.length === 1) {
      this.lastResref = distinct[0];
      return { resref: distinct[0], rate: ONE_TAKE_RATES[this.turn % ONE_TAKE_RATES.length] };
    }
    // Round the takes, never the same one twice running.
    let index = this.turn % distinct.length;
    if (distinct[index] === this.lastResref) index = (index + 1) % distinct.length;
    this.lastResref = distinct[index];
    return { resref: distinct[index], rate: 1 };
  }
}

/**
 * Part F (decision 4): a held swing that misses is silent apart from the
 * ready tick. Its stroke already whooshed when it was made; the result
 * whooshing again 1-3 s later sounded like a phantom second swing (Spark,
 * run 2, finding 3). Each stroke's whoosh stands for the result of the
 * attack it bought, whenever that resolves inside the held swing's life.
 */
export const VR_STROKE_RESULT_WINDOW_MS = 6500;
/** A stroke now and one held for the next opening: never more than two waiting. */
const MAX_UNRESOLVED_STROKES = 2;

export class VRStrokeResultLedger {
  private readonly strokes: number[] = [];

  /** A stroke whooshed at `nowMs`. */
  noteStroke(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    this.strokes.push(nowMs);
    while (this.strokes.length > MAX_UNRESOLVED_STROKES) this.strokes.shift();
  }

  /** A melee result other than a miss landed: its stroke is spent. */
  noteResult(nowMs: number): void {
    this.expire(nowMs);
    this.strokes.shift();
  }

  /** Whether a melee miss now was already voiced by its stroke; spends that stroke. */
  coversMiss(nowMs: number): boolean {
    this.expire(nowMs);
    if (!this.strokes.length) return false;
    this.strokes.shift();
    return true;
  }

  clear(): void {
    this.strokes.length = 0;
  }

  private expire(nowMs: number): void {
    while (this.strokes.length && nowMs - this.strokes[0] > VR_STROKE_RESULT_WINDOW_MS) this.strokes.shift();
  }
}

/** Every swing take in retail's weaponsounds.2da melee rows, for the install check. */
export const VR_RETAIL_SWING_TAKES = Object.freeze([
  'cb_ls_swingshrt1', 'cb_ls_swingshrt2', 'cb_ls_swingshrt3',
  'cb_ls_swinglong1', 'cb_ls_swinglong2', 'cb_ls_swinglong3',
  'cb_sw_blade1', 'cb_sw_bldlrg1', 'cb_sw_unarmed1',
]);
