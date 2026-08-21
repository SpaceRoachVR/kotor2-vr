import { expect, jest, test } from '@jest/globals';
import {
  buildVRActionWheel,
  createVRActionSourceKey,
  VRActionMenuEntry,
  VRActionWheelBuildContext,
  VRActionWheelEngineAction,
  VRActionWheelPartyMember,
} from '@/vr/runtime/VRActionWheelModelBuilder';
import {
  VRRadialActionItem,
  VRRadialContentItem,
  VRRadialMenuDefinition,
  VRRadialSubmenuItem,
} from '@/vr/runtime/VRRadialMenuModel';

function engineAction(
  id: string,
  label: string,
  overrides: Partial<VRActionWheelEngineAction> = {},
): VRActionWheelEngineAction {
  return {
    id,
    label,
    revalidate: () => true,
    activate: jest.fn(),
    ...overrides,
  };
}

function partyMember(
  id: string,
  label: string,
  overrides: Partial<VRActionWheelPartyMember> = {},
): VRActionWheelPartyMember {
  return {
    id,
    label,
    resolveCurrentIndex: () => 1,
    switchLeader: jest.fn(),
    ...overrides,
  };
}

function context(overrides: Partial<VRActionWheelBuildContext> = {}): VRActionWheelBuildContext {
  return {
    id: 'action-wheel',
    targetActions: [],
    selfActions: [],
    canLevelUp: false,
    partyMembers: [],
    openInventory: jest.fn(),
    openCharacter: jest.fn(),
    openMap: jest.fn(),
    openComfortSettings: jest.fn(),
    ...overrides,
  };
}

function contentItems(menu: VRRadialMenuDefinition): readonly VRRadialContentItem[] {
  return menu.pages.flatMap((page) => page.entries).filter(
    (entry): entry is VRRadialContentItem => entry.kind === 'action' || entry.kind === 'submenu',
  );
}

function contentIds(menu: VRRadialMenuDefinition): readonly string[] {
  return contentItems(menu).map((item) => item.id);
}

function findAction(menu: VRRadialMenuDefinition, id: string): VRRadialActionItem {
  const item = contentItems(menu).find((candidate) => candidate.id === id);
  if (!item || item.kind !== 'action') throw new Error(`Missing action ${id}`);
  return item;
}

function findSubmenu(menu: VRRadialMenuDefinition, id: string): VRRadialSubmenuItem {
  const item = contentItems(menu).find((candidate) => candidate.id === id);
  if (!item || item.kind !== 'submenu') throw new Error(`Missing submenu ${id}`);
  return item;
}

test('orders combat, self, menus, conditional level-up, party, and comfort settings', () => {
  const menu = buildVRActionWheel(context({
    targetActions: [engineAction('attack', 'Attack')],
    selfActions: [engineAction('force-lightning', 'Force Lightning')],
    canLevelUp: true,
    partyMembers: [partyMember('kreia', 'Kreia')],
  }));

  expect(contentIds(menu)).toEqual([
    'engine:attack',
    'engine:force-lightning',
    'menu:inventory',
    'menu:character',
    'menu:map',
    'menu:level-up',
    'submenu:party',
    'menu:comfort-settings',
  ]);
  expect(contentIds(menu)).not.toContain('menu:galaxy-map');
});

test('omits malformed engine descriptors without losing valid actions', () => {
  const malformed = [
    engineAction('', 'Missing ID'),
    engineAction('missing-label', '  '),
    { id: 'missing-revalidate', label: 'Broken', activate: jest.fn() },
    { id: 'missing-activate', label: 'Broken', revalidate: () => true },
    { id: 'invalid-icon', label: 'Broken', icon: 42, revalidate: () => true, activate: jest.fn() },
    null,
  ] as unknown as readonly VRActionWheelEngineAction[];

  const menu = buildVRActionWheel(context({
    targetActions: [engineAction('attack', 'Attack'), ...malformed],
  }));

  expect(contentIds(menu).filter((id) => id.startsWith('engine:'))).toEqual(['engine:attack']);
});

test('deduplicates engine actions by trimmed stable ID while preserving first-seen order', () => {
  const menu = buildVRActionWheel(context({
    targetActions: [
      engineAction('attack', 'First Attack'),
      engineAction(' attack ', 'Duplicate Attack'),
    ],
    selfActions: [
      engineAction('attack', 'Self Duplicate'),
      engineAction('heal', 'Heal'),
    ],
  }));

  expect(contentIds(menu).filter((id) => id.startsWith('engine:'))).toEqual([
    'engine:attack',
    'engine:heal',
  ]);
  expect(findAction(menu, 'engine:attack').label).toBe('First Attack');
});

test('static actions invoke only their bound local routes', () => {
  const openInventory = jest.fn();
  const openCharacter = jest.fn();
  const openMap = jest.fn();
  const openComfortSettings = jest.fn();
  const menu = buildVRActionWheel(context({
    openInventory,
    openCharacter,
    openMap,
    openComfortSettings,
  }));

  findAction(menu, 'menu:inventory').activate();
  findAction(menu, 'menu:character').activate();
  findAction(menu, 'menu:map').activate();
  findAction(menu, 'menu:comfort-settings').activate();

  expect(openInventory).toHaveBeenCalledTimes(1);
  expect(openCharacter).toHaveBeenCalledTimes(1);
  expect(openMap).toHaveBeenCalledTimes(1);
  expect(openComfortSettings).toHaveBeenCalledTimes(1);
});

test('Level-Up opens Character and never creates a route when leveling is unavailable', () => {
  const openCharacter = jest.fn();
  const eligibleMenu = buildVRActionWheel(context({ canLevelUp: true, openCharacter }));

  findAction(eligibleMenu, 'menu:level-up').activate();

  expect(openCharacter).toHaveBeenCalledTimes(1);
  expect(contentIds(buildVRActionWheel(context({ canLevelUp: false })))).not.toContain('menu:level-up');
});

test('party re-resolves the live index before switching', () => {
  const switchLeader = jest.fn();
  const resolveCurrentIndex = jest.fn(() => 2);
  const member = partyMember('atton', 'Atton', { resolveCurrentIndex, switchLeader });
  const partyMenu = findSubmenu(
    buildVRActionWheel(context({ partyMembers: [member] })),
    'submenu:party',
  ).buildMenu();
  const item = findAction(partyMenu, 'party:atton');

  expect(item.revalidate()).toBe(true);
  item.activate();

  expect(resolveCurrentIndex).toHaveBeenCalledTimes(2);
  expect(switchLeader).toHaveBeenCalledWith(2);
});

test('party activation fails closed when the member is no longer switchable', () => {
  const switchLeader = jest.fn();
  const member = partyMember('bao-dur', 'Bao-Dur', {
    resolveCurrentIndex: () => -1,
    switchLeader,
  });
  const partyMenu = findSubmenu(
    buildVRActionWheel(context({ partyMembers: [member] })),
    'submenu:party',
  ).buildMenu();
  const item = findAction(partyMenu, 'party:bao-dur');

  expect(item.revalidate()).toBe(false);
  item.activate();

  expect(switchLeader).not.toHaveBeenCalled();
});

test('a refreshed engine action with a different source key fails instead of activating another action', () => {
  const source = engineAction('attack', 'Attack', { revalidate: () => false });

  expect(findAction(buildVRActionWheel(context({ targetActions: [source] })), 'engine:attack').revalidate())
    .toBe(false);
});

test('source keys include every identity-bearing engine field', () => {
  const entry: VRActionMenuEntry = {
    action: { type: 7 },
    talent: { __index: 12, label: 'FORCE_LIGHTNING' },
    item: { id: 99, getName: () => 'Advanced Medpac' },
    icon: 'ip_medkit_003',
    playerFacingLabel: 'Force Lightning',
  };
  const baseline = createVRActionSourceKey('target', 1, entry);
  const mutations: readonly VRActionMenuEntry[] = [
    { ...entry, action: { type: 8 } },
    { ...entry, talent: { __index: 13, label: 'FORCE_LIGHTNING' } },
    { ...entry, talent: { __index: 12, label: 'FORCE_STORM' } },
    { ...entry, item: { id: 100, getName: () => 'Advanced Medpac' } },
    { ...entry, item: { id: 99, getName: () => 'Life Support Pack' } },
    { ...entry, icon: 'ip_medkit_004' },
    { ...entry, playerFacingLabel: 'Force Storm' },
  ];

  expect(createVRActionSourceKey('target', 1, { ...entry })).toBe(baseline);
  expect(createVRActionSourceKey('self', 1, entry)).not.toBe(baseline);
  expect(createVRActionSourceKey('target', 2, entry)).not.toBe(baseline);
  for (const mutation of mutations) {
    expect(createVRActionSourceKey('target', 1, mutation)).not.toBe(baseline);
  }
});
