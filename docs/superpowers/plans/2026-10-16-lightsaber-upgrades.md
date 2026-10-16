# Lightsaber Upgrades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lightsabers on TSL's Upgrade Workbench: power crystals, lens, emitter and cell in six slots, a colour-crystal swap that changes the blade, and a 3D hilt preview, usable in VR.

**Architecture:** Extend the merged weapon/armor upgrade stack. Pure rules (`UpgradeRules`, new `ColourCrystals`, new `ItemUseLimits`) carry the data decisions; `UpgradeSession` gains a colour slot that is staged like the others but never emptied; `UpgradeEnginePorts` binds colour to `ModuleItem.modelVariation` and re-equips; `MenuUpgrade` switches to upgrade_p's `_LS` layout and renders the saber in `3D_MODEL_LS` through `LBL_3DView`.

**Tech Stack:** TypeScript, Jest, three.js (via the engine's `OdysseyModel3D` / `LBL_3DView`), the Playwright/CDP emulator harness in `tools/vr-emulator`.

**Spec:** `docs/superpowers/specs/2026-10-15-lightsaber-upgrades-design.md`

## Global Constraints

- Work in a worktree off `spike/stereo-perf` (`../kotor2-vr-lightsaber`, branch `claude/lightsaber-upgrades`, `node_modules` junction to the main checkout). Never edit the main checkout; never kill processes you did not start; use spare ports.
- No retail asset is modified.
- Git index is LF. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Base items: 8 long, 9 double, 10 short. Other `storepanelsort` 30 items stay excluded.
- Lightsaber slot index = `UpgradeSlotN`: 0 crystal (type 0), 1 colour, 2 crystal (type 0), 3 lens (type 1), 4 emitter (type 2), 5 energy cell (type 3). `UpgradeSlot1` is never written (retail keeps -1).
- Colour rows: only `upcrystals.2da` rows whose `template` starts with `u_l_colo_` (lower-cased); columns `shortmdlvar`, `longmdlvar`, `doublemdlvar` hold saber template resrefs.
- `_LS` controls: left column `31_LS, 32_LS, 33_LS` = slots 0, 1, 2 top to bottom; right column `34_LS, 35_LS, 36_LS` = slots 3, 4, 5.
- Run Jest through PowerShell: `npx jest --silent -w 2`. Known baseline failures: `vr-spike-xr-loop` (4), `kotor-vr-mcp` (1 when 9422 is held).

## Review Focus

1. A saber in a stack (two identical sabers): a colour swap must change one unit only — test in Task 4 (`splitOffRest` runs before the variation changes).
2. Swapping the colour of an **equipped** saber must not leave a duplicate saber in the bag or an empty hand — test in Task 4 and probe check 6.
3. Staging the same colour the saber already has is a no-op, not a crystal-for-crystal trade — test in Task 3.
4. A saber with installed parts and no colour change: Assemble must not touch `modelVariation` or re-equip — test in Task 3 (`colour.set` not called).
5. Closing the screen with a staged colour leaves the blade and bag unchanged, and the preview is disposed — test in Task 3 (cancel) and probe check 8.

---

### Task 1: Lightsaber rules and colour table

**Files:**
- Modify: `src/game/tsl/crafting/UpgradeRules.ts`
- Create: `src/game/tsl/crafting/ColourCrystals.ts`
- Test: `src/tests/upgrade-rules.test.ts`, create `src/tests/colour-crystals.test.ts`

**Interfaces:**
- Produces:
  - `ItemCategory = 'ranged' | 'melee' | 'armor' | 'lightsaber'`
  - `COLOUR_SLOT = -1` (exported const; the colour slot's type)
  - `categoryFor(storePanelSort: number, baseItem?: number): ItemCategory | undefined` — base 8/9/10 → `'lightsaber'` regardless of sort; otherwise as today (30 → undefined)
  - `type SaberKind = 'long' | 'short' | 'double'`; `saberKindFor(baseItem: number): SaberKind | undefined`
  - `slotTypes('lightsaber')` → `[0, COLOUR_SLOT, 0, 1, 2, 3]`
  - `slotMinLevel`: types 0, 1, 2, 3 → 1; `COLOUR_SLOT` → 1
  - `upgradeTypeName`: 0 `Crystal`, 1 `Lens`, 2 `Emitter`, 3 `Energy Cell`, `COLOUR_SLOT` `Colour Crystal`
  - `ColourCrystals.ts`: `interface ColourRow { crystal: string; templates: Record<SaberKind, string> }`, `parseColourTable(rows: Record<string, Record<string,string>>): ColourRow[]`, `isColourCrystal(table, resref): boolean`, `modelVariationFor(table, crystal, kind, variationOf: (template: string) => number | undefined): number | undefined`, `colourCrystalFor(table, kind, modelVariation, variationOf): string | undefined` (first row in table order)

- [ ] **Step 1: Write the failing tests**

`upgrade-rules.test.ts` adds: `categoryFor(30, 8)`, `(30, 9)`, `(30, 10)` → `'lightsaber'`; `categoryFor(30, 4)` and `categoryFor(30)` → `undefined`; `categoryFor(40)` still `'ranged'`; `saberKindFor(8/10/9)` → long/short/double, `saberKindFor(11)` → undefined; `slotTypes('lightsaber')` equals `[0, -1, 0, 1, 2, 3]`; `isSlotOpen(3, t)` true for each lightsaber slot type, `isSlotOpen(0, 0)` false; `upgradeTypeName(COLOUR_SLOT)` === `'Colour Crystal'`.

`colour-crystals.test.ts` uses the spec's 14-row table as a fixture (rows 0-13, mixed-case resrefs as retail) and a `variationOf` fake mapping long templates `g_w_lghtsbr01..05 → 1,4,3,5,2`, `07 → 11`, `08 → 7`, `09 → 10`, `10 → 8`, `11 → 9`, short `g_w_shortsbr08 → 6`, others undefined. Assertions: parsed crystals are rows 0-4, 7-13 (12 rows, no `g1_w_sbrcrstl20/21`), all lower-cased; `isColourCrystal(t, 'U_L_COLO_04')` true, `('u_l_crys_02')` false; `modelVariationFor(t, 'u_l_colo_08', 'long', v)` → 7, `'short'` → 6; `modelVariationFor(t, 'u_l_colo_x01', 'long', v)` → undefined (template missing from fake); `colourCrystalFor(t, 'long', 2, v)` → `'u_l_colo_04'`; `colourCrystalFor(t, 'long', 6, v)` → undefined.

- [ ] **Step 2: Run to verify they fail** — `npx jest src/tests/upgrade-rules.test.ts src/tests/colour-crystals.test.ts` → FAIL (module/exports missing).
- [ ] **Step 3: Implement** the Interfaces above. Existing callers of `categoryFor(sort)` keep working (second arg optional).
- [ ] **Step 4: Run to verify they pass** — same command → PASS.
- [ ] **Step 5: Commit** — `feat(upgrades): lightsaber category, slot layout and colour-crystal table`.

### Task 2: Use limits from installed parts

**Files:**
- Create: `src/engine/rules/ItemUseLimits.ts`
- Modify: `src/managers/InventoryManager.ts` (`isItemUsableBy`, ~114)
- Test: create `src/tests/item-use-limits.test.ts`

**Interfaces:**
- Ruling: the engine has no use-limit check today; `InventoryManager.isItemUsableBy` (the equipment screen's filter) is where it goes, not `ModuleItem` as the spec words it. Script equips stay unchecked, as retail scripts expect.
- Produces: `meetsUseLimits(limits: { property: number; subType: number }[], wielder: { goodEvil: number }): boolean`.
  - Only property 43 (`UseLimitationAlignmentGroup`, `iprp_aligngrp.2da`) is enforced: subtypes 0 All, 1 Neutral, 2 Light Side, 3 Dark Side, 4 100% Dark, 5 100% Light.
  - Wielder group uses the engine's `GetAlignmentGoodEvil` thresholds: goodEvil < 25 dark, < 75 neutral, else light; 100% Dark = goodEvil 0, 100% Light = 100.
  - No 43 properties → true. Otherwise true when **any** 43 property matches (the "any match within a limitation type passes" rule; Solari/Qixoni plus a Name crystal).
- `isItemUsableBy(item, creature)` additionally requires `meetsUseLimits` over `item.getEffectiveProperties()` (property id via the ItemProperty's property-name field and subtype field) with `creature.getGoodEvil()`. A missing creature or `getEffectiveProperties` keeps today's result.

- [ ] **Step 1: Write the failing tests** — `meetsUseLimits([], {goodEvil: 50})` true; `[{43,2}]` with 80 true, 50 false; `[{43,3}]` with 10 true; Name-crystal-dark `[{43,3},{43,1}]` with 50 true, 80 false; Name-crystal-dark plus Solari `[{43,3},{43,1},{43,2}]` with 80 true; `[{43,5}]` with 99 false, 100 true; `[{43,4}]` with 0 true; `[{43,0}]` any true; non-43 entries ignored (`[{45,2}]` true). One `isItemUsableBy` test with a fake item whose `getEffectiveProperties()` returns a 43/2 property and whose `baseItem.droidOrHuman` is 0: goodEvil 80 → true, 20 → false.
- [ ] **Step 2: Run to verify they fail** — `npx jest src/tests/item-use-limits.test.ts` → FAIL.
- [ ] **Step 3: Implement** `meetsUseLimits` and the `isItemUsableBy` call.
- [ ] **Step 4: Run** the new test plus `item-upgrade-properties`, `upgrade-session` → PASS.
- [ ] **Step 5: Commit** — `feat(items): alignment use limits from an item's effective properties`.

### Task 3: Colour slot in the session

**Files:**
- Modify: `src/game/tsl/crafting/UpgradeSession.ts`
- Test: `src/tests/upgrade-session.test.ts`

**Interfaces:**
- Consumes: `COLOUR_SLOT`, `slotTypes('lightsaber')` (Task 1).
- Produces:
  - `UpgradeItemPort.colour?: ColourPort` where `interface ColourPort { current(): UpgradePart | undefined; accepts(resref: string): boolean; set(resref: string): boolean }`. Colour crystals are `UpgradePart`s with `row: -1`, `type: COLOUR_SLOT`, `level: 0`.
  - `UpgradeBagPorts.colourCrystals?(): { part: UpgradePart; count: number }[]`.
  - Colour slot behaviour (slot whose type is `COLOUR_SLOT`):
    - `slots()`: `installed` = `colour.current()`; never reads `getSlot(1)`.
    - `candidates(i)`: `colourCrystals()` that `colour.accepts`, not the current crystal, with free units (bag count minus staged units).
    - `stage(i, null)` → false (cannot be emptied). `stage(i, part)` → false unless `accepts`; staging the current crystal clears staging and returns true.
    - `assemble()`: the staged crystal is taken with `takeOne`; the current crystal (if known) is returned with `returnOne`; then `colour.set(staged.resref)` runs **before** any `setSlot`; if `set` returns false every take/return is undone and assemble returns false. `setSlot` is never called for the colour slot. With no staged colour, `colour.set` is not called.

- [ ] **Step 1: Write the failing tests** (fakes as in the existing session tests, item category `'lightsaber'`, a `colour` fake recording `set` calls, bag with `u_l_colo_04` x1 and `u_l_colo_01` current):
  - `colour slot shows the current crystal and cannot be removed` — slot 1 `installed.resref === 'u_l_colo_01'`, `stage(1, null) === false`.
  - `colour candidates exclude the current crystal and crystals the saber rejects`.
  - `swap takes one crystal, returns the old, sets the colour` — after assemble: bag `u_l_colo_04` 0, `u_l_colo_01` 1, `set` called once with `'u_l_colo_04'`, `setSlot` never called with index 1.
  - `unknown current colour returns nothing` — `current()` undefined; assemble takes the crystal, `returnOne` not called.
  - `a failed set rolls the bag back` — `set` returns false → assemble false, bag counts unchanged.
  - `staging the current crystal is a no-op` — `hasChanges()` false.
  - `parts without a colour change do not call set` — stage a crystal in slot 0, assemble, `set` not called.
  - `cancel discards a staged colour`.
- [ ] **Step 2: Run** `npx jest src/tests/upgrade-session.test.ts` → new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → all PASS (old tests unchanged).
- [ ] **Step 5: Commit** — `feat(upgrades): colour-crystal slot in the upgrade session`.

### Task 4: Engine binding for sabers

**Files:**
- Modify: `src/module/ModuleItem.ts`, `src/game/tsl/crafting/UpgradeEnginePorts.ts`
- Test: create `src/tests/lightsaber-engine-ports.test.ts` (pattern: `crafting-engine-ports.test.ts` / `upgrade-stack-split.test.ts`)

**Interfaces:**
- Consumes: Tasks 1 and 3.
- Produces:
  - `ModuleItem.setModelVariation(n: number): void` (sets `modelVariation`; `save()` already writes it).
  - `ModuleItem.modelResRefFor(variation: number): string` — the model resref `loadModel` would load for that variation (extract `loadModel`'s naming into it; `loadModel` uses it).
  - `UpgradeEnginePorts.categoryOf` passes `item.baseItem` id as `categoryFor`'s second argument.
  - `UpgradeEnginePorts.colourTable(): ColourRow[]` (parsed once per loaded `upcrystals` table object, from `GameState.TwoDAManager.datatables.get('upcrystals')`).
  - `UpgradeEnginePorts.variationOf(template: string): number | undefined` — `ModelVariation` of the cached UTI (`ResourceLoader.loadCachedResource`), cached; undefined when not cached.
  - `itemPort(item)` for a lightsaber adds `colour`: `current()` from `colourCrystalFor(kind, item.getModelVariation())`; `accepts(r)` = `modelVariationFor` defined; `set(r)`: `splitOffRest(item)`, `item.setModelVariation(v)`, then if `wearerOf(item)` re-equip in the same slot (`unequipSlot(slot, false)` then `equipItem(slot, item)`), returning false on any throw after restoring the old variation.
  - `bag().colourCrystals()` — party-inventory items whose resref `isColourCrystal`, counted like `parts()`.

- [ ] **Step 1: Write the failing tests** (fake GameState/ResourceLoader as the existing port tests do):
  - `categoryOf a long saber is lightsaber`; `a pike (storepanelsort 30, base 4) is not upgradeable`.
  - `current colour of a variation-2 long saber is u_l_colo_04`.
  - `set changes the variation of one unit of a stacked saber` — stack of 2; after `set('u_l_colo_01')` the item has variation 1 and stack 1, the inventory holds another unit with variation 2.
  - `set on an equipped saber re-equips it once and leaves no copy in the bag` — fake wearer records `unequipSlot`/`equipItem`; inventory length unchanged.
  - `save writes the new ModelVariation` — `setModelVariation(4)`; `save()` struct field `ModelVariation` === 4.
  - `modelResRefFor(2)` on a base-8 item === `'w_lghtsbr_002'`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the new test plus `upgrade-stack-split`, `item-upgrade-properties`, `crafting-engine-ports` → PASS.
- [ ] **Step 5: Commit** — `feat(upgrades): bind lightsaber colour to model variation and re-equip`.

### Task 5: Lightsaber screens

**Files:**
- Modify: `src/game/tsl/menu/MenuUpgradeSelect.ts`, `src/game/tsl/menu/MenuUpgrade.ts`
- Test: extend the select/upgrade menu tests if they exist (`grep -l MenuUpgrade src/tests`); otherwise covered by Task 7's probe.

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces:
  - `MenuUpgradeSelect`: `UpgradeTab` gains `'lightsaber'`; `BTN_LIGHTSABER` is enabled and in `tabButtons()`; the old greyed/inert code is removed.
  - `MenuUpgrade.layout: 'standard' | 'lightsaber'`, set in `openFor` from the port's category. `slotControls()` returns the three standard pairs or the six `_LS` pairs (order per Global Constraints). `hiddenControls()` hides the other layout's controls and `3D_MODEL`; `3D_MODEL_LS` is shown only in the lightsaber layout. Slot buttons 31_LS..36_LS get click listeners selecting slots 0-5.
  - `fitItemList` in the lightsaber layout cuts `LB_ITEMS` to end `LIST_GAP` above the topmost `_LS` button it overlaps, or leaves it unchanged when none overlaps (check against the GUI extents at run time).
  - Colour slot rows: the colour candidates, no Remove row. `LBL_SLOTNAME` reads `Colour Crystal: <name>` or `Colour Crystal: Unknown` when `installed` is undefined. Slot labels stay type-only.
  - Standard items keep today's behaviour exactly.

- [ ] **Step 1:** Write or extend tests for `slotControls()` mapping and the colour-slot rows (no `remove` row) if a menu test harness exists; if none exists, note it in the report and rely on Task 7.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** `npm run webpack:dev` in the worktree builds; `probe-upgrade.js` (weapon/armor) still passes.
- [ ] **Step 4: Commit** — `feat(upgrades): lightsaber tab and six-slot upgrade layout`.

### Task 6: 3D hilt preview

**Files:**
- Modify: `src/game/tsl/menu/MenuUpgrade.ts`
- Create: `src/game/tsl/menu/upgradePreviewFraming.ts`
- Test: create `src/tests/upgrade-preview-framing.test.ts`

**Interfaces:**
- Consumes: `ModuleItem.modelResRefFor` (Task 4), `UpgradeEnginePorts.variationOf`/`modelVariationFor` (Tasks 1, 4).
- Produces:
  - `previewCameraDistance(size: {x,y,z}, fovDeg: number, aspect: number, margin = 1.15): number` — distance at which the box's largest extent along the view's vertical/horizontal fits the frustum times `margin`.
  - `MenuUpgrade.previewVariation(): number` — staged colour's variation, else the item's.
  - `MenuUpgrade` builds an `LBL_3DView` on `3D_MODEL_LS` the way `MenuCharacter` does for `LBL_3DCHAR` (fill material map = the view's texture, `setControl`), loads `modelResRefFor(previewVariation())` with `MDLLoader` + `OdysseyModel3D.FromMDL`, centres it on its bounding box, places the camera at `previewCameraDistance` looking at the centre, and turns the model 0.6 rad/s about its long axis in `update(delta)`, calling the view's `render(delta)`. The model reloads when the previewed variation changes (after `choose` and `assemble`), discarding a load that finishes after a newer one started. On close: the model is removed and disposed, the view disposed. A failed load logs once and leaves the control empty.

- [ ] **Step 1: Write the failing test** — a unit cube at fov 30, aspect 168/228 gives a distance > 0 that grows linearly with size (×2 size → ×2 distance) and with margin; a long thin box (0.1, 0.1, 1.2) fits its 1.2 extent.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npm run webpack:dev` builds.
- [ ] **Step 5: Commit** — `feat(upgrades): 3D lightsaber preview on the upgrade screen`.

### Task 7: Emulator probe, docs

**Files:**
- Create: `tools/vr-emulator/probe-lightsaber.js` (pattern and CLI of `probe-upgrade.js`; own asset-server port when 8479 is busy)
- Modify: `ROADMAP.md` (7.7: lightsabers done, Keen/Skill/Regeneration still open)

Checks (each a named `check(...)`, PNGs into the probe's evidence dir), on the SpaceRoach Peragus save copied read-only into a temp dir, at the 103PER bench through `workbnch.dlg`'s upgrade reply:
1. `1_tabLists` — granted `g_w_lghtsbr01` (variation 1) shows on the Lightsaber tab, and in All.
2. `2_layout` — the six `_LS` buttons visible, standard three and `3D_MODEL` hidden, `3D_MODEL_LS` visible.
3. `3_parts` — install `u_l_crys_02` (slot 0), `u_l_crys_16` (slot 2), `u_l_lens_01`, `u_l_emit_01`, `u_l_cell_02`; equip; the wielder's attack bonus and damage bonus equal the pre-install values plus the parts' sums from `getEffectiveProperties`.
4. `4_colourRows` — the colour slot lists `u_l_colo_04`, no Remove row; `LBL_SLOTNAME` reads `Colour Crystal: ` + the blue crystal's name.
5. `5_previewRecolours` — staging red changes `previewVariation()` to 2 and the preview's loaded model to `w_lghtsbr_002`; PNG before and after.
6. `6_swap` — Assemble: `u_l_colo_01` in the bag, `u_l_colo_04` gone, `getModelVariation() === 2`, the equipped saber's model `w_lghtsbr_002`, no extra saber in the bag, the hand still holds it.
7. `7_saveReload` — save, reload: variation 2 and slots 0, 2-5 persist, `UpgradeSlot1` is -1, bonuses still apply.
8. `8_cancelAndClose` — stage blue, Back: variation still 2, bag unchanged, preview disposed (no `LBL_3DView` render after close).
9. `9_reach` — pointer reach on all six `_LS` buttons and stick scrolling of `LB_ITEMS`.

- [ ] **Step 1:** Write the probe; run it; all checks pass.
- [ ] **Step 2:** Run `probe-upgrade.js`, `probe-workbench.js`, `probe-lab-station.js` — pass.
- [ ] **Step 3:** Full Jest (`npx jest --silent -w 2`) — only the known baseline failures; `npm run vr:check` green.
- [ ] **Step 4:** ROADMAP update.
- [ ] **Step 5: Commit** — `test(upgrades): lightsaber emulator probe; roadmap` (docs with `git add -f`).
