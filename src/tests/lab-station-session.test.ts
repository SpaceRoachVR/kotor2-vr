import { describe, expect, test } from '@jest/globals';
import { LAB_STATION, parseRecipes } from '@/game/tsl/crafting/CraftingRules';
import { LabStationSession, CraftingItem, LabStationPorts } from '@/game/tsl/crafting/LabStationSession';
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
  return { resref, name: resref, cost, stackSize };
}

function makeFake(opts: { chemicals: number; ranks?: Record<number, number>; inventory?: CraftingItem[]; createResult?: boolean }) {
  let chemicals = opts.chemicals;
  const created: string[] = [];
  const inventory = opts.inventory ?? [];
  const ports: LabStationPorts = {
    getChemicals: () => chemicals,
    setChemicals: (n) => { chemicals = n; },
    skillRank: (skill) => opts.ranks?.[skill] ?? 0,
    createItem: async (resref) => {
      if (opts.createResult === false) return false;
      created.push(resref);
      return true;
    },
    inventory: () => inventory,
    removeOne: (it) => {
      it.stackSize -= 1;
      if (it.stackSize <= 0) inventory.splice(inventory.indexOf(it), 1);
    },
    templateCost: (resref) => TEMPLATE_COSTS[resref.toLowerCase()],
  };
  return { ports, created, inventory };
}

describe('LabStationSession', () => {
  test('create spends exactly the value and adds the item', async () => {
    const { ports, created } = makeFake({ chemicals: 20, ranks: { [SkillType.TREAT_INJURY]: 1 } });
    const session = new LabStationSession(recipes, ports);
    expect(await session.create(medpac)).toBe(true);
    expect(ports.getChemicals()).toBe(0);
    expect(created).toEqual(['g_i_medeqpmnt01']);
  });
  test('create one chemical short changes nothing', async () => {
    const { ports, created } = makeFake({ chemicals: 19, ranks: { [SkillType.TREAT_INJURY]: 1 } });
    const session = new LabStationSession(recipes, ports);
    expect(await session.create(medpac)).toBe(false);
    expect(ports.getChemicals()).toBe(19);
    expect(created).toEqual([]);
  });
  test('a failed item creation refunds the chemicals', async () => {
    const { ports } = makeFake({ chemicals: 20, ranks: { [SkillType.TREAT_INJURY]: 1 }, createResult: false });
    const session = new LabStationSession(recipes, ports);
    expect(await session.create(medpac)).toBe(false);
    expect(ports.getChemicals()).toBe(20);
  });
  test('recipeViews skips recipes with no template and counts carried items case-insensitively', () => {
    const { ports } = makeFake({
      chemicals: 20,
      ranks: { [SkillType.TREAT_INJURY]: 1 },
      inventory: [item('G_I_MEDEQPMNT01', 40, 3)],
    });
    const session = new LabStationSession(recipes, ports);
    const views = session.recipeViews('health');
    expect(views.map(v => v.recipe.resref)).toEqual(['g_i_medeqpmnt01']);
    expect(views[0]).toMatchObject({ value: 20, creatable: true, carried: 3 });
  });
  test('breaking one of a stack of three removes one and adds the yield once', () => {
    const stack = item('g_i_medeqpmnt01', 40, 3);
    const { ports } = makeFake({ chemicals: 0, ranks: { [SkillType.TREAT_INJURY]: 10 }, inventory: [stack] });
    const session = new LabStationSession(recipes, ports);
    expect(session.breakdown(stack)).toBe(true);
    expect(stack.stackSize).toBe(2);
    expect(ports.getChemicals()).toBe(10);
  });
  test('breaking the last one removes the entry; breaking it again does nothing', () => {
    const single = item('g_i_medeqpmnt01', 40, 1);
    const { ports } = makeFake({ chemicals: 0, ranks: { [SkillType.TREAT_INJURY]: 10 }, inventory: [single] });
    const session = new LabStationSession(recipes, ports);
    expect(session.breakdown(single)).toBe(true);
    expect(session.breakableItems()).not.toContain(single);
    expect(session.breakdown(single)).toBe(false);
    expect(ports.getChemicals()).toBe(10);
  });
  test('unbreakable items are not listed and cannot be broken', () => {
    const blaster = item('w_blaste_01', 100, 1);
    const { ports } = makeFake({ chemicals: 0, ranks: { [SkillType.TREAT_INJURY]: 10 }, inventory: [blaster, item('g_i_medeqpmnt01', 40, 1)] });
    const session = new LabStationSession(recipes, ports);
    expect(session.breakableItems().map(i => i.resref)).not.toContain('w_blaste_01');
    expect(session.breakdown(blaster)).toBe(false);
    expect(ports.getChemicals()).toBe(0);
  });
  test('the user rank decides, not the leader', () => {
    // The stim's value is floor(100 * 0.5) = 50; chemicals are plentiful so only rank can decide.
    const high = makeFake({ chemicals: 100, ranks: { [SkillType.TREAT_INJURY]: 23 } });
    expect(new LabStationSession(recipes, high.ports).recipeViews('stims')[0].creatable).toBe(true);
    const low = makeFake({ chemicals: 100, ranks: { [SkillType.TREAT_INJURY]: 22 } });
    expect(new LabStationSession(recipes, low.ports).recipeViews('stims')[0].creatable).toBe(false);
  });
});
