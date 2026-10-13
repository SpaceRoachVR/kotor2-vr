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

/**
 * The stroke's own whoosh already said "air" for a result this soon after
 * it; a miss resolved later (a held swing released at the next opening)
 * still gets its whoosh.
 */
export const VR_STROKE_WHOOSH_COVERS_MS = 450;

export function strokeWhooshCoversMiss(lastStrokeWhooshMs: number | null, nowMs: number): boolean {
  return lastStrokeWhooshMs !== null && nowMs - lastStrokeWhooshMs >= 0 && nowMs - lastStrokeWhooshMs <= VR_STROKE_WHOOSH_COVERS_MS;
}

/** Every bark and impact this module can pick, for preloading. */
export function describeVRCombatVoicingSounds(): string[] {
  const out = new Set<string>(SABER_CRITICAL_IMPACTS);
  for (const voice of Object.values(PLAYER_BARKS)) {
    for (const takes of Object.values(voice)) for (const t of takes) out.add(t);
  }
  return [...out];
}
