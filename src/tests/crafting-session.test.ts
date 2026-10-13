import { describe, expect, test } from '@jest/globals';
import { LAB_STATION, WORKBENCH_STATION, parseRecipes } from '@/game/tsl/crafting/CraftingRules';
import { CraftingSession, CraftingItem, CraftingPorts } from '@/game/tsl/crafting/CraftingSession';
import { SkillType } from '@/enums/nwscript/SkillType';

const rows = {
  0: { label: 'g_i_medeqpmnt01', skilllevel: '1', group: '0', base_skill: '7' },
  1: { label: 'g_i_cmbtshot002', skilllevel: '23', group: '1', base_skill: '7' },
  2: { label: 'g_i_nomodel', skilllevel: '1', group: '0', base_skill: '7' },
};
const recipes = parseRecipes(rows, LAB_STATION);
const medpac = recipes[0];
const TEMPLATE_COSTS: Record<string, number> = { g_i_medeqpmnt01: 40, g_i_cmbtshot002: 100 };

function item(resref: string, cost: number, stackSize = 1): CraftingItem {
  return { resref, name: resref, cost, stackSize, plot: false, storePanelSort: 0 };
}

function makeFake(opts: { chemicals: number; ranks?: Record<number, number>; breakdownRank?: number; inventory?: CraftingItem[]; createResult?: boolean }) {
  let chemicals = opts.chemicals;
  const created: string[] = [];
  const createdCalls: Array<[string, string | undefined]> = [];
  const inventory = opts.inventory ?? [];
  const ports: CraftingPorts = {
    getCurrency: () => chemicals,
    setCurrency: (n) => { chemicals = n; },
    skillRank: (skill) => opts.ranks?.[skill] ?? 0,
    breakdownRank: () => opts.breakdownRank ?? opts.ranks?.[SkillType.TREAT_INJURY] ?? 0,
    createItem: async (resref, overrideTag) => {
      if (opts.createResult === false) return false;
      created.push(resref);
      createdCalls.push([resref, overrideTag]);
      return true;
    },
    inventory: () => inventory,
    removeOne: (it) => {
      it.stackSize -= 1;
      if (it.stackSize <= 0) inventory.splice(inventory.indexOf(it), 1);
    },
    templateCost: (resref) => TEMPLATE_COSTS[resref.toLowerCase()],
  };
  return { ports, created, createdCalls, inventory };
}

describe('CraftingSession', () => {
  test('create spends exactly the value and adds the item', async () => {
    const { ports, created } = makeFake({ chemicals: 20, ranks: { [SkillType.TREAT_INJURY]: 1 } });
    const session = new CraftingSession(recipes, ports, LAB_STATION);
    expect(await session.create(medpac)).toBe(true);
    expect(ports.getCurrency()).toBe(0);
    expect(created).toEqual(['g_i_medeqpmnt01']);
  });
  test('create one chemical short changes nothing', async () => {
    const { ports, created } = makeFake({ chemicals: 19, ranks: { [SkillType.TREAT_INJURY]: 1 } });
    const session = new CraftingSession(recipes, ports, LAB_STATION);
    expect(await session.create(medpac)).toBe(false);
    expect(ports.getCurrency()).toBe(19);
    expect(created).toEqual([]);
  });
  test('a failed item creation refunds the chemicals', async () => {
    const { ports } = makeFake({ chemicals: 20, ranks: { [SkillType.TREAT_INJURY]: 1 }, createResult: false });
    const session = new CraftingSession(recipes, ports, LAB_STATION);
    expect(await session.create(medpac)).toBe(false);
    expect(ports.getCurrency()).toBe(20);
  });
  test('recipeViews skips recipes with no template and counts carried items case-insensitively', () => {
    const { ports } = makeFake({
      chemicals: 20,
      ranks: { [SkillType.TREAT_INJURY]: 1 },
      inventory: [item('G_I_MEDEQPMNT01', 40, 3)],
    });
    const session = new CraftingSession(recipes, ports, LAB_STATION);
    const views = session.recipeViews('health');
    expect(views.map(v => v.recipe.resref)).toEqual(['g_i_medeqpmnt01']);
    expect(views[0]).toMatchObject({ value: 20, creatable: true, carried: 3 });
  });
  test('breaking one of a stack of three removes one and adds the yield once', () => {
    const stack = item('g_i_medeqpmnt01', 40, 3);
    const { ports } = makeFake({ chemicals: 0, ranks: { [SkillType.TREAT_INJURY]: 10 }, inventory: [stack] });
    const session = new CraftingSession(recipes, ports, LAB_STATION);
    expect(session.breakdown(stack)).toBe(true);
    expect(stack.stackSize).toBe(2);
    expect(ports.getCurrency()).toBe(10);
  });
  test('breaking the last one removes the entry; breaking it again does nothing', () => {
    const single = item('g_i_medeqpmnt01', 40, 1);
    const { ports } = makeFake({ chemicals: 0, ranks: { [SkillType.TREAT_INJURY]: 10 }, inventory: [single] });
    const session = new CraftingSession(recipes, ports, LAB_STATION);
    expect(session.breakdown(single)).toBe(true);
    expect(session.breakableItems()).not.toContain(single);
    expect(session.breakdown(single)).toBe(false);
    expect(ports.getCurrency()).toBe(10);
  });
  test('unbreakable items are not listed and cannot be broken', () => {
    const blaster = item('w_blaste_01', 100, 1);
    const { ports } = makeFake({ chemicals: 0, ranks: { [SkillType.TREAT_INJURY]: 10 }, inventory: [blaster, item('g_i_medeqpmnt01', 40, 1)] });
    const session = new CraftingSession(recipes, ports, LAB_STATION);
    expect(session.breakableItems().map(i => i.resref)).not.toContain('w_blaste_01');
    expect(session.breakdown(blaster)).toBe(false);
    expect(ports.getCurrency()).toBe(0);
  });
  test('the user rank decides, not the leader', () => {
    // The stim's value is floor(100 * 0.5) = 50; chemicals are plentiful so only rank can decide.
    const high = makeFake({ chemicals: 100, ranks: { [SkillType.TREAT_INJURY]: 23 } });
    expect(new CraftingSession(recipes, high.ports, LAB_STATION).recipeViews('stims')[0].creatable).toBe(true);
    const low = makeFake({ chemicals: 100, ranks: { [SkillType.TREAT_INJURY]: 22 } });
    expect(new CraftingSession(recipes, low.ports, LAB_STATION).recipeViews('stims')[0].creatable).toBe(false);
  });

  describe('workbench', () => {
    const wbRows = {
      0: { label: 'g_i_parts01', skilllevel: '1', group: '4', base_skill: '5', overridetag: 'K_REPAIR_PART' },
    };
    const wbRecipes = parseRecipes(wbRows, WORKBENCH_STATION);
    const labResrefs = new Set(['g_i_medeqpmnt01']);
    const wbItem = (resref: string, cost: number, storePanelSort: number, plot = false): CraftingItem =>
      ({ resref, name: resref, cost, stackSize: 1, plot, storePanelSort });

    test('workbench breakdown uses breakdownRank, not the user skill', () => {
      const blaster = wbItem('w_blaste_01', 400, 40);
      const { ports } = makeFake({ chemicals: 0, ranks: { [SkillType.REPAIR]: 0 }, breakdownRank: 20, inventory: [blaster] });
      const session = new CraftingSession(wbRecipes, ports, WORKBENCH_STATION, labResrefs);
      expect(session.breakdown(blaster)).toBe(true);
      expect(ports.getCurrency()).toBe(20);
    });
    test('workbench breakdown lists non-plot, non-lab items and filters by tab', () => {
      const inventory = [
        wbItem('w_blaste_01', 400, 40),
        wbItem('a_robe_08', 100, 5),
        wbItem('g_i_medeqpmnt01', 40, 1),
        wbItem('g_i_datapad01', 10, 80, true),
      ];
      const { ports } = makeFake({ chemicals: 0, inventory });
      const session = new CraftingSession(wbRecipes, ports, WORKBENCH_STATION, labResrefs);
      expect(session.breakableItems().map(i => i.resref)).toEqual(['w_blaste_01', 'a_robe_08']);
      expect(session.breakableItems('weapons').map(i => i.resref)).toEqual(['w_blaste_01']);
      expect(session.breakableItems('armor').map(i => i.resref)).toEqual(['a_robe_08']);
      expect(session.breakableItems('useable')).toEqual([]);
    });
    test('create passes the recipe override tag', async () => {
      const part = wbRecipes[0];
      const { ports, createdCalls } = makeFake({ chemicals: 10, ranks: { [SkillType.REPAIR]: 1 } });
      const costs: Record<string, number> = { ...TEMPLATE_COSTS, g_i_parts01: 200 };
      ports.templateCost = (resref) => costs[resref.toLowerCase()];
      const session = new CraftingSession(wbRecipes, ports, WORKBENCH_STATION, labResrefs);
      expect(await session.create(part)).toBe(true);
      expect(createdCalls).toEqual([['g_i_parts01', 'K_REPAIR_PART']]);
      expect(ports.getCurrency()).toBe(0);
    });
  });
});
