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
    // Panel 0 by default. For target actions that is the Attack panel, but only
    // when the target is a hostile creature — otherwise panel 0 carries world
    // actions, which is the default this helper is used under.
    panelIndex: 0,
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
    targetIsHostileCreature: false,
    partyMembers: [],
    openComfortSettings: jest.fn(),
    openMenu: jest.fn(),
    canClearActions: false,
    clearQueuedActions: jest.fn(),
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

/**
 * ROADMAP 4.8. The combat top level is exactly six items and must never
 * paginate: pagination mid-fight is the failure this redesign exists to remove,
 * and `validateVRRadialMenu` caps a page at six content items anyway.
 */
test('a hostile target yields exactly six top-level items on one page', () => {
  const menu = buildVRActionWheel(context({
    targetIsHostileCreature: true,
    targetActions: [
      engineAction('attack', 'Attack', { panelIndex: 0 }),
      engineAction('flurry', 'Flurry', { panelIndex: 0 }),
      engineAction('lightning', 'Force Lightning', { panelIndex: 1 }),
    ],
    selfActions: [engineAction('heal', 'Heal', { panelIndex: 1 })],
    partyMembers: [partyMember('kreia', 'Kreia')],
    canClearActions: true,
  }));

  expect(contentIds(menu)).toEqual([
    'submenu:attacks',
    'submenu:force-powers',
    'menu:screens',
    'submenu:party',
    'action:clear-queue',
    'menu:comfort-settings',
  ]);
  expect(menu.pages).toHaveLength(1);
  expect(contentIds(menu)).not.toContain('menu:galaxy-map');
  // Superseded by the Menu route: MenuCharacter is where Auto Level-Up lives,
  // so a seventh top-level wedge would have forced pagination for something
  // that is never time-critical.
  expect(contentIds(menu)).not.toContain('menu:level-up');
});

test('splits Attacks from Force Powers along the panels the engine already filtered', () => {
  const menu = buildVRActionWheel(context({
    targetIsHostileCreature: true,
    targetActions: [
      engineAction('attack', 'Attack', { panelIndex: 0 }),
      engineAction('flurry', 'Flurry', { panelIndex: 0 }),
      engineAction('lightning', 'Force Lightning', { panelIndex: 1 }),
    ],
    selfActions: [engineAction('heal', 'Heal', { panelIndex: 1 })],
  }));

  expect(contentIds(findSubmenu(menu, 'submenu:attacks').buildMenu()))
    .toEqual(['engine:attack', 'engine:flurry']);
  // Hostile (target panel 1) and friendly (self panel 1) powers share one page.
  expect(contentIds(findSubmenu(menu, 'submenu:force-powers').buildMenu()))
    .toEqual(['engine:lightning', 'engine:heal']);
});

test('keeps world actions at the top level when the target is not a hostile creature', () => {
  // The same panel indices carry Security, Bash, Open and mine Disarm/Recover
  // for a door, container or trap. Filing those under "Attacks" would put a
  // one-press interaction behind a submenu.
  const menu = buildVRActionWheel(context({
    targetIsHostileCreature: false,
    targetActions: [
      engineAction('security', 'Security', { panelIndex: 1 }),
      engineAction('bash', 'Bash', { panelIndex: 0 }),
    ],
  }));

  expect(contentIds(menu)).toContain('engine:security');
  expect(contentIds(menu)).toContain('engine:bash');
  expect(contentIds(menu)).not.toContain('submenu:attacks');
  expect(contentIds(menu)).not.toContain('submenu:force-powers');
});

test('omits a combat submenu with no valid actions rather than offering a dead wedge', () => {
  // An empty submenu is not merely useless: an empty menu fails
  // validateVRRadialMenu's "at least one page" rule with a RangeError, which
  // would take the whole wheel down mid-fight.
  const menu = buildVRActionWheel(context({
    targetIsHostileCreature: true,
    targetActions: [
      engineAction('attack', 'Attack', { panelIndex: 0 }),
      engineAction('spent', 'Force Lightning', { panelIndex: 1, revalidate: () => false }),
    ],
  }));

  expect(contentIds(menu)).toContain('submenu:attacks');
  expect(contentIds(menu)).not.toContain('submenu:force-powers');
});

test('paginates a combat page that exceeds the six-item content cap', () => {
  // Later in the game a character knows more than six hostile powers. The cap
  // is enforced by a thrown RangeError, so this must paginate rather than throw.
  const powers = Array.from({ length: 9 }, (_, index) =>
    engineAction(`power-${index}`, `Power ${index}`, { panelIndex: 1 }));
  const forcePowers = findSubmenu(
    buildVRActionWheel(context({ targetIsHostileCreature: true, targetActions: powers })),
    'submenu:force-powers',
  ).buildMenu();

  expect(forcePowers.pages.length).toBeGreaterThan(1);
  expect(contentIds(forcePowers)).toHaveLength(9);
});

test('the Menu wedge is the single route to all eight in-game screens', () => {
  // MenuManager sets childMenu = MenuTop on every one of the eight screens, and
  // GameMenu.show() shows the child, so opening Character brings up the live
  // tab bar. Eight wedges across two levels collapse into one.
  const openMenu = jest.fn();
  const menu = buildVRActionWheel(context({ openMenu }));

  findAction(menu, 'menu:screens').activate();

  expect(openMenu).toHaveBeenCalledTimes(1);
  for (const retired of [
    'menu:inventory', 'menu:character', 'menu:map',
    'menu:equipment', 'menu:abilities', 'menu:journal', 'menu:messages', 'menu:options',
    'submenu:screens',
  ]) {
    expect(contentIds(menu)).not.toContain(retired);
  }
});

test('rejects a build context missing any menu route', () => {
  for (const missing of ['openComfortSettings', 'openMenu'] as const) {
    const broken = context();
    delete (broken as unknown as Record<string, unknown>)[missing];

    expect(() => buildVRActionWheel(broken)).toThrow(`${missing} must be callable`);
  }
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

test('omits an engine descriptor that is already unavailable', () => {
  const menu = buildVRActionWheel(context({
    targetActions: [engineAction('stale-attack', 'Attack', { revalidate: () => false })],
  }));

  expect(contentIds(menu)).not.toContain('engine:stale-attack');
});

test('omits an engine descriptor whose initial revalidation throws', () => {
  const menu = buildVRActionWheel(context({
    selfActions: [engineAction('broken-force', 'Force', {
      revalidate: () => { throw new Error('engine refresh failed'); },
    })],
  }));

  expect(contentIds(menu)).not.toContain('engine:broken-force');
});

test('static actions invoke only their bound local routes', () => {
  const openMenu = jest.fn();
  const openComfortSettings = jest.fn();
  const menu = buildVRActionWheel(context({ openMenu, openComfortSettings }));

  findAction(menu, 'menu:screens').activate();

  expect(openMenu).toHaveBeenCalledTimes(1);
  expect(openComfortSettings).not.toHaveBeenCalled();

  findAction(menu, 'menu:comfort-settings').activate();

  expect(openComfortSettings).toHaveBeenCalledTimes(1);
  expect(openMenu).toHaveBeenCalledTimes(1);
});

test('an action carrying no usable panel index falls through to the top level', () => {
  // Never guess a category for a malformed descriptor: filing it under Attacks
  // or Force Powers would put it somewhere it may not belong, and dropping it
  // would make an authored action unreachable.
  const menu = buildVRActionWheel(context({
    targetIsHostileCreature: true,
    targetActions: [
      engineAction('attack', 'Attack', { panelIndex: 0 }),
      engineAction('odd', 'Odd Action', { panelIndex: 7 }),
    ],
  }));

  expect(contentIds(menu)).toContain('engine:odd');
  expect(contentIds(findSubmenu(menu, 'submenu:attacks').buildMenu()))
    .not.toContain('engine:odd');
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
  let revalidationCount = 0;
  const source = engineAction('attack', 'Attack', {
    revalidate: () => {
      revalidationCount += 1;
      return revalidationCount === 1;
    },
  });

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


test('offers Clear Actions only when something is queued', () => {
  // BTN_CLEARALL's VR counterpart. Offering it with an empty queue would be a
  // control that visibly does nothing.
  const clearQueuedActions = jest.fn();

  expect(contentIds(buildVRActionWheel(context({ canClearActions: false }))))
    .not.toContain('action:clear-queue');

  const menu = buildVRActionWheel(context({ canClearActions: true, clearQueuedActions }));
  expect(contentIds(menu)).toContain('action:clear-queue');

  findAction(menu, 'action:clear-queue').activate();
  expect(clearQueuedActions).toHaveBeenCalledTimes(1);
});

test('rejects a build context without a clear-queue route', () => {
  const broken = context();
  delete (broken as unknown as Record<string, unknown>).clearQueuedActions;

  expect(() => buildVRActionWheel(broken)).toThrow('clearQueuedActions must be callable');
});
