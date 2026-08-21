/** Engine-independent immutable data model for the VR radial action wheel. */
export interface VRRadialActionItem {
  readonly kind: 'action';
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  activate(): void;
}

export interface VRRadialSubmenuItem {
  readonly kind: 'submenu';
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  buildMenu(): VRRadialMenuDefinition;
}

export type VRRadialContentItem = VRRadialActionItem | VRRadialSubmenuItem;

export interface VRRadialNavigationItem {
  readonly kind: 'previous-page' | 'next-page';
  readonly id: 'nav:previous' | 'nav:next';
  readonly label: 'Previous' | 'Next';
}

export type VRRadialMenuItem = VRRadialContentItem | VRRadialNavigationItem;

export interface VRRadialPage {
  readonly index: number;
  readonly entries: readonly VRRadialMenuItem[];
}

export interface VRRadialMenuDefinition {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly VRRadialPage[];
}

export function paginateVRRadialItems(
  items: readonly VRRadialContentItem[],
  contentPerPage = 6,
): readonly VRRadialPage[] {
  if (!Number.isInteger(contentPerPage) || contentPerPage < 1 || contentPerPage > 6) {
    throw new RangeError('contentPerPage must be an integer from 1 through 6');
  }

  const pages: VRRadialPage[] = [];
  for (let offset = 0; offset < items.length; offset += contentPerPage) {
    const index = pages.length;
    const entries: VRRadialMenuItem[] = [];
    if (index > 0) {
      entries.push({ kind: 'previous-page', id: 'nav:previous', label: 'Previous' });
    }
    entries.push(...items.slice(offset, offset + contentPerPage));
    if (offset + contentPerPage < items.length) {
      entries.push({ kind: 'next-page', id: 'nav:next', label: 'Next' });
    }
    pages.push({ index, entries });
  }
  return pages;
}

export function validateVRRadialMenu(menu: VRRadialMenuDefinition): void {
  if (!menu || typeof menu !== 'object') {
    throw new TypeError('menu must be an object');
  }
  assertNonEmptyString(menu.id, 'menu id');
  assertNonEmptyString(menu.title, 'menu title');
  if (!Array.isArray(menu.pages) || menu.pages.length === 0) {
    throw new RangeError('menu must contain at least one page');
  }

  const contentIds = new Set<string>();
  menu.pages.forEach((page, pagePosition) => {
    if (!page || typeof page !== 'object') {
      throw new TypeError(`page ${pagePosition} must be an object`);
    }
    if (page.index !== pagePosition) {
      throw new RangeError(`page indices must be sequential starting at 0 (page ${pagePosition})`);
    }
    if (!Array.isArray(page.entries) || page.entries.length < 1 || page.entries.length > 8) {
      throw new RangeError(`page ${pagePosition} must contain between 1 and 8 entries`);
    }
    page.entries.forEach((entry: VRRadialMenuItem, entryPosition: number) => {
      validateMenuItem(entry, pagePosition, entryPosition, contentIds);
    });
  });
}

function validateMenuItem(
  entry: VRRadialMenuItem,
  pageIndex: number,
  entryIndex: number,
  contentIds: Set<string>,
): void {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError(`entry ${pageIndex}:${entryIndex} must be an object`);
  }
  if (entry.kind === 'previous-page' || entry.kind === 'next-page') {
    const expectedId = entry.kind === 'previous-page' ? 'nav:previous' : 'nav:next';
    const expectedLabel = entry.kind === 'previous-page' ? 'Previous' : 'Next';
    if (entry.id !== expectedId || entry.label !== expectedLabel) {
      throw new TypeError(`navigation entry ${pageIndex}:${entryIndex} has invalid id or label`);
    }
    return;
  }
  if (entry.kind !== 'action' && entry.kind !== 'submenu') {
    throw new TypeError(`entry ${pageIndex}:${entryIndex} has an invalid kind`);
  }
  assertNonEmptyString(entry.id, 'item id');
  assertNonEmptyString(entry.label, 'item label');
  if (contentIds.has(entry.id)) {
    throw new RangeError(`duplicate item id: ${entry.id}`);
  }
  contentIds.add(entry.id);
  if (typeof entry.revalidate !== 'function') {
    throw new TypeError(`item ${entry.id} must provide a callable revalidate function`);
  }
  if (entry.kind === 'action' && typeof entry.activate !== 'function') {
    throw new TypeError(`action ${entry.id} must provide a callable activate function`);
  }
  if (entry.kind === 'submenu' && typeof entry.buildMenu !== 'function') {
    throw new TypeError(`submenu ${entry.id} must provide a callable buildMenu function`);
  }
}

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}
