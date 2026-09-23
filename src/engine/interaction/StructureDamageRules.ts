/**
 * Damage to doors and placeables.
 *
 * Round 9: "Plasma torch still does nothing". Peragus' Damaged Door
 * (sw_door_taris008) is authored with HP 15, CurrentHP 45 and Hardness 100,
 * and its OnMeleeAttacked script a_plasmachk reads the attacker's weapon: with
 * anything but a door-cutting tool it barks "too damaged to be bashed open with
 * anything short of a plasma torch", and with the Plasma Torch (item property
 * 64, DoorCutting) it does nothing at all — it lets the strike through. So the
 * torch opens the door by damage the door's hardness would otherwise absorb.
 *
 * The engine applied neither side of that: hardness was read and never used,
 * so any weapon chipped the door, and the door started at 45 hit points, three
 * times its maximum, so five torch hits in the headset left it standing.
 */

/** Damage left after hardness. A door-cutting (plasma torch) or door-sabering weapon cuts straight through. */
export function resolveStructureDamage(input: {
  readonly damage: number;
  readonly hardness: number;
  readonly cutsThrough: boolean;
}): number {
  const damage = Math.max(0, Number.isFinite(input.damage) ? input.damage : 0);
  if (input.cutsThrough) return damage;
  const hardness = Math.max(0, Number.isFinite(input.hardness) ? input.hardness : 0);
  return Math.max(0, damage - hardness);
}

/** Current hit points never exceed the authored maximum. */
export function capStructureCurrentHP(current: number, max: number): number {
  return Number.isFinite(max) && max > 0 && Number.isFinite(current) && current > max ? max : current;
}

/**
 * Takes `amount` off a per-damage-type list, entry by entry, never below zero.
 * Entries that are negative (unused slots) are left alone.
 */
export function reduceDamageList(values: readonly number[], amount: number): number[] {
  let remaining = Math.max(0, Number.isFinite(amount) ? amount : 0);
  return values.map((value) => {
    if (remaining <= 0 || !(value > 0)) return value;
    const taken = Math.min(value, remaining);
    remaining -= taken;
    return value - taken;
  });
}
