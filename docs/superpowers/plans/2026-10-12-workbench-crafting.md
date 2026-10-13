# Workbench Crafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TSL's Workbench item-creation screen work (create from components, break items down into components), on crafting code shared with the Lab Station.

**Architecture:** Generalise `CraftingRules` so a station is data; rename `LabStationSession` to a station-parameterised `CraftingSession` with currency-neutral ports; extract `MenuChemicals`' engine adapter into `CraftingEnginePorts` used by both screens; fill in `MenuComponent` and NWScript 354 `ShowUpgradeScreen`, which opens item creation directly until the upgrade screen exists.

**Tech Stack:** TypeScript, Jest (`@jest/globals` imports), webpack, the vr-emulator harness (Node + CDP).

**Spec:** `docs/superpowers/specs/2026-10-12-workbench-crafting-design.md` (builds on `docs/superpowers/specs/2026-10-12-lab-station-crafting-design.md`)

Repository: `C:\Users\allen\source\repos\kotor2-vr`, branch `spike/stereo-perf`. Git index is LF; do not rewrite line endings of existing files.

## Global Constraints

- Workbench recipes: `itemcreate.2da` (or the script's `sOverride2DA`: `itemcreatemira`, `tutitemcreate`), columns `label`, `skill` (required rank), `group`, `level`, `align`, `base_skill`, `dunno`, `overridetag`; `level`, `align`, `dunno` ignored.
- Create tabs: armor `[0]`, ranged `[1]`, melee `[2]`, lightsaber `[3]`, other `[4]`; no excluded groups.
- Recipe skill = `base_skill` per row (0 Computer Use, 1 Demolitions, 2 Stealth, 3 Awareness, 5 Repair, 6 Security, 7 Treat Injury).
- Value: `floor(cost * 0.05)` (1750 -> 87). Visible: `requiredRank <= rank + 8`. Creatable: `rank >= requiredRank && components >= value`.
- Breakdown yield: `rank < 1 ? 1 : floor(value * min(rank, 20) * 0.05)` with rank = the **main character's** Repair (5).
- Breakable at the workbench: any non-plot inventory item whose resref is not in `chemicalcreate.2da`; case-insensitive.
- Breakdown tabs by `baseitems.2da` `storepanelsort`: weapons 20,25,30,40,45; armor 4,5,10,15,55,60,65,70; useable 1,2,50,75,80,85,90; misc = anything else; all = every breakable item.
- `overridetag` (empty or `****` = none) replaces the created item's tag.
- Components: `PartyManager.ComponentCount` (persisted as `PT_ITEM_COMPONEN`); chemicals untouched by the workbench; never below 0.
- Lab Station behaviour must not change; `tools/vr-emulator/probe-lab-station.js` keeps passing.
- `ShowUpgradeScreen` with `nDisableItemCreation` shows `VRSpike.showNotice("Upgrading items isn't available yet.", 3000, 'info')`; `oItem` ignored.

## Review Focus

- A companion uses the bench while the Exile leads: recipe visibility uses the companion's skills; breakdown yield uses the Exile's Repair.
- A plot item and a medpac in the bag: neither is offered for breakdown at the workbench; a blaster is.
- Creating a tutorial part when the bag already holds a plain `g_i_parts01` stack: an item tagged `K_REPAIR_PART` exists afterwards (the override tag must not be lost to stack merging).
- `sOverride2DA` names a table that does not load: the screen opens with `itemcreate` and logs a warning.
- Creating at the workbench changes only components; creating at the Lab Station changes only chemicals.

---

### Task 1: Station rules for the workbench

**Files:**
- Modify: `src/game/tsl/crafting/CraftingRules.ts`
- Test: `src/tests/crafting-rules.test.ts` (extend; existing cases unchanged)

**Interfaces:**
- Produces (in `CraftingRules.ts`):
  - `CraftingCategory.key` widens to `'health' | 'stims' | 'grenades' | 'mines' | 'armor' | 'ranged' | 'melee' | 'lightsaber' | 'other'`
  - `interface BreakdownTab { key: 'all' | 'weapons' | 'armor' | 'useable' | 'misc'; storePanelSorts: number[] | 'all' | 'other'; }`
  - `CraftingStation` gains `currency: 'chemicals' | 'components'`, `breakdownRankFrom: 'user' | 'mainCharacter'`, `breakable: 'recipes' | 'anyNonPlotExceptLab'`, `breakdownTabs: BreakdownTab[]`; `id: 'lab' | 'workbench'`; `recipeTable: string`
  - `LAB_STATION` adds `currency 'chemicals'`, `breakdownRankFrom 'user'`, `breakable 'recipes'`, `breakdownTabs []`
  - `WORKBENCH_STATION: CraftingStation` — `id 'workbench'`, `recipeTable 'itemcreate'`, `valueRate 0.05`, `breakdownSkill 5`, values from Global Constraints
  - `Recipe` gains `overrideTag?: string`; `parseRecipes` fills it from `overridetag` (trimmed; empty / `****` -> undefined, case kept)
  - `breakdownTabFor(storePanelSort: number, station: CraftingStation): BreakdownTab['key'] | undefined` — first matching non-`all` tab, `misc` for unmatched when the station has a `misc` tab, undefined for stations without tabs
  - `isBreakableAt(station: CraftingStation, item: { resref: string; plot: boolean }, stationRecipes: Recipe[], labResrefs: Set<string>): boolean` — plot never; `'recipes'` = `isBreakable(item.resref, stationRecipes)`; `'anyNonPlotExceptLab'` = not in `labResrefs` (lower-case)
  - `canCreate(recipe, userRank, value, available)` — last parameter renamed from `chemicals` (same behaviour)

- [ ] **Step 1: Write the failing tests** (add to `src/tests/crafting-rules.test.ts`):

```ts
test('workbench value is 5% of the credit cost', () => {
  expect(itemValue(1750, WORKBENCH_STATION)).toBe(87);
});
test('workbench recipes keep their own skill and override tag', () => {
  const rows = {
    0: { label: 'u_r_targ_01', skill: '4', group: '1', level: '0', align: '0', base_skill: '3', dunno: '0', overridetag: '' },
    1: { label: 'g_i_parts01', skill: '1', group: '4', level: '0', align: '0', base_skill: '5', dunno: '0', overridetag: 'K_REPAIR_PART' },
    2: { label: 'G_I_DRDREPEQP001', skill: '1', group: '4', level: '0', align: '0', base_skill: '5', dunno: '0', overridetag: '****' },
  };
  const r = parseRecipes(rows, WORKBENCH_STATION);
  expect(r).toEqual([
    { resref: 'u_r_targ_01', requiredRank: 4, group: 1, skill: 3, overrideTag: undefined },
    { resref: 'g_i_parts01', requiredRank: 1, group: 4, skill: 5, overrideTag: 'K_REPAIR_PART' },
    { resref: 'g_i_drdrepeqp001', requiredRank: 1, group: 4, skill: 5, overrideTag: undefined },
  ]);
});
test('workbench create tabs map to groups', () => {
  expect(WORKBENCH_STATION.categories.map(c => [c.key, c.groups])).toEqual(
    [['armor', [0]], ['ranged', [1]], ['melee', [2]], ['lightsaber', [3]], ['other', [4]]]);
});
test('breakdown tabs come from storepanelsort', () => {
  expect([20, 25, 30, 40, 45].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(5).fill('weapons'));
  expect([4, 5, 10, 15, 55, 60, 65, 70].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(8).fill('armor'));
  expect([1, 2, 50, 75, 80, 85, 90].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(7).fill('useable'));
  expect([35, 95, 100, 0].map(s => breakdownTabFor(s, WORKBENCH_STATION))).toEqual(Array(4).fill('misc'));
  expect(breakdownTabFor(20, LAB_STATION)).toBeUndefined();
});
test('workbench breaks down any non-plot item except lab items', () => {
  const lab = new Set(['g_i_medeqpmnt01']);
  expect(isBreakableAt(WORKBENCH_STATION, { resref: 'w_blaste_01', plot: false }, [], lab)).toBe(true);
  expect(isBreakableAt(WORKBENCH_STATION, { resref: 'G_I_MEDEQPMNT01', plot: false }, [], lab)).toBe(false);
  expect(isBreakableAt(WORKBENCH_STATION, { resref: 'w_blaste_01', plot: true }, [], lab)).toBe(false);
});
test('lab station breakability is unchanged', () => {
  const labRecipes = parseRecipes({ 0: { label: 'g_i_medeqpmnt01', skilllevel: '1', group: '0', base_skill: '7' } }, LAB_STATION);
  expect(isBreakableAt(LAB_STATION, { resref: 'g_i_medeqpmnt01', plot: false }, labRecipes, new Set())).toBe(true);
  expect(isBreakableAt(LAB_STATION, { resref: 'w_blaste_01', plot: false }, labRecipes, new Set())).toBe(false);
});
```

`parseRecipes` reads the required rank from `skilllevel` when present (lab table) and from `skill` otherwise (workbench tables); the lab test above relies on that.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/tests/crafting-rules.test.ts`
Expected: FAIL (missing exports `WORKBENCH_STATION`, `breakdownTabFor`, `isBreakableAt`).

- [ ] **Step 3: Implement** the Interfaces above in `CraftingRules.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/tests/crafting-rules.test.ts src/tests/lab-station-session.test.ts`
Expected: PASS; existing lab tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/game/tsl/crafting/CraftingRules.ts src/tests/crafting-rules.test.ts
git commit -m "feat(crafting): workbench station rules"
```

### Task 2: Station-parameterised crafting session

**Files:**
- Rename: `src/game/tsl/crafting/LabStationSession.ts` -> `src/game/tsl/crafting/CraftingSession.ts` (`git mv`)
- Rename: `src/tests/lab-station-session.test.ts` -> `src/tests/crafting-session.test.ts` (`git mv`; update to the new names)
- Modify: `src/game/tsl/menu/MenuChemicals.ts` (imports and port names only)

**Interfaces:**
- Consumes: Task 1's station fields, `isBreakableAt`, `breakdownTabFor`.
- Produces:
  - `interface CraftingItem { resref: string; name: string; cost: number; stackSize: number; plot: boolean; storePanelSort: number; }`
  - `interface CraftingPorts { getCurrency(): number; setCurrency(n: number): void; skillRank(skill: number): number; breakdownRank(): number; createItem(resref: string, overrideTag?: string): Promise<boolean>; inventory(): CraftingItem[]; removeOne(item: CraftingItem): void; templateCost(resref: string): number | undefined; }`
  - `class CraftingSession { constructor(recipes: Recipe[], ports: CraftingPorts, station: CraftingStation, labResrefs?: Set<string>); recipeViews(categoryKey: CraftingCategory['key']): RecipeView[]; create(recipe: Recipe): Promise<boolean>; breakableItems(tabKey?: BreakdownTab['key']): CraftingItem[]; breakdownValue(item: CraftingItem): number; breakdown(item: CraftingItem): boolean; }`
  - `RecipeView` unchanged.
  - The station argument is required (no default). `breakdown` uses `ports.breakdownRank()`; `breakableItems` uses `isBreakableAt` and, when `tabKey` is given and not `'all'`, `breakdownTabFor(item.storePanelSort, station) === tabKey`; `create` passes `recipe.overrideTag` to `createItem`.

- [ ] **Step 1: Move the files and update the existing tests** to `CraftingSession`, `CraftingPorts`, `getCurrency/setCurrency`, `LAB_STATION` passed explicitly, `breakdownRank` returning the fake's Treat Injury, `plot: false` and `storePanelSort: 0` on fake items. Then add the failing tests:

```ts
test('workbench breakdown uses breakdownRank, not the user skill', () => {
  // WORKBENCH_STATION; user skillRank(5) = 0, breakdownRank() = 20; blaster cost 400 -> value 20 -> yield 20
  expect(session.breakdown(blaster)).toBe(true);
  expect(ports.getCurrency()).toBe(20);
});
test('workbench breakdown lists non-plot, non-lab items and filters by tab', () => {
  // inventory: blaster (storePanelSort 40), robe (5), medpac (resref in labResrefs, 1), plot datapad (plot true, 80)
  expect(session.breakableItems().map(i => i.resref)).toEqual(['w_blaste_01', 'a_robe_08']);
  expect(session.breakableItems('weapons').map(i => i.resref)).toEqual(['w_blaste_01']);
  expect(session.breakableItems('armor').map(i => i.resref)).toEqual(['a_robe_08']);
  expect(session.breakableItems('useable')).toEqual([]);
});
test('create passes the recipe override tag', async () => {
  // tutitemcreate-like recipe { resref: 'g_i_parts01', overrideTag: 'K_REPAIR_PART', requiredRank 1, skill 5 }, cost 200 -> value 10, currency 10
  expect(await session.create(part)).toBe(true);
  expect(createdCalls).toEqual([['g_i_parts01', 'K_REPAIR_PART']]);
  expect(ports.getCurrency()).toBe(0);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx jest src/tests/crafting-session.test.ts`
Expected: FAIL on the three new tests (and compile errors until the rename lands).

- [ ] **Step 3: Implement `CraftingSession`** per the Interfaces; update `MenuChemicals` to construct `new CraftingSession(recipes, ports, LAB_STATION)` with ports renamed (`getCurrency/setCurrency` on `ChemicalCount`, `breakdownRank` = the user's Treat Injury, `createItem(resref, overrideTag?)` ignoring the tag for now, `plot` and `storePanelSort` filled from the `ModuleItem`).

- [ ] **Step 4: Run to verify**

Run: `npx jest src/tests/crafting-session.test.ts src/tests/crafting-rules.test.ts` then `npx tsc --noEmit -p . 2>&1 | grep "error TS" | grep -E "crafting|MenuChemicals"`
Expected: tests PASS; no grep output.

- [ ] **Step 5: Commit**

```bash
git add -A src/game/tsl/crafting src/tests/crafting-session.test.ts src/tests/lab-station-session.test.ts src/game/tsl/menu/MenuChemicals.ts
git commit -m "refactor(crafting): station-parameterised CraftingSession"
```

### Task 3: Shared engine adapter

**Files:**
- Create: `src/game/tsl/crafting/CraftingEnginePorts.ts`
- Modify: `src/game/tsl/menu/MenuChemicals.ts` (use it; remove the moved code)
- Test: `src/tests/crafting-engine-ports.test.ts`

**Interfaces:**
- Consumes: `CraftingPorts`, `CraftingItem` (Task 2); `CraftingStation`, `Recipe` (Task 1).
- Produces:
  - `interface EngineCraftingItem extends CraftingItem { moduleItem: ModuleItem; }`
  - `class CraftingEnginePorts { constructor(station: CraftingStation); setUser(user: ModuleCreature): void; ports(): CraftingPorts; preloadTemplates(recipes: Recipe[]): Promise<void>; displayItem(resref: string): ModuleItem | undefined; toCraftingItem(item: ModuleItem): EngineCraftingItem; }`
  - `export function resolveMainCharacter(party: ModuleCreature[], player: ModuleCreature | undefined, user: ModuleCreature): ModuleCreature` — the party member with `isPlayer === true`, else `player` if `player?.isPlayer`, else `user`.
- Behaviour moved from `MenuChemicals` unchanged (template costs kept across opens, display items unregistered from `ModuleObjectManager`, missing templates logged once, WeakMap identity). New: currency reads/writes `ChemicalCount` or `ComponentCount` per `station.currency` (clamped at 0); `breakdownRank()` = `getSkillTotal(station.breakdownSkill)` of the user (`'user'`) or of `resolveMainCharacter(...)` (`'mainCharacter'`); `createItem(resref, overrideTag)` loads the UTI, sets the template's `Tag` field to `overrideTag` when given **before** `InventoryManager.addItem(gff, true)` so the tag survives stack merging, catches every error and resolves false; `plot` from the item's plot flag; `storePanelSort` from `baseitems` row `storepanelsort` of the item's base item (0 when missing).

- [ ] **Step 1: Write the failing tests** for the pure helper and the currency routing:

```ts
test('main character is the party member flagged isPlayer', () => {
  expect(resolveMainCharacter([kreia, exile], kreia, kreia)).toBe(exile);
});
test('falls back to the player record, then the user', () => {
  expect(resolveMainCharacter([kreia], exile, kreia)).toBe(exile);
  expect(resolveMainCharacter([t3], t3NotPlayer, t3)).toBe(t3);
});
test('currency follows the station', () => {
  // GameState.PartyManager stubbed { ChemicalCount: 5, ComponentCount: 9 }
  expect(new CraftingEnginePorts(WORKBENCH_STATION).ports().getCurrency()).toBe(9);
  expect(new CraftingEnginePorts(LAB_STATION).ports().getCurrency()).toBe(5);
  new CraftingEnginePorts(WORKBENCH_STATION).ports().setCurrency(-3);
  expect(GameState.PartyManager.ComponentCount).toBe(0);
});
```

(Stub `GameState` as other engine-facing tests in `src/tests/` do; creatures are plain objects with `isPlayer`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/tests/crafting-engine-ports.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `CraftingEnginePorts`** and switch `MenuChemicals` to it.

- [ ] **Step 4: Verify the Lab Station is unchanged**

Run: `npx jest --silent -w 2`, `npm run webpack:dev`, then `node tools/vr-emulator/probe-lab-station.js`
Expected: all suites pass; webpack exits 0; the probe reports every check passing.

- [ ] **Step 5: Commit**

```bash
git add src/game/tsl/crafting/CraftingEnginePorts.ts src/game/tsl/menu/MenuChemicals.ts src/tests/crafting-engine-ports.test.ts
git commit -m "refactor(crafting): shared engine adapter for crafting screens"
```

### Task 4: Workbench screen, ShowUpgradeScreen, probe

**Files:**
- Modify: `src/game/tsl/menu/MenuComponent.ts`
- Modify: `src/nwscript/NWScriptDefK2.ts` (routine 354)
- Create: `tools/vr-emulator/probe-workbench.js`
- Modify: `ROADMAP.md` (7.7)

**Interfaces:**
- Consumes: `CraftingSession` (Task 2), `CraftingEnginePorts` (Task 3), `WORKBENCH_STATION`, `parseRecipes` (Task 1), `CutsceneManager.runAfterConversation`, `VRSpike.showNotice`.
- Produces: `MenuComponent.openFor(user?: ModuleCreature, recipeTable?: string): Promise<void>`.

Screen behaviour (spec, "Screens"): as `MenuChemicals` — same list publishing (`keepScroll` after Accept, tabs reset to top), greyed rows that stay grey under hover/selection, Accept with nothing selected does nothing, busy guard — with: create tabs `BTN_CREATE_RANGED/MELEE/ARMOR/LIGHTSABER/MISC` (`MISC` = category `other`); breakdown tabs `BTN_BREAK_ALL/WEAPONS/ARMOR/USEABLE/MISC` visible only in breakdown mode; `LBL_CREDITS_VALUE` = components; `LBL_RELATEDSKILL` = the selected recipe's skill name (from `skills.2da`) and the user's rank, or in breakdown mode Repair and the main character's rank; `BTN_Cancel` closes. Recipes from `GameState.TwoDAManager.datatables.get(recipeTable)`, loading the 2DA through the engine's loader if it is not already in `datatables` (`itemcreatemira`, `tutitemcreate`); if it cannot be loaded, warn and use `itemcreate`. `labResrefs` = lower-cased labels of `chemicalcreate`. If extracting a common base with `MenuChemicals` avoids copying a logic block (list refresh, grey-out, accept), extract it into `src/game/tsl/menu/CraftingMenuBase.ts`; otherwise keep two bindings.

Routine 354: `action` runs `GameState.CutsceneManager.runAfterConversation(...)`: if `args[2]` (disable item creation) is truthy, `VRSpike.showNotice("Upgrading items isn't available yet.", 3000, 'info')` when presenting, else `console.warn`; otherwise `MenuManager.MenuComponent.openFor(args[1] as ModuleCreature, args[4] || 'itemcreate')`. `args[0]` ignored.

- [ ] **Step 1: Implement `MenuComponent.openFor`** and its control bindings.

- [ ] **Step 2: Implement routine 354.**

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit -p . 2>&1 | grep "error TS" | grep -E "MenuComponent|MenuChemicals|CraftingMenuBase|NWScriptDefK2|crafting"` then `npm run webpack:dev`
Expected: no grep output; webpack exits 0.

- [ ] **Step 4: Write `tools/vr-emulator/probe-workbench.js`**, modelled on `tools/vr-emulator/probe-lab-station.js` (same boot, pointer, stick-scroll and PNG helpers; isolated temp copy of the SpaceRoach save data; remove it in `finally`). Use a save that can load 103PER (load `Saves/000100 - Game99` then `loadModule('103PER')` via `tools/vr-emulator/probe-memory-growth.js`, as `spaceroach-world-saves.js` does). Checks:
  1. Set `ComponentCount = 200`, the Exile's Repair so `getSkillTotal(5) === 10`, Awareness so `getSkillTotal(3) >= 4`.
  2. Use the `000_Workbench` placeable (OnUsed `k_workbench`): with `000_Workbench` = 0 the help conversation starts and no menu opens; end it; use again: `MenuComponent` is foreground, no conversation, Ranged tab listed.
  3. Create `u_r_targ_01` from the Ranged tab: components drop by its value; the item is in the inventory.
  4. Breakdown: add `w_blaste_01` and `g_i_medeqpmnt01`; the Weapons tab lists the blaster and not the medpac; All does not list the medpac; break the blaster down: components rise by `floor(floor(cost*0.05) * 10 / 20)` computed from the live template cost; one blaster fewer.
  5. Companion: make Atton (or any companion) the user via `openFor(companion)`; the Exile stays main character; breakdown yield still uses the Exile's Repair (set the companion's Repair to 0 to tell them apart).
  6. Grey row stays grey under the pointer and when selected; list keeps its scroll after Accept; right stick scrolls the recipe list and the breakdown list (reuse the lab probe's helpers).
  7. Bao-Dur's route: run `k_workbench_bd` with the player as caller: `MenuComponent` opens directly.
  8. Tutorial table: give the bag a plain `g_i_parts01`; run `k_workbench_tut`: the Other tab lists the tutorial recipes; create `g_i_parts01`: an inventory item with tag `K_REPAIR_PART` exists afterwards.
  9. Override fallback: `openFor(player, 'no_such_table')` opens with `itemcreate` and logs a warning.
  10. T3 route: run `k_workbench_t3`: no menu opens; a notice with the text "Upgrading items isn't available yet." was shown (wrap `VRSpike.showNotice` to record calls).
  11. Chemicals unchanged by every workbench action.
  12. PNGs of the create and breakdown panels to `evidence/workbench-panel.png` and `evidence/workbench-panel-breakdown.png`.
  13. Save, zero `ComponentCount`, reload: the count is restored.
  Print a JSON summary; exit non-zero on any failed check.

- [ ] **Step 5: Run the probes**

Run: `node tools/vr-emulator/probe-workbench.js` then `node tools/vr-emulator/probe-lab-station.js`
Expected: every check passes in both; inspect the PNGs: all tabs, both lists, counters and buttons inside the panel.

- [ ] **Step 6: Full verification**

Run: `npx jest --silent -w 2` then `npm run vr:check` (use the worktree's own asset server with `--url` if port 8479 is held by something you did not start)
Expected: all suites pass; vr:check passes apart from the known `weapon-bash-route`.

- [ ] **Step 7: Update `ROADMAP.md` 7.7**: workbench built and emulator-verified (name the probe and what it checks), awaiting headset; upgrade screens still to build (workbench currently opens creation directly; T3's bench shows a notice).

- [ ] **Step 8: Commit**

```bash
git add src/game/tsl/menu/MenuComponent.ts src/nwscript/NWScriptDefK2.ts tools/vr-emulator/probe-workbench.js ROADMAP.md
git add src/game/tsl/menu/CraftingMenuBase.ts src/game/tsl/menu/MenuChemicals.ts 2>/dev/null || true
git commit -m "feat(crafting): workbench item creation screen and ShowUpgradeScreen"
```
