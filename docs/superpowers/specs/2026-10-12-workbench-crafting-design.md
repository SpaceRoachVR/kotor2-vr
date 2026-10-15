# Workbench Crafting Design

## Goal

Make TSL's Workbench item-creation screen work: create upgrades, spikes,
parts, repair kits, shields and a few weapons from COMPONENTS, and break items
down into components, usable in VR. Build it on the Lab Station's crafting
code, generalised so both stations share one set of rules, one session and one
engine adapter. ROADMAP 7.7 (follow-up named there).

## Scope

In scope:

- generalising `CraftingRules`, the session and the engine adapter so a station
  is data (table, currency, value rate, rank source, breakability, tabs);
- the Workbench screen (`MenuComponent`, retail `component_p`);
- NWScript `ShowUpgradeScreen` (354);
- VR usability, checked in the emulator; the Lab Station keeps working.

Out of scope:

- the item upgrade screens (`upgradesel_p`, `upgradeitems_p`, `upgrade_p`).
  Until they exist, every workbench opens item creation directly (decided
  2026-10-12); the upgrade screen later goes in front, as in retail;
- `GetItemComponent` (771) and `GetItemComponentPieceValue` (772): no retail
  script calls them (scan, 2026-10-12).

No retail asset is modified.

## Retail behaviour

Sources: retail data (`itemcreate.2da`, `itemcreatemira.2da`,
`tutitemcreate.2da`, `component_p.gui`, `baseitems.2da`, the workbench
scripts) and StrategyWiki, *TSL / Upgrade items*, section "Workbench".

Callers of 354 `ShowUpgradeScreen(oItem, oCharacter, nDisableItemCreation,
nDisableUpgrade, sOverride2DA)`:

| script | call | where |
| --- | --- | --- |
| `k_workbench` | first use (`000_Workbench` == 0): set it, start the help conversation; else `(INVALID, GetLastUsedBy(), 0, 0, "")` | the `workbench` template (tag `000_Workbench`); 103PER's GIT does not place it (it places `plc_workb_rep`, `a_compdlg` -> `workbnch.dlg`) |
| `k_ptar_startcon` | a local-boolean first-use check, then `(INVALID, GetLastUsedBy(), 0, 0, "")` | 153HAR bench and others |
| `k_workbench_bd` | `(INVALID, GetLastUsedBy(), 0, 1, "")` | `workbnch.dlg` "create or breakdown items" reply shown when party NPC 7 is not available (`c_npc_avail`) |
| `k_workbench_bdm` | `(INVALID, GetLastUsedBy(), 0, 1, "itemcreatemira")` | same reply text, shown when party NPC 7 is available (`itemcreatemira`) |
| `k_workbench_t3` | `(INVALID, GetFirstPC(), 1, 0, "")` | `workbnch.dlg` "upgrade items" reply, always shown (upgrades only) |
| `k_workbench_tut` | `(INVALID, GetLastUsedBy(), 0, 1, "tutitemcreate")` | 001EBO prologue tutorial |

Recipes. Columns `label` (item resref), `skill` (required rank), `group`,
`level`, `align`, `base_skill`, `dunno`, `overridetag`. `itemcreate.2da` has
209 rows; `itemcreatemira.2da` 214 (adds rockets); `tutitemcreate.2da` 5.
`level`, `align` and `dunno` are 0 in every row and are ignored.

| group | create tab | contents |
| --- | --- | --- |
| 0 | Armor | armor overlays/underlays (`u_a_*`) |
| 1 | Ranged | targeting, power packs, firing chambers (`u_r_*`) |
| 2 | Melee | edges, energy cells, grips (`u_m_*`) |
| 3 | Lightsaber | cells, emitters, lenses (`u_l_*`) |
| 4 | Other | spikes, parts, repair kits, shields, blasters, rifles, melee weapons |

`base_skill` is the recipe's skill: 0 Computer Use, 1 Demolitions, 2 Stealth,
3 Awareness, 5 Repair, 6 Security, 7 Treat Injury.

`overridetag`: when set (tutorial only: `K_REPAIR_PART`, `K_COMPUTER_SPIKE`)
the created item's tag is replaced with it, so the prologue's scripts find it.

Visibility and availability: as at the Lab Station (rank + 8 to be listed;
rank and currency to be creatable), using the user's rank in the recipe's own
skill.

Value: 5% of the item's credit value (template `Cost`), rounded down. Check:
Repeating Blaster Rifle, 1750 credits -> 87 components.

Breakdown: yield = 1 if the rank is below 1, otherwise
floor(value x min(rank, 20) x 5%), where the rank is the **main character's**
Repair, whoever is using the bench. Breakable: any non-plot inventory item
except Lab Station items (resrefs in `chemicalcreate.2da`) — a player report
says medpacs and grenades broken down "turn into chemicals" rather than
components.

Components are a party-wide counter: `PartyManager.ComponentCount`, already
saved and loaded as retail's `PT_ITEM_COMPONEN`.

Breakdown tabs (`BTN_BREAK_*`), by `baseitems.2da` `storepanelsort` of the
item's base item:

| tab | storepanelsort |
| --- | --- |
| Weapons | 20, 25, 30, 40, 45 |
| Armor | 4, 5, 10, 15, 55, 60, 65, 70 |
| Useable | 1, 2, 50, 75, 80, 85, 90 |
| Misc | anything else |
| All | every breakable item |

## Design

### Rules: `src/game/tsl/crafting/CraftingRules.ts` (extended)

`CraftingStation` gains, alongside the existing fields:

```ts
currency: 'chemicals' | 'components';
breakdownRankFrom: 'user' | 'mainCharacter';
breakable: 'recipes' | 'anyNonPlotExceptLab';
breakdownTabs: { key: 'all' | 'weapons' | 'armor' | 'useable' | 'misc'; storePanelSorts: number[] | 'all' | 'other' }[];
```

`id` becomes `'lab' | 'workbench'`. `LAB_STATION` keeps its behaviour
(`chemicals`, `user`, `recipes`, no breakdown tabs). `WORKBENCH_STATION`:
`recipeTable 'itemcreate'`, `valueRate 0.05`, `breakdownSkill` Repair (5),
`currency 'components'`, `breakdownRankFrom 'mainCharacter'`,
`breakable 'anyNonPlotExceptLab'`, create categories armor `[0]`, ranged `[1]`,
melee `[2]`, lightsaber `[3]`, other `[4]`, no excluded groups, the breakdown
tabs above.

`Recipe` gains `overrideTag?: string` (empty and `****` mean none).
`parseRecipes` reads it. New pure helpers:
`breakdownTabFor(storePanelSort, station)` and
`isBreakableAt(station, item, labRecipes)` (plot items never; `recipes` mode as
today; `anyNonPlotExceptLab` excludes lab resrefs, case-insensitive).

### Session: `src/game/tsl/crafting/CraftingSession.ts`

`LabStationSession` is renamed `CraftingSession` and takes the station. Ports
become currency-neutral (`getCurrency` / `setCurrency`), gain
`breakdownRank(): number` (the session no longer picks the skill holder) and
`createItem(resref, overrideTag?)`. `CraftingItem` gains `plot: boolean` and
`storePanelSort: number`. `breakableItems(tabKey?)` filters by tab. Behaviour
otherwise unchanged (refund on failed creation, identity check, one item per
breakdown). The Lab Station's tests move to the new name and keep passing.

### Engine adapter: `src/game/tsl/crafting/CraftingEnginePorts.ts`

The port construction, template-cost preload (kept across opens), display-item
cache (unregistered from `ModuleObjectManager`) and `ModuleItem` identity map
move out of `MenuChemicals` into a class both screens use. It reads the
currency counter named by the station, ranks from the user
(`getSkillTotal`), the breakdown rank from the user or the main character
(the party member with `isPlayer`, else `PartyManager.Player` if it has
`isPlayer`, else the user), applies `overrideTag` to created items, and
catches every creation error (resolving false).

### Screens

- `MenuChemicals` keeps its behaviour and uses the shared adapter.
- `MenuComponent` (`component_p`) gets the same behaviour: create tabs
  `BTN_CREATE_RANGED/MELEE/ARMOR/LIGHTSABER/MISC`, breakdown tabs
  `BTN_BREAK_ALL/WEAPONS/ARMOR/USEABLE/MISC` (shown in breakdown mode),
  `LBL_CREDITS_VALUE` = components, `LBL_RELATEDSKILL` = the selected recipe's
  skill name and rank (breakdown mode: the main character's Repair), greyed
  rows that stay grey under the pointer, list kept in place after Accept,
  `BTN_Cancel` ("Back") closes. Shared screen behaviour moves to a common base
  only if it avoids copying a logic block; otherwise the two menus stay
  separate bindings.
- `MenuComponent.openFor(user?, recipeTable = 'itemcreate')`.

### Script hook: `src/nwscript/NWScriptDefK2.ts`

354 `ShowUpgradeScreen(oItem, oCharacter, nDisableItemCreation,
nDisableUpgrade, sOverride2DA)`, run through
`CutsceneManager.runAfterConversation`:

- `nDisableItemCreation` true: show `VRSpike.showNotice("Upgrading items isn't
  available yet.", 3000, 'info')` when presenting (console warning otherwise);
  open nothing.
- otherwise open `MenuComponent` for `oCharacter` (party leader if invalid)
  with `sOverride2DA` if non-empty, else `itemcreate`. A table that fails to
  load falls back to `itemcreate` with a console warning.
- `oItem` is ignored until the upgrade screen exists.

## Error handling

As at the Lab Station: missing templates skipped and logged once; Accept with
nothing selected does nothing; the counter never goes negative; creation
errors refund. A missing override table falls back to `itemcreate`.

## Testing

- Jest, rules: workbench value (1750 -> 87); visibility by the recipe's own
  skill; tab mapping for each `storepanelsort` group; breakability (plot items,
  lab items excluded, case-insensitive); `overrideTag` parsing (`****`, empty,
  set); the Lab Station's existing rule tests unchanged.
- Jest, session: currency-neutral create/breakdown; breakdown uses
  `breakdownRank()` (main character) not the user; tab filtering; override tag
  passed to `createItem`; the existing Lab Station session tests, renamed.
- Emulator probe `tools/vr-emulator/probe-workbench.js` on a SpaceRoach save:
  the 103PER bench `plc_workb_rep` through `workbnch.dlg` -> `k_workbench_bd`, and
  `k_workbench` as its OnUsed (help conversation on first use, then the screen on second use); create an upgrade and check components
  and inventory; break down a blaster and check the yield against the main
  character's Repair; a medpac is not offered for breakdown; stick scrolling,
  greyed rows under the pointer, list kept after Accept; the create reply script
  run directly (`k_workbench_bd`), the tutorial table's override tag
  (`k_workbench_tut` -> created part tagged `K_REPAIR_PART`), the upgrade reply (`k_workbench_t3`) shows
  the notice and opens nothing; save/reload keeps the component count.
- `tools/vr-emulator/probe-lab-station.js` still passes; full Jest and
  `vr:check` stay green (known `weapon-bash-route` failure excepted).
- Headset: added to the next round's checklist.

## Open questions (verify against retail later, not blocking)

- Whether retail's workbench lists Lab Station items in breakdown at all.
- Whether the Useable / Misc split matches retail's tabs exactly.
- Whether "main character" means the Exile even when a companion leads.
- When the Exile is not loaded at all (scripted solo segments), breakdown uses the user's Repair; retail may use the Exile's.
