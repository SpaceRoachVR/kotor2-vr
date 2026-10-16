# Lightsaber Upgrades Design

## Goal

Make TSL's Upgrade Workbench work for lightsabers: two power crystals, a lens,
an emitter and an energy cell in their slots with their bonuses applied, and a
colour crystal that changes the blade, previewed as a 3D hilt on the upgrade
screen. Removable, persisted in saves, usable in VR. Second pass of
`2026-10-15-upgrade-screen-design.md`; ROADMAP 7.7.

## Scope

In scope:

- the `lightsaber` item category and its six-slot layout;
- colour crystals: swapping, the blade's model variation, the crystal given
  back;
- use limits (alignment) read from installed parts;
- the Lightsaber tab of `upgradesel_p` and the `_LS` layout of `upgrade_p`,
  with the 3D preview in `3D_MODEL_LS`;
- VR usability, checked in the emulator.

Out of scope:

- item properties the engine does not apply yet (Keen, Skill, Immunity,
  Damage Resistance, Regeneration) — the separate ROADMAP 7.7 item;
- building a lightsaber from fixtures, Kreia refocusing the Name crystal
  (dialogue-driven, unchanged);
- the K1-tagged properties on stock sabers (they stay inactive, as in TSL).

No retail asset is modified.

## Retail behaviour

Sources: retail data (`upgrade.2da`, `upgradetypes.2da`, `upcrystals.2da`,
`baseitems.2da`, the saber and crystal templates, the `w_lghtsbr_*`,
`w_shortsbr_*`, `w_dblsbr_*` models, `upgrade_p.gui`), StrategyWiki *TSL /
Upgrade items, lightsaber*, DeadlyStream "Pre-upgrading items" (Fair Strides,
2015).

Sabers. Base items 8 Lightsaber, 9 Double-Bladed Lightsaber, 10 Short
Lightsaber (all `storepanelsort` 30, as are some non-saber melee weapons).
Stock sabers (`g_w_lghtsbr01..11`, `g_w_shortsbr01..11`, `g_w_dblsbr001..011`)
have `UpgradeLevel` 3 and no `UpgradeSlotN` fields. Visas's saber `w_ls_x01`
and the K1 `g1_` sabers have `UpgradeLevel` 0.

Slots. `UpgradeSlot0` first power crystal, `UpgradeSlot1` colour crystal
(always -1 in retail saves), `UpgradeSlot2` second power crystal,
`UpgradeSlot3` lens, `UpgradeSlot4` emitter, `UpgradeSlot5` energy cell.
Part types (`upgradetypes.2da`): 0 crystal, 1 lens, 2 emitter, 3 energy cell.
Part `UpgradeLevel`: crystals 0, lenses 1, emitters 1, cells 0, so every slot
of a level-3 saber is open. StrategyWiki: "all lightsabers are fully
upgradeable", "up to two power crystals".

Blade colour. The blade colour is the saber's `ModelVariation`: each saber
model carries its own blade texture (`w_lghtsbr_001` blue, `_002` red, ...).
A saber always has a colour crystal; colour crystals have no other effect and
cannot be created; StrategyWiki: you cannot change colour unless you hold a
separate colour crystal, i.e. the old one comes back. Colour crystals
(`u_l_colo_01..10`) are not in `upgrade.2da`. `upcrystals.2da` maps each
colour crystal to a saber template per kind:

| row | label | crystal | short | long | double |
| --- | --- | --- | --- | --- | --- |
| 0 | BLUE | u_l_colo_01 | g_w_shortsbr01 | g_w_lghtsbr01 | G_W_DBLSBR001 |
| 1 | GOLD | u_l_colo_03 | g_w_shortsbr04 | g_w_lghtsbr04 | G_W_DBLSBR004 |
| 2 | GREEN | u_l_colo_02 | g_w_shortsbr03 | g_w_lghtsbr03 | G_W_DBLSBR003 |
| 3 | VIOLET | u_l_colo_05 | g_w_shortsbr05 | g_w_lghtsbr05 | G_W_DBLSBR005 |
| 4 | RED | u_l_colo_04 | g_w_shortsbr02 | g_w_lghtsbr02 | G_W_DBLSBR002 |
| 5 | Heart | G1_W_SBRCRSTL20 | g1_w_shortsbr01 | g1_w_lghtsbr01 | G1_W_DBLSBR001 |
| 6 | Mantle | G1_W_SBRCRSTL21 | g1_w_shortsbr02 | g1_w_lghtsbr02 | G1_W_DBLSBR002 |
| 7 | Bronze | u_l_colo_10 | g_w_shortsbr07 | g_w_lghtsbr07 | g_w_dblsbr007 |
| 8 | Orange | u_l_colo_08 | g_w_shortsbr08 | g_w_lghtsbr08 | g_w_dblsbr008 |
| 9 | Silver | u_l_colo_07 | g_w_shortsbr09 | g_w_lghtsbr09 | g_w_dblsbr009 |
| 10 | White | u_l_colo_06 | g_w_shortsbr10 | g_w_lghtsbr10 | g_w_dblsbr010 |
| 11 | Viridian | u_l_colo_09 | g_w_shortsbr11 | g_w_lghtsbr11 | g_w_dblsbr011 |
| 12 | Visas | u_l_colo_x01 | w_sls_x01 | w_ls_x01 | w_dls_x01 |
| 13 | Freedon | u_l_colo_x02 | w_sls_x02 | w_ls_x02 | w_dls_x02 |

Rows 5 and 6 are K1 leftovers; `u_l_colo_x01`, `u_l_colo_x02` and most of
row 12-13's saber templates do not exist. The variation a crystal gives a
saber is the `ModelVariation` of that row's template for the saber's kind
(long-saber values: Blue 1, Red 2, Green 3, Yellow 4, Violet 5, Orange 7,
Cyan 8, Viridian 9, Silver 10, Bronze 11; short and double: 1-5 as long,
Orange 6, Cyan 7, Viridian 8, Silver 9, Bronze 10). Long-saber variation 6
(red blade, short hilt) has no row.

Power crystals. 27 `u_l_crys_*` templates in `upgrade.2da` (type 0) plus the
45 `qcrystal_*` Name-crystal rows. Some carry `UseLimitationAlignmentGroup`
(Solari light side, Qixoni dark side, Name crystal by alignment).
StrategyWiki: the Name crystal "can still be used when you're not the
restricted alignment if it's put in the same lightsaber as" a Solari or
Qixoni crystal restricted to your current alignment.

Stock saber properties. `g_w_lghtsbr01` lists 29 properties, each tagged with
a K1 `UpgradeType` bit (the K1 `Upgrades` bitmask). TSL sabers have no such
bits set; a bare saber is a plain weapon. The engine already keeps these
inactive.

`upgrade_p` lightsaber controls (left, top, width, height):
`BTN/LBL_UPGRADE31_LS` 100,127; `32_LS` 100,201; `33_LS` 100,275;
`34_LS` 340,127; `35_LS` 340,201; `36_LS` 340,275 (all 64x64);
`3D_MODEL_LS` 168,115,168,228.

## Design

### Rules: `src/game/tsl/crafting/UpgradeRules.ts` (extended)

- `ItemCategory` gains `'lightsaber'`. `categoryFor` takes the base item id as
  well as `storepanelsort`: base items 8, 9, 10 are `lightsaber`; other
  `storepanelsort` 30 items stay excluded.
- `SaberKind = 'long' | 'short' | 'double'`; `saberKindFor(baseItem)`: 8 long,
  10 short, 9 double.
- `slotTypes('lightsaber')` = `[0, COLOUR_SLOT, 0, 1, 2, 3]`, where
  `COLOUR_SLOT` is a marker (not an `upgradetypes` row). Slot index = array
  index = `UpgradeSlotN`.
- `slotMinLevel`: 0, 1, 2, 3 → 1. The colour slot is open on every listed
  saber.
- `fits` unchanged for types 0-3.

### Colour: `src/game/tsl/crafting/ColourCrystals.ts` (new, pure)

```ts
interface ColourRow { crystal: string; templates: Record<SaberKind, string>; }
parseColourTable(rows): ColourRow[]   // only rows whose crystal starts with u_l_colo_; lower-cased
isColourCrystal(table, resref): boolean
modelVariationFor(table, crystal, kind, variationOf: (template) => number | undefined): number | undefined
colourCrystalFor(table, kind, modelVariation, variationOf): string | undefined  // first row in table order
```

`variationOf` is supplied by the engine port (template `ModelVariation`,
loaded once and cached); rows whose crystal or saber template is missing give
`undefined` and are never offered.

### Engine

- Use limits: `ModuleItem`'s usability check reads the effective properties
  (own + installed parts) for use-limitation properties, with the rule "for
  each limitation type present, at least one of its properties must match".
  This replaces ruling R4 for use limits only; other usability readers keep
  their own properties.
- Colour: `ModuleItem.setModelVariation(n)` sets `modelVariation` (already
  written by `save()`). When the saber is equipped, the wearer re-equips it in
  the same slot so the model, and the blade, reload.

### Session: `src/game/tsl/crafting/UpgradeSession.ts` (extended)

- The colour slot holds a colour crystal resref (derived from the saber's
  variation on open; `undefined` = "Unknown").
- Candidates for it: bag colour crystals that give the saber a variation
  (`modelVariationFor` defined), excluding the current one. No "Remove" row;
  the slot cannot be emptied.
- Assemble with a staged colour: take one crystal from the bag, create the old
  colour crystal in the bag (skipped and logged when it is "Unknown"), set the
  variation, re-equip if equipped — all inside the existing atomic Assemble
  and its rollback. Cancel restores everything.
- Ports gain `variationOf(template)`, `setModelVariation(item, n)` and
  `giveColourCrystal(resref)`.

### Screens

- `MenuUpgradeSelect`: `BTN_LIGHTSABER` enabled; the Lightsaber tab lists
  upgradeable sabers (inventory and equipped, as the other tabs); `All`
  includes them.
- `MenuUpgrade` for a saber: hides `BTN/LBL_UPGRADE31..33` and `3D_MODEL`;
  shows `BTN/LBL_UPGRADE31_LS..36_LS` mapped to slots 0-5 (left column top to
  bottom 0, 1, 2; right column 3, 4, 5). Labels show the slot type and the
  installed part, "Empty", or for the colour slot the crystal name.
- 3D preview: `3D_MODEL_LS` gets an `LBL_3DView` (as `MenuCharacter` uses for
  `LBL_3DCHAR`). It shows the saber's model at the **staged** colour's
  variation, framed from the model's bounding box, turning slowly; staging a
  colour reloads it at once. The view is disposed when the menu closes. A
  model that fails to load leaves the control empty (logged). The VR panel
  repaints through the GUI surface revision `LBL_3DView` already bumps.

## Error handling

- A saber whose variation matches no colour row: the colour slot reads
  "Unknown"; swapping in a crystal gives nothing back (logged once).
- A colour crystal whose saber template for this kind is missing is not
  offered.
- A failed re-equip after a colour change rolls the Assemble back.
- Parts and crystals are never lost: a failed give-back aborts the Assemble.

## Testing

- Jest, rules: `categoryFor` for bases 8/9/10 and a non-saber `storepanelsort`
  30 item; slot layout; `saberKindFor`.
- Jest, colour: `parseColourTable` drops rows 5, 6 (K1) and keeps 0-4, 7-13;
  `modelVariationFor` Orange on long → 7, on short → 6; `colourCrystalFor`
  long 2 → `u_l_colo_04`, long 6 → `undefined`; missing templates skipped.
- Jest, session: colour swap takes one crystal and returns the old; no remove
  row; "Unknown" swap returns nothing; cancel restores; rollback on a failed
  give-back.
- Jest, use limits: a saber with a light-side Name crystal and a Solari is
  usable by a light-side wielder; the Name crystal alone (dark) is not.
- Emulator probe `tools/vr-emulator/probe-lightsaber.js` on a SpaceRoach save
  with a granted `g_w_lghtsbr01`, crystals, a lens, an emitter, a cell and a
  red colour crystal: the Lightsaber tab lists it; install two crystals, lens,
  emitter, cell and check the wielder's attack/damage rise; swap Blue for Red,
  check the blue crystal is in the bag and `ModelVariation` is 2; equipped
  blade model reloads (`w_lghtsbr_002`); PNG of the 3D preview at both
  colours; save, reload, variation and slots persist; pointer reach.
- `probe-upgrade.js`, `probe-workbench.js`, `probe-lab-station.js` still pass;
  full Jest and `vr:check` stay green (known baseline failures excepted).
- Headset: added to the next round's checklist.

## Open questions (verify against retail later, not blocking)

- Whether two crystals' same-kind bonuses stack in retail (current engine
  rule: the highest applies).
- Whether retail offers the hilt of long-saber variation 6 anywhere.
- Whether retail lets a colour crystal from `upgrade.2da`-less sources (e.g.
  Bronze) be selected in the screen — assumed yes.
