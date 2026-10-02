import { CombatFeatType } from "@/enums/combat/CombatFeatType";

/**
 * Two-weapon attack penalties, main/off, as the feat descriptions in
 * dialog.tlk state them: none -6/-10; Two-Weapon Fighting -6/-6; Improved
 * -4/-4; Master -2/-2; Superior I -1/-2; Superior II 0/-2; Superior III
 * 0/-1. A balanced off-hand weapon lowers the main-hand penalty by 2 more
 * (it can become a bonus: "+2/-2").
 */
export function resolveTwoWeaponPenalty(input: {
  readonly offHand: boolean;
  readonly balancedOffHand: boolean;
  hasFeat(feat: number): boolean;
}): number {
  let main = 6, off = 10;
  if(input.hasFeat(CombatFeatType.SUPER_WEAPON_FOCUS_2_WEAPON_III)){ main = 0; off = 1; }
  else if(input.hasFeat(CombatFeatType.SUPER_WEAPON_FOCUS_2_WEAPON_II)){ main = 0; off = 2; }
  else if(input.hasFeat(CombatFeatType.SUPER_WEAPON_FOCUS_2_WEAPON_I)){ main = 1; off = 2; }
  else if(input.hasFeat(CombatFeatType.TWO_WEAPON_MASTERY)){ main = 2; off = 2; }
  else if(input.hasFeat(CombatFeatType.TWO_WEAPON_ADVANCED)){ main = 4; off = 4; }
  else if(input.hasFeat(CombatFeatType.TWO_WEAPON_FIGHTING)){ main = 6; off = 6; }
  if(input.offHand) return off;
  return input.balancedOffHand ? main - 2 : main;
}
