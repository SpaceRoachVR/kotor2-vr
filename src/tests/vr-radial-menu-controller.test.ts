import { describe, expect, jest, test } from '@jest/globals';
import {
  VRRadialControllerInput,
  VRRadialMenuController,
} from '@/vr/runtime/VRRadialMenuController';
import {
  paginateVRRadialItems,
  VRRadialActionItem,
  VRRadialContentItem,
  VRRadialMenuDefinition,
  VRRadialSubmenuItem,
} from '@/vr/runtime/VRRadialMenuModel';
import { VRRadialHit } from '@/vr/runtime/VRRadialMenuLayout';

describe('VRRadialMenuController', () => {
  test('opens on X, confirms the left-ray action on left-trigger press, and closes before activation', () => {
    const activate = jest.fn();
    const controller = new VRRadialMenuController();
    const menu = singlePageMenu([action('attack', activate)]);

    expect(controller.process(input({ menuPressed: true, openingMenu: menu }))).toContainEqual({ type: 'opened' });
    controller.process(input({ menuPressed: true, rayHit: { kind: 'entry', index: 0 } }));
    const effects = controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 0 } }));

    expect(controller.isOpen).toBe(false);
    expect(effects).toEqual([
      { type: 'closed', reason: 'activated' },
      { type: 'confirm-haptic', hand: 'left' },
      { type: 'activate', item: expect.objectContaining({ id: 'attack' }), hand: 'left' },
    ]);
    expect(activate).not.toHaveBeenCalled();
  });

  test.each<VRRadialHit | null>([null, { kind: 'center' }, { kind: 'entry', index: 0 }])(
    'X release over %p cancels without activation',
    (hit) => {
      const controller = new VRRadialMenuController();
      controller.process(input({ menuPressed: true, openingMenu: menuWithAction(), rayHit: hit }));

      expect(controller.process(input({ menuPressed: false, rayHit: hit }))).toContainEqual({ type: 'closed', reason: 'cancel' });
      expect(controller.isOpen).toBe(false);
    },
  );

  test('left-trigger on center cancels while a no-target trigger leaves the wheel open', () => {
    const controller = new VRRadialMenuController();
    controller.process(input({ menuPressed: true, openingMenu: menuWithAction() }));

    controller.process(input({ menuPressed: true, selectPressed: true, rayHit: null }));
    expect(controller.isOpen).toBe(true);
    controller.process(input({ menuPressed: true, selectPressed: false, rayHit: { kind: 'center' } }));

    expect(controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'center' } }))).toEqual([
      { type: 'closed', reason: 'cancel' },
    ]);
  });

  test('direct touch activates immediately and waits for X release before reopening', () => {
    const controller = new VRRadialMenuController();
    const menu = menuWithAction();
    controller.process(input({ menuPressed: true, openingMenu: menu }));

    const effects = controller.process(input({
      menuPressed: true,
      touchHits: { right: { kind: 'entry', index: 0 } },
    }));

    expect(effects).toEqual([
      { type: 'closed', reason: 'activated' },
      { type: 'confirm-haptic', hand: 'right' },
      { type: 'activate', item: expect.objectContaining({ id: 'attack' }), hand: 'right' },
    ]);
    expect(controller.process(input({ menuPressed: true, openingMenu: menu })).some((effect) => effect.type === 'opened')).toBe(false);
    controller.process(input({ menuPressed: false }));
    expect(controller.process(input({ menuPressed: true, openingMenu: menu }))).toContainEqual({ type: 'opened' });
  });

  test('left-trigger press changes one page immediately and holding it does not repeat', () => {
    const controller = new VRRadialMenuController();
    const menu = menuWithActions(7);
    controller.process(input({ menuPressed: true, openingMenu: menu }));

    controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 6 } }));
    expect(controller.presentation?.pageIndex).toBe(1);
    controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 0 } }));
    expect(controller.presentation?.pageIndex).toBe(1);
    controller.process(input({ menuPressed: true, selectPressed: false, rayHit: { kind: 'entry', index: 0 } }));
    controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 0 } }));

    expect(controller.presentation?.pageIndex).toBe(0);
  });

  test('a Party submenu starts on page one and a new opening always resets to page one', () => {
    const controller = new VRRadialMenuController();
    const party = menuWithActions(7, 'party');
    const menu = singlePageMenu([submenu('party', () => party)]);
    controller.process(input({ menuPressed: true, openingMenu: menu }));

    controller.process(input({ menuPressed: true, touchHits: { left: { kind: 'entry', index: 0 } } }));
    expect(controller.presentation?.menu.id).toBe('party');
    expect(controller.presentation?.pageIndex).toBe(0);
    controller.close('lifecycle');
    controller.process(input({ menuPressed: false }));
    controller.process(input({ menuPressed: true, openingMenu: menuWithActions(7) }));

    expect(controller.presentation?.pageIndex).toBe(0);
  });

  test('revalidates a ray action at confirmation and rejects an invalidated action without activation', () => {
    const activate = jest.fn();
    const revalidate = jest.fn(() => false);
    const controller = new VRRadialMenuController();
    controller.process(input({ menuPressed: true, openingMenu: singlePageMenu([action('attack', activate, revalidate)]), rayHit: { kind: 'entry', index: 0 } }));

    expect(controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 0 } }))).toEqual([
      { type: 'closed', reason: 'invalid' },
      { type: 'negative-haptic', hand: 'left' },
    ]);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(activate).not.toHaveBeenCalled();
  });

  test('revalidates a submenu before building it and never invokes its builder when invalid', () => {
    const buildMenu = jest.fn(() => menuWithActions(2, 'party'));
    const revalidate = jest.fn(() => false);
    const controller = new VRRadialMenuController();
    controller.process(input({ menuPressed: true, openingMenu: singlePageMenu([submenu('party', buildMenu, revalidate)]) }));

    expect(controller.process(input({ menuPressed: true, touchHits: { left: { kind: 'entry', index: 0 } } }))).toEqual([
      { type: 'closed', reason: 'invalid' },
      { type: 'negative-haptic', hand: 'left' },
    ]);
    expect(revalidate).toHaveBeenCalledTimes(1);
    expect(buildMenu).not.toHaveBeenCalled();
  });

  test('uses the current ray hit on the left-trigger edge rather than a stale hover', () => {
    const first = jest.fn();
    const second = jest.fn();
    const controller = new VRRadialMenuController();
    controller.process(input({ menuPressed: true, openingMenu: singlePageMenu([action('first', first), action('second', second)]) }));
    controller.process(input({ menuPressed: true, rayHit: { kind: 'entry', index: 0 } }));

    const effects = controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 1 } }));

    expect(effects).toContainEqual({ type: 'activate', item: expect.objectContaining({ id: 'second' }), hand: 'left' });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  test('processes simultaneous touch in left-to-right order and fires an overlap only once', () => {
    const controller = new VRRadialMenuController();
    const party = singlePageMenu([action('party-action')], 'party');
    const menu = singlePageMenu([
      submenu('left-party', () => party),
      submenu('right-party', () => party),
    ]);
    controller.process(input({ menuPressed: true, openingMenu: menu }));

    controller.process(input({
      menuPressed: true,
      touchHits: { left: { kind: 'entry', index: 0 }, right: { kind: 'entry', index: 1 } },
    }));
    expect(controller.presentation?.menu.id).toBe('party');
    controller.process(input({ menuPressed: true, touchHits: { left: { kind: 'entry', index: 0 } } }));

    expect(controller.presentation?.menu.id).toBe('party');
  });

  test('an invalid opening waits for X release before a valid menu can open', () => {
    const controller = new VRRadialMenuController();
    const validMenu = menuWithAction();
    const invalidMenu = { id: '', title: 'invalid', pages: [] } as unknown as VRRadialMenuDefinition;

    expect(controller.process(input({ menuPressed: true, openingMenu: invalidMenu }))).toContainEqual({ type: 'closed', reason: 'invalid' });
    expect(controller.process(input({ menuPressed: true, openingMenu: validMenu }))).toEqual([]);
    expect(controller.isOpen).toBe(false);
    controller.process(input({ menuPressed: false }));

    expect(controller.process(input({ menuPressed: true, openingMenu: validMenu }))).toContainEqual({ type: 'opened' });
  });

  test('lifecycle close suppresses a held X until it is physically released', () => {
    const controller = new VRRadialMenuController();
    const menu = menuWithAction();
    controller.process(input({ menuPressed: true, openingMenu: menu }));

    expect(controller.close('lifecycle')).toEqual([{ type: 'closed', reason: 'lifecycle' }]);
    expect(controller.process(input({ menuPressed: true, openingMenu: menu }))).toEqual([]);
    controller.process(input({ menuPressed: false }));

    expect(controller.process(input({ menuPressed: true, openingMenu: menu }))).toContainEqual({ type: 'opened' });
  });
});

function input(overrides: Partial<VRRadialControllerInput> = {}): VRRadialControllerInput {
  return {
    menuPressed: false,
    selectPressed: false,
    openingMenu: null,
    rayHit: null,
    touchHits: {},
    ...overrides,
  };
}

function action(id: string, activate = jest.fn(), revalidate = jest.fn(() => true)): VRRadialActionItem {
  return { kind: 'action', id, label: id, activate, revalidate };
}

function submenu(
  id: string,
  buildMenu: () => VRRadialMenuDefinition,
  revalidate = jest.fn(() => true),
): VRRadialSubmenuItem {
  return { kind: 'submenu', id, label: id, buildMenu, revalidate };
}

function menuWithAction(): VRRadialMenuDefinition {
  return singlePageMenu([action('attack')]);
}

function menuWithActions(count: number, id = 'root'): VRRadialMenuDefinition {
  return menuFromItems(Array.from({ length: count }, (_, index) => action(`action-${index}`)), id);
}

function singlePageMenu(items: readonly VRRadialContentItem[], id = 'root'): VRRadialMenuDefinition {
  return menuFromItems(items, id);
}

function menuFromItems(items: readonly VRRadialContentItem[], id: string): VRRadialMenuDefinition {
  return { id, title: id, pages: paginateVRRadialItems(items) };
}
