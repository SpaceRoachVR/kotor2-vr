import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";

/**
 * The slot bits an item's `equipableslots` must carry to go into `slot`.
 *
 * TSL's second weapon set has its own slots (RIGHTHAND2 0x40000, LEFTHAND2
 * 0x80000), but baseitems.2da never lists them: every weapon carries only the
 * first set's bits — a Blaster Pistol is 0x00030, a Blaster Carbine 0x00010,
 * read from the install. Filtering the second set's list by its own bit
 * therefore matched nothing, and the equipment screen offered no weapons for
 * it (round 8, N6: "does not show any available weapons for the second set,
 * even when I have weapons in the inventory which are not equipped").
 */
export function resolveEquipableSlotMask(slot: number): number {
  switch (slot) {
    case ModuleCreatureArmorSlot.RIGHTHAND2: return ModuleCreatureArmorSlot.RIGHTHAND;
    case ModuleCreatureArmorSlot.LEFTHAND2: return ModuleCreatureArmorSlot.LEFTHAND;
    default: return slot;
  }
}

/** Whether a base item's `equipableslots` admits it to `slot`. */
export function canEquipInSlot(equipableSlots: number, slot: number): boolean {
  const mask = resolveEquipableSlotMask(slot);
  return (equipableSlots & mask) !== 0 || equipableSlots === mask;
}
