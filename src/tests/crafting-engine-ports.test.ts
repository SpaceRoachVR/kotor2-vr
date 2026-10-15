import { beforeEach, describe, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({
  GameState: {
    PartyManager: { ChemicalCount: 0, ComponentCount: 0, party: [] as unknown[], Player: undefined as unknown },
    InventoryManager: { addItem: jest.fn(), getNonQuestInventory: jest.fn(() => []), removeItem: jest.fn() },
    TwoDAManager: { datatables: new Map() },
    ModuleObjectManager: undefined as unknown,
  },
}));

jest.mock('@/loaders', () => ({
  ResourceLoader: { loadResource: jest.fn() },
}));

jest.mock('@/resource/GFFObject', () => ({
  GFFObject: class {
    fields: Record<string, unknown> = { Tag: 'g_i_parts01' };
    RootNode = {
      hasField: (label: string) => label in this.fields,
      getFieldByLabel: (label: string) => ({
        getValue: () => this.fields[label],
        setValue: (v: unknown) => { this.fields[label] = v; },
      }),
    };
    getFieldByLabel(label: string) { return this.RootNode.getFieldByLabel(label); }
    constructor(public source?: unknown) {}
  },
}));

import { GameState } from '@/GameState';
import { ResourceLoader } from '@/loaders';
import { CraftingEnginePorts, resolveMainCharacter } from '@/game/tsl/crafting/CraftingEnginePorts';
import { LAB_STATION, WORKBENCH_STATION } from '@/game/tsl/crafting/CraftingRules';
import { SkillType } from '@/enums/nwscript/SkillType';

const creature = (name: string, isPlayer: boolean, ranks: Record<number, number> = {}) =>
  ({ name, isPlayer, getSkillTotal: (skill: number) => ranks[skill] ?? 0 }) as any;

const kreia = creature('kreia', false, { [SkillType.REPAIR]: 2, [SkillType.TREAT_INJURY]: 3 });
const exile = creature('exile', true, { [SkillType.REPAIR]: 7 });
const t3 = creature('t3', false);
const t3NotPlayer = creature('t3-record', false);

const party = GameState.PartyManager as any;

beforeEach(() => {
  party.ChemicalCount = 5;
  party.ComponentCount = 9;
  party.party = [];
  party.Player = undefined;
  jest.clearAllMocks();
});

describe('resolveMainCharacter', () => {
  test('main character is the party member flagged isPlayer', () => {
    expect(resolveMainCharacter([kreia, exile], kreia, kreia)).toBe(exile);
  });
  test('a companion leading with the Exile following at a later party index still resolves to the Exile', () => {
    expect(resolveMainCharacter([kreia, exile], kreia, kreia)).toBe(exile);
    party.party = [kreia, exile];
    party.Player = kreia;
    const bench = new CraftingEnginePorts(WORKBENCH_STATION);
    bench.setUser(kreia);
    expect(bench.ports().breakdownRank()).toBe(7);
  });
  test('falls back to the player record when no party member is flagged; with the Exile not loaded at all, it intentionally falls back to the user', () => {
    expect(resolveMainCharacter([kreia], exile, kreia)).toBe(exile);
    expect(resolveMainCharacter([t3], t3NotPlayer, t3)).toBe(t3);
  });
});

describe('CraftingEnginePorts', () => {
  test('currency follows the station', () => {
    expect(new CraftingEnginePorts(WORKBENCH_STATION).ports().getCurrency()).toBe(9);
    expect(new CraftingEnginePorts(LAB_STATION).ports().getCurrency()).toBe(5);
    new CraftingEnginePorts(WORKBENCH_STATION).ports().setCurrency(-3);
    expect(GameState.PartyManager.ComponentCount).toBe(0);
    new CraftingEnginePorts(LAB_STATION).ports().setCurrency(12);
    expect(GameState.PartyManager.ChemicalCount).toBe(12);
    expect(GameState.PartyManager.ComponentCount).toBe(0);
  });

  test('breakdown rank is the user\'s at the lab and the main character\'s at the workbench', () => {
    party.party = [kreia, exile];
    party.Player = exile;
    const lab = new CraftingEnginePorts(LAB_STATION);
    lab.setUser(kreia);
    expect(lab.ports().breakdownRank()).toBe(3);
    const bench = new CraftingEnginePorts(WORKBENCH_STATION);
    bench.setUser(kreia);
    expect(bench.ports().breakdownRank()).toBe(7);
    expect(bench.ports().skillRank(SkillType.REPAIR)).toBe(2);
  });

  test('createItem sets the override tag on the template before adding it', async () => {
    (ResourceLoader.loadResource as jest.Mock<any>).mockResolvedValue(new Uint8Array([1]));
    let tagAtAdd: unknown;
    (GameState.InventoryManager.addItem as jest.Mock<any>).mockImplementation((gff: any) => {
      tagAtAdd = gff.getFieldByLabel('Tag').getValue();
      return {};
    });
    const ports = new CraftingEnginePorts(WORKBENCH_STATION).ports();
    expect(await ports.createItem('g_i_parts01', 'K_REPAIR_PART')).toBe(true);
    expect(tagAtAdd).toBe('K_REPAIR_PART');
    expect((GameState.InventoryManager.addItem as jest.Mock).mock.calls[0][1]).toBe(true);
    expect(await ports.createItem('g_i_parts01')).toBe(true);
    expect(tagAtAdd).toBe('g_i_parts01');
  });

  test('createItem resolves false on any failure', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (ResourceLoader.loadResource as jest.Mock<any>).mockRejectedValue(new Error('boom'));
    const ports = new CraftingEnginePorts(LAB_STATION).ports();
    expect(await ports.createItem('nope')).toBe(false);
    (ResourceLoader.loadResource as jest.Mock<any>).mockResolvedValue(undefined);
    expect(await ports.createItem('nope')).toBe(false);
    warn.mockRestore();
  });

  test('toCraftingItem reads plot and storePanelSort from the engine item and keeps identity', () => {
    const moduleItem = {
      plot: true,
      cost: 120,
      baseItem: { storePanelSort: 45 },
      getTemplateResRef: () => 'G_W_BLSTRPSTL01',
      getName: () => 'Blaster Pistol',
      getStackSize: () => 2,
    } as any;
    const adapter = new CraftingEnginePorts(WORKBENCH_STATION);
    const entry = adapter.toCraftingItem(moduleItem);
    expect(entry).toMatchObject({
      resref: 'g_w_blstrpstl01', name: 'Blaster Pistol', cost: 120, stackSize: 2, plot: true, storePanelSort: 45,
    });
    expect(entry.moduleItem).toBe(moduleItem);
    expect(adapter.toCraftingItem(moduleItem)).toBe(entry);
    expect(adapter.toCraftingItem({ ...moduleItem, baseItem: undefined }).storePanelSort).toBe(0);
  });
});
