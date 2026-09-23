/**
 * What a creature leaves on its corpse when it dies.
 *
 * Odyssey stores `Dropable` on each entry of a creature's `ItemList` and
 * `Equip_ItemList` — not in the item's own `.uti` — and only droppable items
 * become loot. This engine never read the flag, so every item a template lists
 * was lootable. Peragus' Damaged Mining Droids list grenades and `propss01`
 * (a nameless prop short sword, `{Prop SS 01}`) without the flag; reported from
 * the headset as "the nameless melee weapons are dropped by nearly every
 * defeated mining droid", and the party inventory filled with them.
 *
 * `dropable` is `0`/`1` for items that came from a creature's template list
 * (a missing flag is read as 0, as the format defines), and `undefined` for
 * items added afterwards by script — treasure a death script creates with
 * CreateItemOnObject — which are loot by construction and must be kept.
 */
export interface CorpseLootItem {
  dropable?: unknown;
}

export interface CorpseLootSelection<T extends CorpseLootItem> {
  /** Inventory the corpse keeps, in its original order. */
  readonly inventory: T[];
  /** Equipment slot keys whose droppable item moves into the corpse inventory. */
  readonly droppedEquipmentSlots: string[];
}

/** Creature-only slots that hold natural weapons and hides, never loot. */
const NATURAL_SLOTS = new Set(['HIDE', 'CLAW1', 'CLAW2', 'CLAW3']);

export function isExplicitlyUndroppable(item: CorpseLootItem | null | undefined): boolean {
  return !!item && (item.dropable === 0 || item.dropable === false);
}

export function selectCorpseLoot<T extends CorpseLootItem>(
  inventory: readonly (T | null | undefined)[],
  equipment: Readonly<Record<string, T | null | undefined>>,
): CorpseLootSelection<T> {
  const kept = inventory.filter((item): item is T => !!item && !isExplicitlyUndroppable(item));
  const droppedEquipmentSlots = Object.keys(equipment).filter((slot) => {
    const item = equipment[slot];
    return !!item && !NATURAL_SLOTS.has(slot) && (item.dropable === 1 || item.dropable === true);
  });
  return { inventory: kept, droppedEquipmentSlots };
}
