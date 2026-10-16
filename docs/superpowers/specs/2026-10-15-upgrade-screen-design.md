# Item Upgrade Screen Design (weapons and armor)

## Goal

Make TSL's Upgrade Workbench work for ranged weapons, melee weapons and armor:
pick an upgradeable item, put upgrade parts into its slots, Assemble, and have
the parts' bonuses apply to the item — removable, persisted in saves, usable
in VR. Lightsabers (crystals, blade colour) are a second pass. ROADMAP 7.7.

## Scope

In scope:

- upgrade rules for ranged, melee and armor (slots, unlock levels, fit);
- live upgrade properties on items (the parts' properties count toward the
  item's stats while installed), everywhere the engine reads item stats;
- the select screen (`upgradesel_p`) and the slot screen (`upgrade_p`);
- `ShowUpgradeScreen` (354) routing to them, including the "Create Items" hop
  to the existing item-creation screen and a forced `oItem`;
- VR usability, checked in the emulator.

Out of scope:

- lightsaber upgrades (6 slots, colour crystal, blade colour, the property
  `UpgradeType` tags on stock sabers) — second pass; the Lightsaber tab is
  shown disabled;
- `upgradeitems_p` (purpose unknown; not used);
- the 3D item preview controls (`3D_MODEL`, `3D_MODEL_LS`) — hidden.

No retail asset is modified.

## Retail behaviour

Sources: retail data (`upgrade.2da`, `upgradetypes.2da`, item templates,
`upgradesel_p.gui`, `upgrade_p.gui`, `workbnch.dlg`), DeadlyStream "Pre-upgrading
items" (Fair Strides, 2015, from inspecting retail saves) and "making an item
upgradeable" (UpgradeLevel values), StrategyWiki *TSL / Upgrade items*.

Storage. An item records installed parts in six INT fields `UpgradeSlot0`..
`UpgradeSlot5`, each holding a **row index into `upgrade.2da`** (-1 = empty).
The item's own `PropertiesList` is not changed; the engine applies the
installed parts' properties. Armor uses slots 0 (overlay) and 1 (underlay);
ranged and melee weapons use slots 0-2, left to right.

`upgrade.2da`: 369 rows, columns `label`, `template` (the part's UTI resref),
`upgradetype` (row in `upgradetypes.2da`). Some rows' templates do not exist in
the install (99 of 369); those rows are ignored.

`upgradetypes.2da` (relevant rows): 4 Targeting, 5 Power Pack, 6 Firing
Chamber, 7 Melee Grip, 8 Melee Blade (edge), 9 Melee Energy Cell, 10 Armor
Overlay, 11 Armor Underlay.

`UpgradeLevel` (BYTE) on an item says how many of its slots are open; on a
part it is the minimum item level the part needs. Measured over every retail
part template: targeting 1, firing chamber 2, power pack 3; melee grip 1,
edge 1, melee energy cell 2; armor overlays and underlays carry their own
level 1-4 per part. Community table for items: blasters 1 (scope only), 2
(scope, chamber), 3 (all); vibro weapons 2; armor 1-4 by weight. Items with no
`UpgradeLevel` or 0 cannot be upgraded.

Slot layout used here:

| item | slot 0 | slot 1 | slot 2 |
| --- | --- | --- | --- |
| ranged | Targeting (4) | Firing Chamber (6) | Power Pack (5) |
| melee | Grip (7) | Edge (8) | Energy Cell (9) |
| armor | Overlay (10) | Underlay (11) | — |

(Ranged order follows the unlock order 1, 2, 3; to verify against retail.)

Item category from `baseitems.2da` `storepanelsort`: ranged 40, 45; melee 20,
25 (30 is lightsabers and pikes — excluded this pass); armor 4, 5, 10, 15.

A part fits slot *s* of item *I* when the part's `upgradetype` equals the
slot's type and `I.UpgradeLevel >= part.UpgradeLevel`. A slot is open when at
least one part of its type could fit, i.e. `I.UpgradeLevel >=` the slot type's
minimum (ranged 1/2/3, melee 1/1/2, armor 1/1).

## Design

### Rules: `src/game/tsl/crafting/UpgradeRules.ts` (pure)

```ts
type ItemCategory = 'ranged' | 'melee' | 'armor';
interface UpgradeRow { row: number; template: string; type: number; }

categoryFor(storePanelSort: number): ItemCategory | undefined
slotTypes(category: ItemCategory): number[]          // ranged [4,6,5], melee [7,8,9], armor [10,11]
slotMinLevel(type: number): number                   // 4:1 6:2 5:3 7:1 8:1 9:2 10:1 11:1
isSlotOpen(itemLevel: number, type: number): boolean
fits(part: { type: number; level: number }, slotType: number, itemLevel: number): boolean
parseUpgradeTable(rows): UpgradeRow[]                // lower-cased templates; rows without a template dropped later by the caller
rowForTemplate(table: UpgradeRow[], resref: string): UpgradeRow | undefined
```

### Engine: live upgrade properties (`src/module/ModuleItem.ts`)

- `getInstalledUpgradeRows(): number[]` from `upgradeSlot0..5` (>= 0 only).
- `getUpgradeProperties(): ItemProperty[]` — the properties of the templates
  those rows name, loaded once and cached; the cache is invalidated by
  `setUpgradeSlot(index, row)` (new; also writes the field the save uses).
- `getEffectiveProperties(): ItemProperty[]` = own properties + upgrade
  properties. Upgrade properties are always usable (no K1 `Upgrades` bitmask
  gate).
- Every stat-reading loop over `this.properties` inside `ModuleItem` switches
  to the effective list, as do the external stat readers
  `combat/CombatAttackData.ts` (weapon properties), `GameState.ts` item
  description/inspection helpers (~1024, ~1070), the NWScript property routine
  in `NWScriptDefK2.ts` (~2900) and `MenuInventory`'s usable check. Readers
  that inspect an item's *own* template data for other purposes (mines,
  unlocking, cast-spell validation) keep `properties`.
- After Assemble on an equipped item, the wearer's equipment-derived stats are
  refreshed the same way equipping does.
- Saves: `UpgradeSlotN` already loads and saves; `setUpgradeSlot` must make
  `save()` write the new value.

### Screens

Both follow the crafting screens' VR-proven list behaviour (`CraftingMenuBase`
helpers where they apply: list publishing, `keepScroll`, pointer selection).

`MenuUpgradeSelect` (`upgradesel_p`):

- Tabs `BTN_ALL`, `BTN_RANGED`, `BTN_MELEE`, `BTN_ARMOR`; `BTN_LIGHTSABER`
  shown disabled.
- `LB_UPGRADELIST`: upgradeable items (category known and `UpgradeLevel >= 1`)
  from the party inventory and those equipped on current party members (row
  text names the wearer for equipped items). `LB_DESCRIPTION`: the selected
  item's description with its installed parts.
- `BTN_UPGRADEITEMS` opens `MenuUpgrade` for the selected item;
  `BTN_CREATEITEMS` (text "Create Items") opens `MenuComponent` with the
  current recipe table, hidden when item creation is disabled; `BTN_BACK`
  closes.

`MenuUpgrade` (`upgrade_p`):

- `LBL_TITLE` = item name; the item's slot buttons `BTN_UPGRADE31..33` with
  labels `LBL_UPGRADE31..33` showing the slot type name and the installed
  part (or "Empty"); closed slots greyed and not selectable; the `_LS`
  controls and 3D model controls hidden.
- Selecting a slot fills `LB_ITEMS` with the bag's parts that fit it (plus a
  "Remove" row when the slot holds a part); `LB_DESC` / `LBL_PROPERTY` show
  the highlighted part's description.
- Choosing a part stages it; `BTN_ASSEMBLE` commits all staged changes: the
  new part is taken from the bag (one of its stack), the replaced or removed
  part is returned to the bag, `setUpgradeSlot` is called. `BTN_BACK` /
  `BTN_OK` with uncommitted changes discards them.

### Script hook: routine 354

Through `CutsceneManager.runAfterConversation`, as today:

- `nDisableUpgrade` true: open `MenuComponent` (unchanged).
- `oItem` valid and upgradeable: open `MenuUpgrade` for it directly.
- otherwise: open `MenuUpgradeSelect`, remembering the recipe table
  (`sOverride2DA` or `itemcreate`) for its Create Items button and
  `nDisableItemCreation` to hide that button. The "not available yet" notice
  is removed.

## Error handling

- Missing part templates: the row is skipped (never offered, never applied);
  an item already holding such a row keeps it but contributes no properties
  (logged once).
- An item without `UpgradeLevel` or level 0 is not listed.
- Assemble with nothing staged does nothing; a staged part that left the bag
  before Assemble is refused with no change.
- Parts are never lost: a failed return-to-bag aborts the Assemble.

## Testing

- Jest, rules: category mapping; slot types and order per category; slot
  minimum levels; `fits` by type and level (scope into a level-1 blaster yes,
  power pack into a level-2 blaster no, armor underlay level 2 into level-1
  armor no); `parseUpgradeTable`.
- Jest, engine: `getEffectiveProperties` includes an installed part's
  properties and drops them after `setUpgradeSlot(i, -1)`; `save()` writes
  `UpgradeSlotN`; a missing part template contributes nothing.
- Jest, Assemble logic (GUI-free): install takes one part from a stack;
  replace returns the old part; remove returns it; cancel changes nothing.
- Emulator probe `tools/vr-emulator/probe-upgrade.js` on the 103PER bench:
  the "upgrade items" reply opens the select screen; Ranged lists a Republic
  Blaster (level 3) and not a Blaster Carbine (level 0); install a Pinpoint
  Scope; equip the blaster and check the wielder's attack bonus rises by the
  scope's bonus; remove it and check it returns to the bag and the bonus
  drops; armor underlay into a robe; closed slots greyed; Create Items opens
  `MenuComponent`; forced `oItem` route; save, reload, `UpgradeSlot0`
  persists and the bonus still applies; pointer reach, stick scrolling, PNGs.
- Full Jest, `vr:check`; the lab-station and workbench probes still pass.

## Open questions (verify against retail later, not blocking)

- Left-to-right order of the ranged slots (assumed Targeting, Firing Chamber,
  Power Pack) and melee slots (Grip, Edge, Energy Cell).
- Whether retail lists items equipped on party members.
- What `upgradeitems_p` is for.
- Whether retail's description text lists installed parts the same way.
