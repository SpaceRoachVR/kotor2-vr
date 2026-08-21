import { describe, expect, jest, test } from '@jest/globals';
import {
  paginateVRRadialItems,
  validateVRRadialMenu,
  VRRadialActionItem,
  VRRadialMenuItem,
  VRRadialPage,
} from '@/vr/runtime/VRRadialMenuModel';

const action = (id: string): VRRadialActionItem => ({
  kind: 'action', id, label: id, revalidate: () => true, activate: jest.fn(),
});

test.each([
  [0, []],
  [1, [['action-0']]],
  [6, [['action-0', 'action-1', 'action-2', 'action-3', 'action-4', 'action-5']]],
  [7, [
    ['action-0', 'action-1', 'action-2', 'action-3', 'action-4', 'action-5', 'nav:next'],
    ['nav:previous', 'action-6'],
  ]],
  [13, [
    ['action-0', 'action-1', 'action-2', 'action-3', 'action-4', 'action-5', 'nav:next'],
    ['nav:previous', 'action-6', 'action-7', 'action-8', 'action-9', 'action-10', 'action-11', 'nav:next'],
    ['nav:previous', 'action-12'],
  ]],
])('paginates %i content items with dedicated navigation', (count, expected) => {
  const pages = paginateVRRadialItems(
    Array.from({ length: count }, (_, index) => action(`action-${index}`))
  );
  expect(pages.map((page) => page.entries.map((entry) => entry.id))).toEqual(expected);
});

test('rejects duplicate ids and empty menus', () => {
  expect(() => validateVRRadialMenu({ id: 'empty', title: 'Empty', pages: [] })).toThrow('at least one page');
  const pages = paginateVRRadialItems([action('same'), action('same')]);
  expect(() => validateVRRadialMenu({ id: 'duplicate', title: 'Menu', pages })).toThrow('duplicate item id');
});

describe('validation edge cases', () => {
  test.each([
    [{ id: '', title: 'Menu', pages: [ { index: 0, entries: [action('a')] } ] }, 'menu id'],
    [{ id: 'menu', title: ' ', pages: [ { index: 0, entries: [action('a')] } ] }, 'menu title'],
    [{ id: 'menu', title: 'Menu', pages: [ { index: 1, entries: [action('a')] } ] }, 'sequential'],
    [{ id: 'menu', title: 'Menu', pages: [ { index: 0, entries: [] } ] }, 'between 1 and 8'],
    [{ id: 'menu', title: 'Menu', pages: [ { index: 0, entries: [action('')] } ] }, 'item id'],
    [{ id: 'menu', title: 'Menu', pages: [ { index: 0, entries: [{ ...action('a'), label: ' ' }] } ] }, 'label'],
  ])('rejects invalid menu %#', (menu, message) => {
    expect(() => validateVRRadialMenu(menu)).toThrow(message);
  });

  test.each([0, 1.5, 7, Number.NaN])('rejects invalid contentPerPage %p', (size) => {
    expect(() => paginateVRRadialItems([action('a')], size)).toThrow(
      'contentPerPage must be an integer from 1 through 6',
    );
  });

  test('requires callable item behavior', () => {
    const invalidAction = { kind: 'action', id: 'a', label: 'A', revalidate: true, activate: (): void => undefined } as unknown as VRRadialMenuItem;
    expect(() => validateVRRadialMenu({ id: 'menu', title: 'Menu', pages: [{ index: 0, entries: [invalidAction] }] }))
      .toThrow('callable revalidate');

    const invalidSubmenu = { kind: 'submenu', id: 'sub', label: 'Sub', revalidate: () => true } as unknown as VRRadialMenuItem;
    expect(() => validateVRRadialMenu({ id: 'menu', title: 'Menu', pages: [{ index: 0, entries: [invalidSubmenu] }] }))
      .toThrow('callable buildMenu');
  });

  test('rejects a page with more than six content actions', () => {
    const page = { index: 0, entries: Array.from({ length: 7 }, (_, index) => action(`a${index}`)) };
    expect(() => validateVRRadialMenu({ id: 'menu', title: 'Menu', pages: [page] }))
      .toThrow('at most 6 content items');
  });

  test('rejects duplicate navigation entries', () => {
    const page = {
      index: 0,
      entries: [action('a'),
        { kind: 'next-page', id: 'nav:next', label: 'Next' } as const,
        { kind: 'next-page', id: 'nav:next', label: 'Next' } as const],
    };
    expect(() => validateVRRadialMenu({ id: 'menu', title: 'Menu', pages: [page] }))
      .toThrow('duplicate navigation');
  });

  test('rejects Previous on page 0', () => {
    const page = { index: 0, entries: [action('a'), { kind: 'previous-page', id: 'nav:previous', label: 'Previous' } as const] } as VRRadialPage;
    expect(() => validateVRRadialMenu({ id: 'menu', title: 'Menu', pages: [page] }))
      .toThrow('Previous is not allowed on page 0');
  });

  test('rejects Next on the last page', () => {
    const page = { index: 0, entries: [action('a'), { kind: 'next-page', id: 'nav:next', label: 'Next' } as const] } as VRRadialPage;
    expect(() => validateVRRadialMenu({ id: 'menu', title: 'Menu', pages: [page] }))
      .toThrow('Next is not allowed on last page');
  });
});
