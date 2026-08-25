import fs from 'fs';
import path from 'path';
import { describe, expect, test } from '@jest/globals';

/**
 * TSL menus that drop click handlers their K1 parent registers.
 *
 * TSL menus call `super.menuControlInitializer(true)`. The `true` makes the K1
 * parent return *before* registering any of its listeners, so the subclass
 * inherits control binding but not behaviour, and then re-registers only some
 * of them. Anything it forgets is a control that exists, renders, and does
 * nothing — with a mouse as much as with a VR ray.
 *
 * A headset session surfaced this: `MenuJournal.BTN_EXIT` was declared and
 * never wired, so the journal could not be closed from its own Exit button and
 * the 2D UI stayed up over the world.
 *
 * This is a structural audit rather than a behavioural one. It cannot tell
 * whether a dropped handler matters, only that TSL diverges from K1 — so the
 * accepted list below is a ledger of known divergences, not a list of bugs.
 * Fixing one means removing it from the list; a *new* divergence fails here.
 */
const K1_MENU_DIR = path.join(__dirname, '..', 'game', 'kotor', 'menu');
const TSL_MENU_DIR = path.join(__dirname, '..', 'game', 'tsl', 'menu');

function registeredListeners(source: string): Set<string> {
  return new Set(
    Array.from(source.matchAll(/this\.([A-Z][A-Z0-9_]+)\.addEventListener\(/g)).map((m) => m[1])
  );
}

function skipsParentRegistration(source: string): boolean {
  return /super\.menuControlInitializer\(\s*true\s*\)/.test(source);
}

function collectDroppedHandlers(): Map<string, readonly string[]> {
  const dropped = new Map<string, readonly string[]>();
  for (const file of fs.readdirSync(TSL_MENU_DIR).sort()) {
    if (!file.endsWith('.ts')) continue;
    const k1Path = path.join(K1_MENU_DIR, file);
    if (!fs.existsSync(k1Path)) continue;
    const tsl = fs.readFileSync(path.join(TSL_MENU_DIR, file), 'utf8');
    if (!skipsParentRegistration(tsl)) continue;
    const k1 = fs.readFileSync(k1Path, 'utf8');
    const missing = [...registeredListeners(k1)]
      .filter((control) => !registeredListeners(tsl).has(control))
      .sort();
    if (missing.length) dropped.set(file.replace(/\.ts$/, ''), missing);
  }
  return dropped;
}

/**
 * Known divergences, as of the 2026-08-22 headset session. Several are
 * player-visible: the Pazaak table is entirely unwired, character generation
 * cannot go back or accept, the upgrade screens cannot go back, and saves
 * cannot be deleted.
 */
const ACCEPTED_DROPPED_HANDLERS: Readonly<Record<string, readonly string[]>> = {
  CharGenCustomPanel: ['BTN_BACK', 'BTN_STEPNAME1', 'BTN_STEPNAME2', 'BTN_STEPNAME3', 'BTN_STEPNAME4', 'BTN_STEPNAME5', 'BTN_STEPNAME6'],
  CharGenSkills: ['BTN_ACCEPT', 'BTN_BACK', 'BTN_RECOMMENDED'],
  InGameOverlay: ['BTN_MINIMAP'],
  MenuEquipment: ['BTN_CHANGE1', 'BTN_CHANGE2'],
  MenuInventory: ['BTN_CHANGE1', 'BTN_CHANGE2'],
  MenuJournal: ['BTN_SORT', 'BTN_SWAPTEXT'],
  MenuMap: ['BTN_PRTYSLCT'],
  MenuMessages: ['BTN_SHOW'],
  MenuPazaakGame: ['BTN_FLIP0', 'BTN_FLIP1', 'BTN_FLIP2', 'BTN_FLIP3', 'BTN_PLRSIDE0', 'BTN_PLRSIDE1', 'BTN_PLRSIDE2', 'BTN_PLRSIDE3', 'BTN_XTEXT', 'BTN_YTEXT'],
  MenuPazaakSetup: ['BTN_ATEXT', 'BTN_YTEXT'],
  MenuSaveLoad: ['BTN_DELETE'],
  MenuUpgrade: ['BTN_BACK'],
  MenuUpgradeItems: ['BTN_BACK', 'BTN_UPGRADEITEM'],
  MenuUpgradeSelect: ['BTN_ARMOR', 'BTN_BACK', 'BTN_LIGHTSABER', 'BTN_MELEE', 'BTN_RANGED', 'BTN_UPGRADEITEMS'],
};

describe('TSL menus vs their K1 parents', () => {
  test('no menu drops a handler that is not already a known divergence', () => {
    const dropped = collectDroppedHandlers();
    const unexpected: string[] = [];

    for (const [menu, controls] of dropped) {
      const accepted = ACCEPTED_DROPPED_HANDLERS[menu] ?? [];
      for (const control of controls) {
        if (!accepted.includes(control)) unexpected.push(`${menu}.${control}`);
      }
    }

    expect(unexpected).toEqual([]);
  });

  test('the ledger does not list divergences that have since been fixed', () => {
    // Keeps the list honest: a handler that gets wired must leave the ledger,
    // so the count reflects real outstanding work rather than history.
    const dropped = collectDroppedHandlers();
    const stale: string[] = [];

    for (const [menu, controls] of Object.entries(ACCEPTED_DROPPED_HANDLERS)) {
      const actual = dropped.get(menu) ?? [];
      for (const control of controls) {
        if (!actual.includes(control)) stale.push(`${menu}.${control}`);
      }
    }

    expect(stale).toEqual([]);
  });

  test('the two controls that trapped the player in a menu are wired', () => {
    // MenuJournal.BTN_EXIT could not close the journal, and
    // MenuContainer.BTN_GIVEITEMS could not switch take/give. Both were
    // reported from a headset session as "2D UI stays up".
    const journal = fs.readFileSync(path.join(TSL_MENU_DIR, 'MenuJournal.ts'), 'utf8');
    const container = fs.readFileSync(path.join(TSL_MENU_DIR, 'MenuContainer.ts'), 'utf8');

    expect(registeredListeners(journal).has('BTN_EXIT')).toBe(true);
    expect(registeredListeners(container).has('BTN_GIVEITEMS')).toBe(true);
  });

  test('container give mode transfers one selected item without closing the menu', () => {
    const container = fs.readFileSync(path.join(TSL_MENU_DIR, 'MenuContainer.ts'), 'utf8');

    expect(container).toContain('const selectedItem = this.selectedItem;');
    expect(container).toContain('if(this.mode == MenuContainerMode.TAKE_ITEMS)');
    expect(container).toContain('GameState.InventoryManager.removeItem(selectedItem, 1);');
    expect(container).toContain('const transferredItem = selectedItem.clone();');
    expect(container).toContain('transferredItem.setStackSize(1);');
    expect(container).toContain('this.container.addItem(transferredItem);');
    expect(container).toContain('this.LB_ITEMS.removeItemByNode(selectedItem);');
  });
});

describe('TSL menu method-name typos', () => {
  test('no menu calls a capitalised model loader that does not exist', () => {
    // `MenuPartySelection` called `this.char.LoadModel()`; ModuleCreature only
    // defines `loadModel`. It threw on every party-selection portrait build as
    // an uncaught promise rejection, leaving the character with no model —
    // reported from a headset session as an invisible player.
    const offenders: string[] = [];
    for (const dir of [K1_MENU_DIR, TSL_MENU_DIR]) {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.ts')) continue;
        const source = fs.readFileSync(path.join(dir, file), 'utf8');
        for (const line of source.split('\n')) {
          if (line.trim().startsWith('//')) continue;
          if (/\.LoadModel\s*\(/.test(line)) offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
