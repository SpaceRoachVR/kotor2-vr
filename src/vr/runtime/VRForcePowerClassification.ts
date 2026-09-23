/**
 * Is a spell talent a Force power?
 *
 * One rule, the engine's own: the Abilities screen's Powers tab counts a spell
 * as a Force power when its `spells.2da` usertype is 1 or 6
 * (`MenuAbilities.buildSpellsList`, `allowedTypes`). The VR action wheel used
 * the ActionMenuManager panel instead, and target panel 1 is every spell with a
 * hostile variant — so T3-M4's shock arm (`DROID_ITEM_CHARGE_ARM`) was filed
 * under "Force Powers".
 *
 * Returns `undefined` for anything that is not a spell, so callers can tell
 * "not a Force power" from "not something this rule applies to".
 */
export const FORCE_POWER_USER_TYPES: readonly number[] = [1, 6];


export function classifyVRForcePower(
  talent: unknown,
  logger: Pick<Console, 'warn'> | null = null,
): boolean | undefined {
  if (!talent || typeof talent !== 'object') return undefined;
  const spell = talent as {
    readonly userType?: unknown;
    readonly label?: unknown;
    readonly forcepoints?: unknown;
  };
  // Feats and items carry no usertype; only spells.2da rows do.
  if (spell.userType === undefined || spell.userType === null) return undefined;
  const userType = Number(spell.userType);
  const isForcePower = FORCE_POWER_USER_TYPES.includes(userType);
  // Confirmed in the round-5 headset log: DROID_ITEM_CHARGE_ARM is usertype 4,
  // so it classifies as an ability and files under Attacks.
  return isForcePower;
}
