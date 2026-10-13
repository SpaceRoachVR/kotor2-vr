# Lab Station Crafting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TSL's Lab Station open a working "Create New Items" screen (create items from chemicals, break lab items down into chemicals), usable in VR.

**Architecture:** Pure rules in `CraftingRules.ts`; a GUI-free `LabStationSession` that owns create/breakdown state behind small adapters; `MenuChemicals` binds the retail `chemical_p` controls to the session; NWScript 773 opens the menu (after any running conversation ends) and 774 reads the chemical count.

**Tech Stack:** TypeScript, Jest (`@jest/globals` imports), webpack, the vr-emulator harness (Node + CDP).

**Spec:** `docs/superpowers/specs/2026-10-12-lab-station-crafting-design.md`

Repository: `C:\Users\allen\source\repos\kotor2-vr`, branch `spike/stereo-perf`. Source files are CRLF; keep each file's line endings.

## Global Constraints

- Recipe table: `chemicalcreate.2da` columns `label`, `skilllevel`, `group`, `base_skill`; groups 0 Health, 1 Stimulants, 2 Mines, 3 Grenades; group 5 excluded everywhere.
- Visible: `requiredRank <= userRank + 8`. Creatable: `userRank >= requiredRank && chemicals >= value`.
- Value: `floor(cost * 0.5)` where cost is the item template's `Cost` (`ModuleItem.cost`).
- Breakdown yield: `rank < 1 ? 1 : floor(value * min(rank, 20) * 0.05)`, rank = the user's Treat Injury.
- Rank everywhere = `creature.getSkillTotal(skill)`; skill ids: `SkillType.TREAT_INJURY = 7`, `SkillType.DEMOLITIONS = 1`.
- Chemicals live in `PartyManager.ChemicalCount` (already persisted as `PT_ITEM_CHEMICAL`); never below 0.
- Breakdown consumes one item per Accept.
- No retail asset is modified.

## Review Focus

- Breaking down one item of a stack of 3: count drops to 2, the row stays, chemicals rise once.
- Breaking down the last item of a stack: its row disappears, the selection moves to a neighbour or clears, and a second Accept does nothing.
- Chemicals exactly equal to the value: create succeeds and leaves 0; one short: refused, nothing changes.
- Resref case: the 2DA has `G_I_DRDREPEQP001`-style upper-case labels while inventory items report lower-case template resrefs; breakability and stock counts must match case-insensitively.
- A companion (not the leader) uses the station: ranks and yield come from that companion, not the leader.

---

### Task 1: Crafting rules

**Files:**
- Create: `src/game/tsl/crafting/CraftingRules.ts`
- Test: `src/tests/crafting-rules.test.ts`

**Interfaces:**
- Produces:
  - `interface CraftingCategory { key: 'health' | 'stims' | 'grenades' | 'mines'; groups: number[]; }`
  - `interface CraftingStation { id: 'lab'; recipeTable: 'chemicalcreate'; valueRate: number; breakdownSkill: number; categories: CraftingCategory[]; excludedGroups: number[]; }`
  - `interface Recipe { resref: string; requiredRank: number; group: number; skill: number; }`
  - `const LAB_STATION: CraftingStation` — `valueRate 0.5`, `breakdownSkill 7`, categories health `[0]`, stims `[1]`, grenades `[3]`, mines `[2]`, `excludedGroups [5]`
  - `parseRecipes(rows: Record<string, Record<string, string>>, station: CraftingStation): Recipe[]` — `rows` is `TwoDAObject.rows` (object keyed by row index, values are strings); drops excluded groups and rows with an empty or `****` label; resref lower-cased
  - `recipesForCategory(recipes: Recipe[], category: CraftingCategory): Recipe[]`
  - `isRecipeVisible(recipe: Recipe, userRank: number): boolean`
  - `itemValue(cost: number, station: CraftingStation): number`
  - `canCreate(recipe: Recipe, userRank: number, value: number, chemicals: number): boolean`
  - `breakdownYield(value: number, breakdownRank: number): number`
  - `isBreakable(resref: string, recipes: Recipe[]): boolean`

- [ ] **Step 1: Write the failing tests** in `src/tests/crafting-rules.test.ts`:

```ts
import { describe, expect, test } from '@jest/globals';
import { LAB_STATION, parseRecipes, recipesForCategory, isRecipeVisible, itemValue, canCreate, breakdownYield, isBreakable } from '@/game/tsl/crafting/CraftingRules';

const rows = {
  0: { label: 'g_i_medeqpmnt01', skilllevel: '1', group: '0', base_skill: '7' },
  1: { label: 'G_I_CMBTSHOT002', skilllevel: '23', group: '1', base_skill: '7' },
  2: { label: 'g_i_trapkit018', skilllevel: '15', group: '2', base_skill: '1' },
  3: { label: 'g_w_fraggren01', skilllevel: '3', group: '3', base_skill: '1' },
  4: { label: 'hk_part', skilllevel: '50', group: '5', base_skill: '1' },
  5: { label: '****', skilllevel: '1', group: '0', base_skill: '7' },
};
const recipes = parseRecipes(rows, LAB_STATION);

test('parses rows, lower-cases resrefs, drops group 5 and blank labels', () => {
  expect(recipes.map(r => r.resref)).toEqual(['g_i_medeqpmnt01', 'g_i_cmbtshot002', 'g_i_trapkit018', 'g_w_fraggren01']);
  expect(recipes[1]).toEqual({ resref: 'g_i_cmbtshot002', requiredRank: 23, group: 1, skill: 7 });
});
test('categories map tabs to groups', () => {
  const mines = LAB_STATION.categories.find(c => c.key === 'mines')!;
  expect(recipesForCategory(recipes, mines).map(r => r.resref)).toEqual(['g_i_trapkit018']);
});
test('visible up to rank + 8', () => {
  expect(isRecipeVisible(recipes[1], 15)).toBe(true);   // 23 <= 23
  expect(isRecipeVisible(recipes[1], 14)).toBe(false);  // 23 > 22
});
test('value is half the credit cost, rounded down', () => {
  expect(itemValue(75, LAB_STATION)).toBe(37);
  expect(itemValue(150, LAB_STATION)).toBe(75);
});
test('creatable needs the rank and the chemicals', () => {
  expect(canCreate(recipes[0], 1, 20, 20)).toBe(true);   // exactly enough
  expect(canCreate(recipes[0], 1, 20, 19)).toBe(false);  // one short
  expect(canCreate(recipes[1], 22, 50, 999)).toBe(false); // rank too low
});
test('breakdown yields 1 below rank 1, 5% per rank, capped at rank 20', () => {
  expect(breakdownYield(75, 0)).toBe(1);
  expect(breakdownYield(75, 1)).toBe(3);
  expect(breakdownYield(75, 10)).toBe(37);
  expect(breakdownYield(75, 20)).toBe(75);
  expect(breakdownYield(75, 25)).toBe(75);
});
test('breakable only for lab recipes, case-insensitively', () => {
  expect(isBreakable('G_I_MEDEQPMNT01', recipes)).toBe(true);
  expect(isBreakable('hk_part', recipes)).toBe(false);
  expect(isBreakable('w_blaste_01', recipes)).toBe(false);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/tests/crafting-rules.test.ts`
Expected: FAIL, cannot find module `@/game/tsl/crafting/CraftingRules`.

- [ ] **Step 3: Implement `src/game/tsl/crafting/CraftingRules.ts`** with the Interfaces above. Comment the file with the spec's sources (chemicalcreate.2da, StrategyWiki Lab Station) as the codebase's other rules files do.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/tests/crafting-rules.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/game/tsl/crafting/CraftingRules.ts src/tests/crafting-rules.test.ts
git commit -m "feat(crafting): lab station rules from chemicalcreate.2da"
```

### Task 2: Lab station session (create and breakdown, no GUI)

**Files:**
- Create: `src/game/tsl/crafting/LabStationSession.ts`
- Test: `src/tests/lab-station-session.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `interface CraftingItem { resref: string; name: string; cost: number; stackSize: number; }`
  - `interface LabStationPorts { getChemicals(): number; setChemicals(n: number): void; skillRank(skill: number): number; createItem(resref: string): Promise<boolean>; inventory(): CraftingItem[]; removeOne(item: CraftingItem): void; templateCost(resref: string): number | undefined; }`
  - `interface RecipeView { recipe: Recipe; value: number; creatable: boolean; carried: number; }`
  - `class LabStationSession { constructor(recipes: Recipe[], ports: LabStationPorts, station?: CraftingStation); recipeViews(categoryKey: CraftingCategory['key']): RecipeView[]; create(recipe: Recipe): Promise<boolean>; breakableItems(): CraftingItem[]; breakdownValue(item: CraftingItem): number; breakdown(item: CraftingItem): boolean; }`

`recipeViews` lists the category's visible recipes whose `templateCost` is defined (missing templates skipped). `carried` sums `stackSize` of inventory items with the same resref (case-insensitive). `create` re-checks `canCreate`, deducts the value, then calls `createItem`; on `false` from `createItem` it restores the chemicals and returns false. `breakdown` refuses unbreakable items, adds `breakdownYield(itemValue(item.cost), skillRank(TREAT_INJURY))`, and calls `removeOne` once.

- [ ] **Step 1: Write the failing tests** using an in-memory fake `LabStationPorts` (chemicals counter, rank map, inventory array where `removeOne` decrements `stackSize` and drops the entry at 0, `templateCost` from a map with `g_i_medeqpmnt01: 40`, `g_i_cmbtshot002: 100`):

```ts
test('create spends exactly the value and adds the item', async () => {
  // chemicals 20, Treat Injury 1: medpac value 20
  expect(await session.create(medpac)).toBe(true);
  expect(ports.getChemicals()).toBe(0);
  expect(created).toEqual(['g_i_medeqpmnt01']);
});
test('create one chemical short changes nothing', async () => {
  // chemicals 19
  expect(await session.create(medpac)).toBe(false);
  expect(ports.getChemicals()).toBe(19);
  expect(created).toEqual([]);
});
test('a failed item creation refunds the chemicals', async () => {
  // createItem resolves false
  expect(await session.create(medpac)).toBe(false);
  expect(ports.getChemicals()).toBe(20);
});
test('recipeViews skips recipes with no template and counts carried items case-insensitively', () => {
  // inventory has { resref: 'G_I_MEDEQPMNT01', stackSize: 3 }; recipes include one with no templateCost
  const views = session.recipeViews('health');
  expect(views.map(v => v.recipe.resref)).toEqual(['g_i_medeqpmnt01']);
  expect(views[0]).toMatchObject({ value: 20, creatable: true, carried: 3 });
});
test('breaking one of a stack of three removes one and adds the yield once', () => {
  // Treat Injury 10, medpac cost 40 -> value 20 -> yield 10
  expect(session.breakdown(stack)).toBe(true);
  expect(stack.stackSize).toBe(2);
  expect(ports.getChemicals()).toBe(10);
});
test('breaking the last one removes the entry; breaking it again does nothing', () => {
  expect(session.breakdown(single)).toBe(true);
  expect(session.breakableItems()).not.toContain(single);
  expect(session.breakdown(single)).toBe(false);
});
test('unbreakable items are not listed and cannot be broken', () => {
  expect(session.breakableItems().map(i => i.resref)).not.toContain('w_blaste_01');
  expect(session.breakdown(blaster)).toBe(false);
});
test('the user rank decides, not the leader', () => {
  // ports.skillRank reads the companion's ranks: Treat Injury 23 makes the stim (rank 23) creatable
  expect(session.recipeViews('stims')[0].creatable).toBe(true);
});
```

"Breaking it again does nothing" requires `breakdown` to refuse an item no longer in `ports.inventory()` (compare by identity).

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/tests/lab-station-session.test.ts`
Expected: FAIL, cannot find module `LabStationSession`.

- [ ] **Step 3: Implement `LabStationSession`** per the Interfaces.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/tests/lab-station-session.test.ts src/tests/crafting-rules.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/tsl/crafting/LabStationSession.ts src/tests/lab-station-session.test.ts
git commit -m "feat(crafting): lab station create/breakdown session"
```

### Task 3: Run a callback after the current conversation

**Files:**
- Modify: `src/managers/CutsceneManager.ts` (static field + method; drain at the very end of `endConversation`, after the engine mode is restored)
- Test: `src/tests/cutscene-after-conversation.test.ts`

**Interfaces:**
- Produces: `static runAfterConversation(callback: () => void): void` on `CutsceneManager` — runs `callback` immediately when `CutsceneManager.active` is false; otherwise queues it and `endConversation` (aborted or not) runs the queue once, in order, then clears it. A throwing callback is logged with `console.error` and does not stop the rest.

- [ ] **Step 1: Write the failing tests:** immediate run when inactive; queued while `active = true` and run exactly once after `endConversation()`; run after `endConversation(true)` too; a throwing callback does not stop a later one. Stub what `endConversation` touches (`GameState.MenuManager.InGameDialog.close`, `audioEmitter.stop`, `dialog = undefined`) the way `src/tests/cutscene-deferred-replies.test.ts` does.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest src/tests/cutscene-after-conversation.test.ts`
Expected: FAIL, `runAfterConversation` is not a function.

- [ ] **Step 3: Implement** the queue and the drain.

- [ ] **Step 4: Run to verify they pass**

Run: `npx jest src/tests/cutscene-after-conversation.test.ts src/tests/cutscene-deferred-replies.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/managers/CutsceneManager.ts src/tests/cutscene-after-conversation.test.ts
git commit -m "feat(dialog): run a callback once the current conversation ends"
```

### Task 4: MenuChemicals screen and the script routines

**Files:**
- Modify: `src/game/tsl/menu/MenuChemicals.ts`
- Modify: `src/nwscript/NWScriptDefK2.ts` (routines 773 and 774)
- Create: `tools/vr-emulator/probe-lab-station.js`
- Modify: `ROADMAP.md` (7.7 status), `tools/vr-emulator/evidence/` (probe output only)

**Interfaces:**
- Consumes: `LabStationSession`, `LabStationPorts`, `CraftingItem`, `RecipeView` (Task 2); `LAB_STATION`, `parseRecipes`, `itemValue` (Task 1); `CutsceneManager.runAfterConversation` (Task 3).
- Produces: `MenuChemicals.openFor(user?: ModuleCreature): Promise<void>`.

Menu behaviour (spec, "Screen"):
- `openFor` picks `user` if it is a valid `ModuleCreature`, else `PartyManager.Player`; builds recipes from `GameState.TwoDAManager.datatables.get('chemicalcreate').rows`; builds ports against the engine (`PartyManager.ChemicalCount`, `user.getSkillTotal`, `InventoryManager.addItem(gff)` with the template from `ResourceLoader.loadResource(ResourceTypes.uti, resref)`, `InventoryManager.getNonQuestInventory()` mapped to `CraftingItem` with the `ModuleItem` kept for removal, `InventoryManager.removeItem(moduleItem, 1)`); preloads template costs for every recipe once per open (a missing template is logged once and treated as `undefined`); opens on the Health tab.
- Tabs `BTN_CREATE_HEALTH/STIMS/GRENADES/MINES` set the category and refill `LB_SHOPITEMS` via `setItems` with loaded `ModuleItem`s, as `MenuStore` does; rows whose view is not creatable get their label grey via `row.children[0].setTextColor(0.5, 0.5, 0.5)`.
- Row click: `LB_DESCRIPTION.setItem(item.getDescription())`, `LBL_COST_VALUE` = value, `LBL_STOCK_VALUE` = carried, `LBL_RELATEDSKILL` = the user's rank in the recipe's skill.
- `BTN_Accept`: create mode → `session.create`; breakdown mode → `session.breakdown`; then refresh the counters and the current list keeping the selection index clamped to the list.
- `BTN_Examine` toggles breakdown mode (`LB_INVITEMS` with `session.breakableItems()`; cost label shows the yield). Button texts: reuse the GUI's own strings for create mode; for breakdown mode use the store's TLK strings as `MenuStore` does (41937 / 41938) only if they read sensibly, otherwise the GUI text.
- `LBL_CREDITS_VALUE` = chemicals after every action. `BTN_Cancel` closes.

Routines in `NWScriptDefK2.ts`:
- 773 `ShowChemicalUpgradeScreen`: `action` calls `GameState.CutsceneManager.runAfterConversation(() => GameState.MenuManager.MenuChemicals.openFor(args[0] as ModuleCreature))`; return nothing.
- 774 `GetChemicals`: returns `GameState.PartyManager.ChemicalCount || 0`.

- [ ] **Step 1: Implement `MenuChemicals.openFor`** and the control bindings above.

- [ ] **Step 2: Implement routines 773 and 774.**

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit -p . 2>&1 | grep "error TS" | grep -E "MenuChemicals|NWScriptDefK2|crafting"` then `npm run webpack:dev`
Expected: no lines from the grep; webpack exits 0.

- [ ] **Step 4: Write the emulator probe `tools/vr-emulator/probe-lab-station.js`** following `tools/vr-emulator/probe-*.js` (harness + asset service on spare ports, an isolated copy of `evidence/spaceroach-saves-ZaBsC0/user`, EULA, load the Peragus save `000100`, `enterVrSession`). It must:
  1. Give the Exile Treat Injury rank 10 through the skill data (not a menu) and set `PartyManager.ChemicalCount = 100`.
  2. Run the real 101PER Lab Station's OnUsed script (`k_medstation`) through the placeable, play the help conversation choosing "[Use the Lab Station now.]", and assert `MenuChemicals` is open after the conversation ends.
  3. Select the Medpac row and press Accept: chemicals 100 → 80, one more Medpac in the inventory.
  4. Switch to breakdown, select the Medpac, press Accept: chemicals 80 → 90 (yield floor(20 x 10 x 5%) = 10), one fewer Medpac.
  5. Read `VRSpike.panelHost` placement and save a PNG of its render target to `evidence/lab-station-panel.png`; assert the menu is the foreground menu while presenting, and that the VR pointer can reach its controls: query pointer targets the way `vr:check` does for other panels (`src/vr/runtime/GUIListBoxVRPointerTargets.ts`, `LegacyGUIVRPointerAdapter`) and assert the four tab buttons, `BTN_Accept`, `BTN_Examine` and at least one `LB_SHOPITEMS` row are targetable.
  5b. Clear the list selection and press Accept: chemicals and inventory unchanged.
  6. Close the menu, save to a scratch slot, reload, assert `ChemicalCount === 90`.
  Print a JSON summary; exit non-zero on any failed assertion.

- [ ] **Step 5: Run the probe**

Run: `node tools/vr-emulator/probe-lab-station.js`
Expected: summary with every check `true`; inspect the PNG: all four tabs, both lists and the buttons inside the panel.

- [ ] **Step 6: Full verification**

Run: `npx jest --silent -w 2` then `npm run vr:check`
Expected: all suites pass; vr:check passes (close any headset Chrome on 9422 first).

- [ ] **Step 7: Update `ROADMAP.md` 7.7** to "◑ lab station built, emulator-verified; awaiting headset" with the probe name, and note the workbench follow-up (MenuComponent reuses `CraftingRules` with `itemcreate.2da`, 0.05, Repair).

- [ ] **Step 8: Commit**

```bash
git add src/game/tsl/menu/MenuChemicals.ts src/nwscript/NWScriptDefK2.ts tools/vr-emulator/probe-lab-station.js ROADMAP.md
git commit -m "feat(crafting): lab station screen and ShowChemicalUpgradeScreen"
```
