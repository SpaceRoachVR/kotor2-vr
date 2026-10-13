# Lab Station Crafting Design

## Goal

Make TSL's Lab Station work: using one opens the "Create New Items" screen,
where the party spends CHEMICALS to create medpacs, implants, stimulants,
grenades and mines, and breaks unwanted lab items down into chemicals. It must
be usable in VR with the same pointer and stick controls as the other legacy
menus. ROADMAP 7.7.

## Why now

Headset round 17 (2026-10-12): using the 101PER medbay Lab Station did
nothing. The console showed `NWScript Action ShowChemicalUpgradeScreen not
found`; routine 773 has no implementation, and `MenuChemicals` loads the
retail `chemical_p` layout but has no behaviour.

## Scope

In scope:

- a pure, data-driven crafting rules module, written so the Workbench's
  create/breakdown screen can reuse it as a second station definition;
- the Lab Station screen (`MenuChemicals`): category tabs, create, breakdown;
- NWScript `ShowChemicalUpgradeScreen` (773) and `GetChemicals` (774);
- VR usability of the screen, checked in the emulator.

Out of scope (separate ROADMAP work):

- the Workbench's component create/breakdown screen (`MenuComponent`,
  `itemcreate.2da`), which follows directly once this lands;
- the item upgrade screen (`ShowUpgradeScreen`, `MenuUpgrade*`);
- `GetItemComponent` (771), `GetItemComponentPieceValue` (772) and
  `GetChemicalPieceValue` (775). No retail script calls any of them (scan of
  every compiled script in the install, 2026-10-12), and their meaning is not
  documented.

No retail asset is modified.

## Retail behaviour

Sources: the retail data files (`chemicalcreate.2da`, `chemical_p.gui`,
item templates, `PARTYTABLE.res`) and StrategyWiki, *TSL / Upgrade items*,
section "Lab Station", which quotes the in-game help dialogue.

Callers. Exactly two retail scripts call 773, both with `GetLastUsedBy()`:

- `k_medstation` (the Lab Station placeable's OnUsed): on first use
  (`000_MedStation` == 0) sets the global and starts the help conversation;
  afterwards opens the screen directly.
- `k_ptar_startmed`: opens the screen from the help conversation's
  "[Use the Lab Station now.]" reply. This is the call that failed in round 17.

Recipes. `chemicalcreate.2da`, 73 rows: `label` (item resref), `skilllevel`
(required rank), `group`, `base_skill` (7 = Treat Injury, 1 = Demolitions).

| group | tab | rows | skill |
| --- | --- | --- | --- |
| 0 | Health (medpacs, implants) | 20 | Treat Injury |
| 1 | Stimulants | 9 | Treat Injury |
| 2 | Mines | 25 | Demolitions |
| 3 | Grenades | 10 | Demolitions |
| 5 | HK-47 parts (rank 50; never creatable) | 8 | Demolitions |

Group 5 is excluded from the screen and from breakdown: its rank can never be
met, and its items are quest parts (`beasttenderkeycard` has no template).

Visibility and availability. A recipe is listed when its required rank is at
most the user's rank + 8, and is greyed out when the user's rank is below the
requirement or the party lacks the chemicals.

Chemical value. An item's chemical value is 50% of its credit value (template
`Cost`), rounded down. That is the creation cost. Check values: Reflex
Package, 75 credits -> 37 chemicals; Life Support Pack, 150 -> 75 (the wiki's
"Medpacs: maximum 75").

Breakdown. Only items whose resref appears in the station's table (excluding
group 5) can be broken down. Yield = 1 if the user's Treat Injury rank is
below 1, otherwise floor(value x min(rank, 20) x 5%): 5% per rank, 100% at
rank 20.

Chemicals are a party-wide counter, not an item: `PartyManager.ChemicalCount`,
already saved and loaded as retail's `PT_ITEM_CHEMICAL`.

## Design

### Rules: `src/game/tsl/crafting/CraftingRules.ts`

Pure functions and data, no engine state:

```ts
interface CraftingStation {
  id: 'lab' | 'workbench';
  recipeTable: string;            // '2da' resref: 'chemicalcreate'
  valueRate: number;              // 0.5 (lab), 0.05 (workbench later)
  breakdownSkill: number;         // SkillType.TREAT_INJURY (lab)
  categories: { key: string; groups: number[] }[];   // tab -> recipe groups
  excludedGroups: number[];       // [5] for the lab
}

interface Recipe { resref: string; requiredRank: number; group: number; skill: number; }

parseRecipes(rows, station): Recipe[]
isRecipeVisible(recipe, userRank): boolean        // requiredRank <= userRank + 8
canCreate(recipe, userRank, value, available): boolean
itemValue(cost, station): number                   // floor(cost * valueRate)
breakdownYield(value, breakdownRank): number       // rank < 1 ? 1 : floor(value * min(rank,20) * 0.05)
isBreakable(resref, recipes): boolean              // case-insensitive match, excluded groups removed
```

`LAB_STATION` is the only station defined now. The Workbench later adds a
second definition (`itemcreate.2da`, 0.05, Repair); its own rule differences
(the main character's Repair rank decides breakdown) are handled then, not
anticipated here.

### Screen: `src/game/tsl/menu/MenuChemicals.ts`

Fills in the existing stub, following `MenuStore`'s two-list pattern:

- `open(user: ModuleCreature)` records the user; with no valid creature it
  uses the party leader.
- Create mode (default): `BTN_CREATE_HEALTH/STIMS/GRENADES/MINES` select a
  tab; `LB_SHOPITEMS` lists the tab's visible recipes as item rows (template
  loaded from the resref), greyed when not creatable. Selecting a row shows
  its description in `LB_DESCRIPTION`, its value in `LBL_COST_VALUE`, and the
  number already carried in `LBL_STOCK_VALUE`. `LBL_RELATEDSKILL` shows the
  user's rank in the recipe's skill.
- `BTN_Accept` ("Create Item"): if creatable, subtract the value from
  `ChemicalCount`, add one item to the inventory, refresh the counters.
- `BTN_Examine` toggles breakdown mode: `LB_INVITEMS` lists the inventory's
  breakable items; Accept removes one item of the selected stack and adds its
  yield. The button text swaps between "View Breakdown Items" and the create
  label, as the store's Examine button does.
- `LBL_CREDITS_VALUE` always shows the party's chemicals.
- `BTN_Cancel` closes the screen.

Rank used for visibility, availability and yield: the user's skill total as
the character sheet shows it (`getSkillTotal`). See "Open questions".

### Script hooks: `src/nwscript/NWScriptDefK2.ts`

- 773 `ShowChemicalUpgradeScreen(oCharacter)`: open `MenuChemicals` for
  `oCharacter` (party leader if invalid). When called from a conversation
  reply, the screen opens once the conversation has closed, so the dialogue
  teardown cannot hide it.
- 774 `GetChemicals()`: return `PartyManager.ChemicalCount`.

### VR

`MenuChemicals` is an ordinary legacy GUI menu, so it is shown on the VR
panel like the store. Acceptance in the emulator: the menu opens in front of
the player, tab buttons and list rows are pointer-selectable, the right stick
scrolls both lists, the whole layout fits the panel, and closing returns to
play.

## Error handling

- A recipe whose template is missing (`beasttenderkeycard`) is skipped and
  logged once, never listed.
- Accept with nothing selected, or on a greyed recipe, does nothing.
- Chemicals never go negative; a create that would overdraw is refused.
- If the user creature is gone when the screen acts, fall back to the party
  leader.

## Testing

- Jest, `CraftingRules`: visibility at rank + 8 and + 9; availability by rank
  and by chemicals; value rounding (75 -> 37, 150 -> 75); breakdown yield at
  rank 0, 1, 10, 20 and 25; breakability (case-insensitive, group 5 excluded);
  parsing of the real `chemicalcreate.2da` row shape.
- Emulator probe on a SpaceRoach save with Treat Injury > 0: use the real
  101PER Lab Station through its OnUsed script (first use plays the help
  conversation; its "Use the Lab Station now" reply opens the screen); create
  a Medpac and check chemicals and inventory; break one down and check both
  again; save, reload, and check the chemical count persisted.
- Full Jest suite and `vr:check` stay green.
- Headset: added to the next round's checklist.

## Open questions (verify against retail later, not blocking)

- Whether the rank is the character-sheet total (with ability modifier) or the
  bare effective rank. The design uses the total, which is what the screen's
  "Current Skill" label suggests.
- Rounding: the design floors everywhere; the wiki's 75 -> 37 example agrees
  for value.
- Whether breakdown consumes one item per press or the whole stack. The design
  consumes one.
