/**
 * Pure rules for TSL's weapon and armor upgrade screens. Sources: retail
 * upgrade.2da (one row per part: template = the part's UTI resref, upgradetype
 * = row in upgradetypes.2da), upgradetypes.2da, baseitems.2da `storepanelsort`,
 * the `UpgradeLevel` item field, DeadlyStream "Pre-upgrading" notes, and the
 * StrategyWiki TSL "Upgrade items" page. A part fits a slot when its type
 * equals the slot's type and the item's UpgradeLevel is at least the part's.
 * Nothing here touches the engine, so it can be unit-tested without a game.
 * See docs/superpowers/specs/2026-10-15-upgrade-screen-design.md.
 */

export type ItemCategory = 'ranged' | 'melee' | 'armor' | 'lightsaber';

/** The colour crystal's slot type; it is not an upgrade.2da type. */
export const COLOUR_SLOT = -1;

export type SaberKind = 'long' | 'short' | 'double';

/** baseitems.2da rows for lightsabers (storepanelsort 30 is shared with other items). */
const SABER_KINDS: Record<number, SaberKind> = { 8: 'long', 9: 'double', 10: 'short' };

export interface UpgradeRow {
  row: number;
  template: string;
  type: number;
}

/** baseitems.2da `storepanelsort` values per category. */
const CATEGORY_SORTS: Record<ItemCategory, number[]> = {
  ranged: [40, 45],
  melee: [20, 25],
  armor: [4, 5, 10, 15],
  lightsaber: [],
};

/** Slot types, in on-screen order, per category. */
const SLOT_TYPES: Record<ItemCategory, number[]> = {
  ranged: [4, 6, 5],
  melee: [7, 8, 9],
  armor: [10, 11],
  lightsaber: [0, COLOUR_SLOT, 0, 1, 2, 3],
};

/** Minimum item UpgradeLevel at which a slot of each type is open. */
const SLOT_MIN_LEVEL: Record<number, number> = {
  4: 1, 6: 2, 5: 3,
  7: 1, 8: 1, 9: 2,
  10: 1, 11: 1,
  0: 1, 1: 1, 2: 1, 3: 1, [COLOUR_SLOT]: 1,
};

const TYPE_NAMES: Record<number, string> = {
  4: 'Targeting',
  5: 'Power Pack',
  6: 'Firing Chamber',
  7: 'Grip',
  8: 'Edge',
  9: 'Energy Cell',
  10: 'Overlay',
  11: 'Underlay',
  0: 'Crystal',
  1: 'Lens',
  2: 'Emitter',
  3: 'Energy Cell',
  [COLOUR_SLOT]: 'Colour Crystal',
};

export function saberKindFor(baseItem: number): SaberKind | undefined {
  return SABER_KINDS[baseItem];
}

export function categoryFor(storePanelSort: number, baseItem?: number): ItemCategory | undefined {
  if (baseItem !== undefined && SABER_KINDS[baseItem] !== undefined) return 'lightsaber';
  for (const category of Object.keys(CATEGORY_SORTS) as ItemCategory[]) {
    if (CATEGORY_SORTS[category].includes(storePanelSort)) return category;
  }
  return undefined;
}

export function slotTypes(category: ItemCategory): number[] {
  return [...SLOT_TYPES[category]];
}

export function slotMinLevel(type: number): number {
  return SLOT_MIN_LEVEL[type] ?? Infinity;
}

export function isSlotOpen(itemLevel: number, type: number): boolean {
  return itemLevel >= slotMinLevel(type);
}

export function fits(part: { type: number; level: number }, slotType: number, itemLevel: number): boolean {
  return part.type === slotType && itemLevel >= part.level;
}

export function parseUpgradeTable(rows: Record<string, Record<string, string>>): UpgradeRow[] {
  const out: UpgradeRow[] = [];
  for (const key of Object.keys(rows)) {
    const r = rows[key];
    const template = (r.template ?? '').trim().toLowerCase();
    const type = Number(r.upgradetype);
    if (!template || template === '****' || r.upgradetype === undefined || r.upgradetype === '' || !Number.isFinite(type)) continue;
    out.push({ row: Number(key), template, type });
  }
  return out;
}

export function rowForTemplate(table: UpgradeRow[], resref: string): UpgradeRow | undefined {
  const wanted = resref.trim().toLowerCase();
  return table.find(r => r.template === wanted);
}

export function upgradeTypeName(type: number): string {
  return TYPE_NAMES[type] ?? `Type ${type}`;
}
