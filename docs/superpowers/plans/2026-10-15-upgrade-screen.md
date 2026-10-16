# Item Upgrade Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TSL's Upgrade Workbench work for ranged weapons, melee weapons and armor: install and remove upgrade parts whose bonuses apply live, persist in saves, and work in VR.

**Architecture:** Pure slot/fit rules in `UpgradeRules.ts`; `ModuleItem` gains live upgrade properties (own properties + installed parts' properties, from `UpgradeSlotN` rows into `upgrade.2da`) used by every stat reader; a GUI-free `UpgradeSession` stages and commits slot changes against the bag; `MenuUpgradeSelect` and `MenuUpgrade` bind the retail GUIs; routine 354 routes to them.

**Tech Stack:** TypeScript, Jest (`@jest/globals`), webpack, the vr-emulator harness (Node + CDP).

**Spec:** `docs/superpowers/specs/2026-10-15-upgrade-screen-design.md`

Repository: `C:\Users\allen\source\repos\kotor2-vr`, branch `spike/stereo-perf`. Git index is LF; do not rewrite line endings of existing files.

## Global Constraints

- `UpgradeSlot0..5` are INT fields holding a row index into `upgrade.2da` (-1 = empty); the item's own `PropertiesList` is never modified by upgrading.
- `upgrade.2da` columns `label`, `template`, `upgradetype`; rows whose template has no UTI are never offered and contribute no properties.
- Slot types: ranged `[4, 6, 5]` (Targeting, Firing Chamber, Power Pack), melee `[7, 8, 9]` (Grip, Edge, Energy Cell), armor `[10, 11]` (Overlay, Underlay).
- Slot minimum item level: 4→1, 6→2, 5→3, 7→1, 8→1, 9→2, 10→1, 11→1.
- A part fits a slot when its `upgradetype` equals the slot type and the item's `UpgradeLevel >= part.UpgradeLevel`.
- Category from `baseitems.2da` `storepanelsort`: ranged 40, 45; melee 20, 25; armor 4, 5, 10, 15; anything else (incl. 30 lightsabers) is not upgradeable this pass.
- Upgradeable items: category known and `UpgradeLevel >= 1`.
- Installed parts' properties are always usable (no K1 `Upgrades` bitmask gate).
- Parts are never lost: taking from and returning to the bag happen together on Assemble or not at all.
- The Lab Station and Workbench crafting screens and their probes keep working.

## Review Focus

- Replacing an installed part: the old part returns to the bag and the new one leaves it, in one Assemble.
- A part's last unit staged, then used up elsewhere before Assemble (e.g. a stack of 1 staged in two slots): Assemble refuses with no change.
- Upgrading an item equipped on a companion: the companion's stats change immediately, without re-equipping.
- Saving and loading an item whose slot names a row with no template: loads, contributes nothing, logs once, no crash.
- Back with staged but uncommitted changes: nothing taken from or returned to the bag, slots unchanged.

---

### Task 1: Upgrade rules

**Files:**
- Create: `src/game/tsl/crafting/UpgradeRules.ts`
- Test: `src/tests/upgrade-rules.test.ts`

**Interfaces:**
- Produces:
  - `type ItemCategory = 'ranged' | 'melee' | 'armor'`
  - `interface UpgradeRow { row: number; template: string; type: number; }`
  - `categoryFor(storePanelSort: number): ItemCategory | undefined`
  - `slotTypes(category: ItemCategory): number[]`
  - `slotMinLevel(type: number): number` (unknown type → `Infinity`)
  - `isSlotOpen(itemLevel: number, type: number): boolean`
  - `fits(part: { type: number; level: number }, slotType: number, itemLevel: number): boolean`
  - `parseUpgradeTable(rows: Record<string, Record<string, string>>): UpgradeRow[]` — row index from the object key, `template` trimmed and lower-cased, rows with empty/`****` template or non-numeric type dropped
  - `rowForTemplate(table: UpgradeRow[], resref: string): UpgradeRow | undefined` (case-insensitive)
  - `upgradeTypeName(type: number): string` — `Targeting`, `Firing Chamber`, `Power Pack`, `Grip`, `Edge`, `Energy Cell`, `Overlay`, `Underlay`

- [ ] **Step 1: Write the failing tests**

```ts
test('categories from storepanelsort', () => {
  expect([40, 45].map(categoryFor)).toEqual(['ranged', 'ranged']);
  expect([20, 25].map(categoryFor)).toEqual(['melee', 'melee']);
  expect([4, 5, 10, 15].map(categoryFor)).toEqual(['armor', 'armor', 'armor', 'armor']);
  expect([30, 50, 0].map(categoryFor)).toEqual([undefined, undefined, undefined]);
});
test('slot layout per category', () => {
  expect(slotTypes('ranged')).toEqual([4, 6, 5]);
  expect(slotTypes('melee')).toEqual([7, 8, 9]);
  expect(slotTypes('armor')).toEqual([10, 11]);
});
test('slots open by item level', () => {
  expect([4, 6, 5].map(t => isSlotOpen(1, t))).toEqual([true, false, false]);
  expect([4, 6, 5].map(t => isSlotOpen(2, t))).toEqual([true, true, false]);
  expect([4, 6, 5].map(t => isSlotOpen(3, t))).toEqual([true, true, true]);
  expect([7, 8, 9].map(t => isSlotOpen(1, t))).toEqual([true, true, false]);
  expect(isSlotOpen(0, 4)).toBe(false);
});
test('a part fits by type and level', () => {
  expect(fits({ type: 4, level: 1 }, 4, 1)).toBe(true);    // scope into a level-1 blaster
  expect(fits({ type: 5, level: 3 }, 5, 2)).toBe(false);   // power pack into a level-2 blaster
  expect(fits({ type: 11, level: 2 }, 11, 1)).toBe(false); // level-2 underlay into level-1 armor
  expect(fits({ type: 4, level: 1 }, 6, 3)).toBe(false);   // wrong slot type
});
test('parses upgrade.2da', () => {
  const t = parseUpgradeTable({
    0: { label: 'Rubat_crystal', template: 'u_l_crys_02', upgradetype: '0' },
    16: { label: 'Scope', template: 'G_I_UPGRADE001', upgradetype: '4' },
    17: { label: 'x', template: '****', upgradetype: '5' },
  });
  expect(t).toEqual([{ row: 0, template: 'u_l_crys_02', type: 0 }, { row: 16, template: 'g_i_upgrade001', type: 4 }]);
  expect(rowForTemplate(t, 'G_I_UPGRADE001')?.row).toBe(16);
});
```

- [ ] **Step 2: Run to verify they fail** — `npx jest src/tests/upgrade-rules.test.ts`; Expected: FAIL, module not found.

- [ ] **Step 3: Implement** the Interfaces in `UpgradeRules.ts` (pure; header comment citing the spec's sources).

- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/tsl/crafting/UpgradeRules.ts src/tests/upgrade-rules.test.ts
git commit -m "feat(upgrades): weapon and armor upgrade rules"
```

### Task 2: Live upgrade properties on items

**Files:**
- Modify: `src/module/ModuleItem.ts`
- Modify (switch stat reads to effective properties): `src/combat/CombatAttackData.ts` (~326), `src/GameState.ts` (~1024, ~1070), `src/nwscript/NWScriptDefK2.ts` (~2900), `src/game/tsl/menu/MenuInventory.ts` (~124)
- Test: `src/tests/item-upgrade-properties.test.ts`

**Interfaces:**
- Consumes: `parseUpgradeTable`, `UpgradeRow` (Task 1).
- Produces (on `ModuleItem`):
  - `getUpgradeLevel(): number` (`upgradeLevel`, 0 when unset)
  - `getUpgradeSlot(index: number): number` and `setUpgradeSlot(index: number, row: number): void` — updates `upgradeSlotN` and creates/updates the template's INT field `UpgradeSlotN` so `save()` writes it; invalidates the upgrade-property cache
  - `getUpgradeProperties(): ItemProperty[]` — properties of the part templates named by slots with row >= 0, via `upgrade.2da` (`GameState.TwoDAManager.datatables.get('upgrade')`) and the UTI template; cached per slot state; a row with no template or no loadable UTI contributes nothing and logs once per row
  - `getEffectiveProperties(): ItemProperty[]` — `[...properties, ...getUpgradeProperties()]`; upgrade properties report `isUseable() === true`

Template loading: use the engine's synchronous cached loader for UTIs (`ResourceLoader.loadCachedResource(ResourceTypes['uti'], resref)`, as `PartyManager.AddAvailableNPCByTemplate` does for UTCs). If that returns nothing for a valid template in the running game, add `async preloadUpgradeTemplates(): Promise<void>` and call it from item load and `setUpgradeSlot`; report which was needed.

Every loop over `this.properties` in `ModuleItem` that computes a stat (attack, damage, AC, saves, skills, abilities, immunities, descriptions, `isUpgradable`) uses `getEffectiveProperties()`; external readers listed under Files likewise. Readers that inspect the item's own template for other purposes (mines, unlocking, cast-spell validation) are unchanged.

- [ ] **Step 1: Write the failing tests** (build a `ModuleItem` from a GFF with `PropertiesList` the way existing item tests in `src/tests/` do; stub `upgrade.2da` and the cached UTI loader):

```ts
test('an installed part adds its properties', () => {
  // blaster with one own property; upgrade row 16 -> 'g_i_upgrade001' whose UTI has one property (PropertyName 38)
  item.setUpgradeSlot(0, 16);
  expect(item.getEffectiveProperties().map(p => p.propertyName)).toEqual([own.propertyName, 38]);
  expect(item.getUpgradeProperties().every(p => p.isUseable())).toBe(true);
});
test('removing the part drops its properties', () => {
  item.setUpgradeSlot(0, 16); item.setUpgradeSlot(0, -1);
  expect(item.getUpgradeProperties()).toEqual([]);
});
test('save writes the slot', () => {
  item.setUpgradeSlot(1, 16);
  expect(item.save().getFieldByLabel('UpgradeSlot1').getValue()).toBe(16);
});
test('a row with no template contributes nothing', () => {
  item.setUpgradeSlot(0, 999);
  expect(item.getUpgradeProperties()).toEqual([]);
});
test('a stat getter counts the part', () => {
  // pick one ModuleItem stat getter that reads properties (e.g. the attack-bonus getter) and assert it rises by the part's value
});
```

The last test names a concrete getter and value once the implementer has read the property loops; it must assert a numeric rise.

- [ ] **Step 2: Run to verify they fail** — `npx jest src/tests/item-upgrade-properties.test.ts`; Expected: FAIL.

- [ ] **Step 3: Implement** the Interfaces and switch the stat readers.

- [ ] **Step 4: Verify** — `npx jest src/tests/item-upgrade-properties.test.ts`, then the full suite through PowerShell (`npx jest --silent -w 2`; rerun asset-heavy suites alone if they time out); Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/module/ModuleItem.ts src/combat/CombatAttackData.ts src/GameState.ts src/nwscript/NWScriptDefK2.ts src/game/tsl/menu/MenuInventory.ts src/tests/item-upgrade-properties.test.ts
git commit -m "feat(upgrades): installed upgrade parts apply their properties live"
```

### Task 3: Upgrade session (stage, assemble, cancel)

**Files:**
- Create: `src/game/tsl/crafting/UpgradeSession.ts`
- Test: `src/tests/upgrade-session.test.ts`

**Interfaces:**
- Consumes: `slotTypes`, `isSlotOpen`, `fits`, `UpgradeRow`, `ItemCategory` (Task 1); the item methods of Task 2 (through a port).
- Produces:
  - `interface UpgradeItemPort { category: ItemCategory; level: number; getSlot(i: number): number; setSlot(i: number, row: number): void; }`
  - `interface UpgradePart { resref: string; row: number; type: number; level: number; name: string; }`
  - `interface UpgradeBagPorts { parts(): { part: UpgradePart; count: number }[]; takeOne(resref: string): boolean; returnOne(resref: string): boolean; }`
  - `interface SlotView { index: number; type: number; open: boolean; installed?: UpgradePart; staged?: UpgradePart | null; }` (`staged === null` = staged removal)
  - `class UpgradeSession { constructor(item: UpgradeItemPort, bag: UpgradeBagPorts, table: UpgradeRow[], partFor: (row: number) => UpgradePart | undefined); slots(): SlotView[]; candidates(slotIndex: number): UpgradePart[]; stage(slotIndex: number, part: UpgradePart | null): boolean; hasChanges(): boolean; assemble(): boolean; cancel(): void; }`
  - `candidates` = bag parts that `fits` the slot, minus units already staged elsewhere; `stage` refuses closed slots and non-fitting parts; `assemble` takes every staged part, returns every replaced/removed part, then calls `setSlot`; if any take fails it returns what it took and changes nothing (returns false); `cancel` clears staging.

- [ ] **Step 1: Write the failing tests** with an in-memory item port (level 3 ranged) and bag:

```ts
test('install takes one part from a stack', () => {
  // bag: scope x2 (row 16, type 4, level 1)
  expect(session.stage(0, scope)).toBe(true);
  expect(session.assemble()).toBe(true);
  expect(item.getSlot(0)).toBe(16);
  expect(bagCount('g_i_upgrade001')).toBe(1);
});
test('replace returns the old part in the same assemble', () => {
  // slot 0 holds scope (row 16); bag has scope2 (row 40, type 4)
  session.stage(0, scope2); session.assemble();
  expect(item.getSlot(0)).toBe(40);
  expect(bagCount(scope.resref)).toBe(1);
  expect(bagCount(scope2.resref)).toBe(0);
});
test('remove returns the part', () => {
  session.stage(0, null); session.assemble();
  expect(item.getSlot(0)).toBe(-1);
  expect(bagCount(scope.resref)).toBe(1);
});
test('closed slot and wrong type are refused', () => {
  // level-1 blaster: slot 2 (power pack) closed
  expect(levelOne.stage(2, powerPack)).toBe(false);
  expect(session.stage(1, scope)).toBe(false); // slot 1 is firing chamber
});
test('a last unit cannot be staged twice', () => {
  // bag: one firing chamber; level-3 blaster
  expect(session.candidates(1)).toContain(chamber);
  session.stage(1, chamber);
  expect(session.candidates(1).filter(p => p === chamber).length).toBe(0); // its only unit is staged
});
test('assemble refuses atomically when a take fails', () => {
  // bag.takeOne fails for the second staged part
  expect(session.assemble()).toBe(false);
  expect([item.getSlot(0), item.getSlot(1)]).toEqual([-1, -1]);
  expect(bagCounts()).toEqual(before);
});
test('cancel leaves everything unchanged', () => {
  session.stage(0, scope); session.cancel();
  expect(session.hasChanges()).toBe(false);
  expect(item.getSlot(0)).toBe(-1);
  expect(bagCounts()).toEqual(before);
});
```

- [ ] **Step 2: Run to verify they fail** — `npx jest src/tests/upgrade-session.test.ts`; Expected: FAIL, module not found.

- [ ] **Step 3: Implement `UpgradeSession`.**

- [ ] **Step 4: Run to verify they pass** — same command; Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/tsl/crafting/UpgradeSession.ts src/tests/upgrade-session.test.ts
git commit -m "feat(upgrades): stage, assemble and cancel upgrade slots"
```

### Task 4: Screens, routine 354, probe

**Files:**
- Modify: `src/game/tsl/menu/MenuUpgradeSelect.ts` (`upgradesel_p`), `src/game/tsl/menu/MenuUpgrade.ts` (`upgrade_p`)
- Create: `src/game/tsl/crafting/UpgradeEnginePorts.ts` (engine adapters for `UpgradeItemPort` / `UpgradeBagPorts` / `partFor`)
- Modify: `src/nwscript/NWScriptDefK2.ts` (routine 354), `src/managers/MenuManager.ts` (only if the TSL upgrade menus are not registered)
- Create: `tools/vr-emulator/probe-upgrade.js`
- Modify: `ROADMAP.md` (7.7)

**Interfaces:**
- Consumes: Tasks 1–3; `MenuComponent.openFor(user?, recipeTable?)`; `CutsceneManager.runAfterConversation`; `CraftingMenuBase` list behaviour (publishing, `keepScroll`, pointer selection) where it applies.
- Produces: `MenuUpgradeSelect.openFor(user?: ModuleCreature, options?: { recipeTable?: string; allowCreate?: boolean }): Promise<void>`; `MenuUpgrade.openFor(item: ModuleItem, wearer?: ModuleCreature): Promise<void>`.

Behaviour (spec, "Screens"):
- Select screen: tabs `BTN_ALL/RANGED/MELEE/ARMOR`, `BTN_LIGHTSABER` disabled; `LB_UPGRADELIST` = upgradeable items from `InventoryManager.getNonQuestInventory()` plus items equipped on `PartyManager.party` members (row text adds the wearer's name for equipped items); `LB_DESCRIPTION` = selected item's description including installed parts; `BTN_UPGRADEITEMS` → `MenuUpgrade.openFor(item, wearer)`; `BTN_CREATEITEMS` text "Create Items" → `MenuComponent.openFor(user, recipeTable)`, hidden when `allowCreate` is false; `BTN_BACK` closes.
- Slot screen: `LBL_TITLE` = item name; `BTN_UPGRADE31..33` / `LBL_UPGRADE31..33` for the item's slots (label = `upgradeTypeName` + installed/staged part name or "Empty"), closed slots greyed and unselectable, unused slot controls hidden, `_LS` and `3D_MODEL*` controls hidden; selecting a slot fills `LB_ITEMS` with `candidates` (plus a "Remove" row when the slot holds or stages a part); highlighting a row fills `LB_DESC` / `LBL_PROPERTY`; choosing stages it; `BTN_ASSEMBLE` → `assemble()` then refresh; `BTN_BACK` / `BTN_OK` with uncommitted changes → `cancel()` and close back to the select screen.
- Routine 354 (through `runAfterConversation`): `nDisableUpgrade` → `MenuComponent.openFor(user, table)` (unchanged); valid upgradeable `oItem` → `MenuUpgrade.openFor(oItem)`; otherwise `MenuUpgradeSelect.openFor(user, { recipeTable: table, allowCreate: !nDisableItemCreation })`. Remove the "not available yet" notice.

- [ ] **Step 1: Implement `UpgradeEnginePorts`, the two screens and routine 354.**

- [ ] **Step 2: Typecheck and build** — `npx tsc --noEmit -p . 2>&1 | grep "error TS" | grep -E "Upgrade|NWScriptDefK2|crafting"` then `npm run webpack:dev`; Expected: no grep output; webpack exits 0.

- [ ] **Step 3: Write `tools/vr-emulator/probe-upgrade.js`**, modelled on `tools/vr-emulator/probe-workbench.js` (boot, isolated temp save copy removed in `finally`, 103PER via `loadModule`, the placed bench `plc_workb_rep` / `workbnch.dlg`, pointer/stick/PNG helpers). Checks:
  1. The "[Use the workbench to upgrade items.]" reply opens `MenuUpgradeSelect`; no notice shown.
  2. Give the bag `w_blaste_09` (Republic Blaster, level 3), `w_brifle_01` (Blaster Carbine, level 0), `u_r_targ_01` x2, one armor template with `UpgradeLevel >= 1` (the Jedi Robe `a_robe_08` is level 0 — find a suitable armor in the install and name it in the report) and an underlay whose `UpgradeLevel` is <= that armor's. The Ranged tab lists the Republic Blaster and not the Carbine; the Armor tab lists that armor and not `a_robe_08`.
  3. Open the blaster: 3 slots, all open; Carbine-like level-1 item (any level-1 ranged template) shows slots 2–3 greyed.
  4. Stage `u_r_targ_01` in slot 0, Back: nothing changed. Stage again, Assemble: `UpgradeSlot0` = the scope's row; one scope left in the bag.
  5. Equip the blaster on the Exile: the attack bonus reported by the combat code rises by the scope's bonus versus before installing (compute both live).
  6. Equip it on a companion instead: the companion's bonus includes the scope without re-equipping after a further Assemble.
  7. Remove the scope: it returns to the bag; the bonus drops back.
  8. Armor: install an underlay into the chosen armor; Assemble; slot 1 holds it.
  9. Create Items opens `MenuComponent`; the forced-`oItem` route (run 354 with the blaster as `oItem`) opens `MenuUpgrade` for it.
  10. Save, reload: the blaster's `UpgradeSlot0` persists and the bonus still applies.
  11. Pointer reaches tabs, list rows, slot buttons and Assemble; the right stick scrolls `LB_UPGRADELIST` with enough items to overflow.
  12. PNGs of both screens to `evidence/upgrade-select.png` and `evidence/upgrade-slots.png`.
  Print a JSON summary; exit non-zero on any failed check.

- [ ] **Step 4: Run the probes** — `node tools/vr-emulator/probe-upgrade.js`, `node tools/vr-emulator/probe-workbench.js`, `node tools/vr-emulator/probe-lab-station.js`; Expected: all checks pass; both new PNGs show every control inside the panel.

- [ ] **Step 5: Full verification** — full Jest through PowerShell; `npm run vr:check` (own asset server on a spare port with `--url` if 8479 is taken; the known `weapon-bash-route` failure and any failure present on the base commit are acceptable — report them); Expected: everything else passes.

- [ ] **Step 6: Update `ROADMAP.md` 7.7**: weapon/armor upgrades built and emulator-verified (probe name and checks), awaiting headset; lightsaber upgrades are the remaining pass.

- [ ] **Step 7: Commit**

```bash
git add src/game/tsl/menu/MenuUpgradeSelect.ts src/game/tsl/menu/MenuUpgrade.ts src/game/tsl/crafting/UpgradeEnginePorts.ts src/nwscript/NWScriptDefK2.ts tools/vr-emulator/probe-upgrade.js ROADMAP.md
git add src/managers/MenuManager.ts 2>/dev/null || true
git commit -m "feat(upgrades): upgrade workbench screens and ShowUpgradeScreen routing"
```
