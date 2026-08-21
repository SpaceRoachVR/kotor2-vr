import {
  paginateVRRadialItems,
  validateVRRadialMenu,
  VRRadialActionItem,
  VRRadialContentItem,
  VRRadialMenuDefinition,
} from './VRRadialMenuModel';

export interface VRActionWheelEngineAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  activate(): void;
}

export interface VRActionWheelPartyMember {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  resolveCurrentIndex(): number;
  switchLeader(index: number): void;
}

export interface VRActionWheelBuildContext {
  readonly id: string;
  readonly targetActions: readonly VRActionWheelEngineAction[];
  readonly selfActions: readonly VRActionWheelEngineAction[];
  readonly canLevelUp: boolean;
  readonly partyMembers: readonly VRActionWheelPartyMember[];
  readonly openInventory: () => void;
  readonly openCharacter: () => void;
  readonly openMap: () => void;
  readonly openComfortSettings: () => void;
}

export interface VRActionMenuEntry {
  readonly icon?: unknown;
  readonly action?: { readonly type?: unknown } | null;
  readonly talent?: {
    readonly __index?: unknown;
    readonly label?: unknown;
    readonly name?: unknown;
  } | null;
  readonly item?: {
    readonly id?: unknown;
    getName?: () => unknown;
  } | null;
  /** Label shown to the player after engine-specific localization/fallbacks. */
  readonly playerFacingLabel?: unknown;
}

const STATIC_ACTIONS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly callback: keyof Pick<
    VRActionWheelBuildContext,
    'openInventory' | 'openCharacter' | 'openMap' | 'openComfortSettings'
  >;
}> = [
  { id: 'menu:inventory', label: 'Inventory', icon: 'inv_bag01', callback: 'openInventory' },
  { id: 'menu:character', label: 'Character', icon: 'iattackr', callback: 'openCharacter' },
  { id: 'menu:map', label: 'Map', icon: 'imap', callback: 'openMap' },
];

/** Builds an immutable, engine-independent snapshot in deterministic route order. */
export function buildVRActionWheel(context: VRActionWheelBuildContext): VRRadialMenuDefinition {
  validateBuildContext(context);

  const items: VRRadialContentItem[] = [];
  const engineIds = new Set<string>();
  appendEngineActions(items, context.targetActions, engineIds);
  appendEngineActions(items, context.selfActions, engineIds);

  for (const route of STATIC_ACTIONS) {
    items.push(createStaticAction(route.id, route.label, route.icon, context[route.callback]));
  }

  if (context.canLevelUp === true) {
    items.push(createStaticAction('menu:level-up', 'Level-Up', 'ilevelup', context.openCharacter));
  }

  const partyMembers = validPartyMembers(context.partyMembers);
  if (partyMembers.length > 0) {
    items.push({
      kind: 'submenu',
      id: 'submenu:party',
      label: 'Party',
      icon: 'iparty',
      revalidate: () => partyMembers.some(isSwitchablePartyMember),
      buildMenu: () => buildPartyMenu(context.id, partyMembers),
    });
  }

  items.push(createStaticAction(
    'menu:comfort-settings',
    'Comfort Settings',
    'iopts',
    context.openComfortSettings,
  ));

  return createMenu(context.id.trim(), 'Actions', items);
}

/**
 * Creates the stable identity used to match a captured engine action against a
 * freshly rebuilt ActionMenuManager panel immediately before activation.
 */
export function createVRActionSourceKey(
  kind: 'target' | 'self',
  panelIndex: number,
  entry: VRActionMenuEntry,
): string {
  const itemName = safelyReadItemName(entry?.item);
  return JSON.stringify([
    kind,
    normalizeNumber(panelIndex),
    normalizeIdentity(entry?.action?.type),
    normalizeIdentity(entry?.talent?.__index),
    normalizeIdentity(entry?.talent?.label),
    normalizeIdentity(entry?.item?.id),
    normalizeIdentity(itemName),
    normalizeIdentity(entry?.icon),
    normalizeIdentity(entry?.playerFacingLabel),
  ]);
}

function appendEngineActions(
  output: VRRadialContentItem[],
  actions: readonly VRActionWheelEngineAction[],
  seenIds: Set<string>,
): void {
  for (const action of actions) {
    if (!isValidEngineAction(action)) continue;
    const stableId = action.id.trim();
    if (seenIds.has(stableId)) continue;
    if (!safelyRevalidateEngineAction(action)) continue;
    seenIds.add(stableId);
    output.push({
      kind: 'action',
      id: `engine:${stableId}`,
      label: action.label.trim(),
      ...(action.icon === undefined ? {} : { icon: action.icon.trim() }),
      revalidate: () => safelyRevalidateEngineAction(action),
      activate: () => action.activate(),
    });
  }
}

function safelyRevalidateEngineAction(action: VRActionWheelEngineAction): boolean {
  try {
    return action.revalidate() === true;
  } catch {
    return false;
  }
}

function createStaticAction(
  id: string,
  label: string,
  icon: string,
  activate: () => void,
): VRRadialActionItem {
  return { kind: 'action', id, label, icon, revalidate: () => true, activate };
}

function validPartyMembers(
  members: readonly VRActionWheelPartyMember[],
): readonly VRActionWheelPartyMember[] {
  const seenIds = new Set<string>();
  const valid: VRActionWheelPartyMember[] = [];
  for (const member of members) {
    if (!isValidPartyMember(member)) continue;
    const stableId = member.id.trim();
    if (seenIds.has(stableId)) continue;
    seenIds.add(stableId);
    valid.push(member);
  }
  return valid;
}

function buildPartyMenu(
  rootId: string,
  members: readonly VRActionWheelPartyMember[],
): VRRadialMenuDefinition {
  const items: VRRadialActionItem[] = members.map((member) => ({
    kind: 'action',
    id: `party:${member.id.trim()}`,
    label: member.label.trim(),
    ...(member.icon === undefined ? {} : { icon: member.icon.trim() }),
    revalidate: () => isSwitchablePartyMember(member),
    activate: () => {
      const currentIndex = safelyResolvePartyIndex(member);
      if (currentIndex > 0) member.switchLeader(currentIndex);
    },
  }));
  return createMenu(`${rootId.trim()}:party`, 'Party', items);
}

function createMenu(
  id: string,
  title: string,
  items: readonly VRRadialContentItem[],
): VRRadialMenuDefinition {
  const menu: VRRadialMenuDefinition = { id, title, pages: paginateVRRadialItems(items) };
  validateVRRadialMenu(menu);
  return menu;
}

function validateBuildContext(context: VRActionWheelBuildContext): void {
  if (!context || typeof context !== 'object') throw new TypeError('context must be an object');
  if (typeof context.id !== 'string' || context.id.trim().length === 0) {
    throw new TypeError('context id must be a non-empty string');
  }
  if (!Array.isArray(context.targetActions) || !Array.isArray(context.selfActions)) {
    throw new TypeError('engine action collections must be arrays');
  }
  if (!Array.isArray(context.partyMembers)) throw new TypeError('partyMembers must be an array');
  for (const callback of ['openInventory', 'openCharacter', 'openMap', 'openComfortSettings'] as const) {
    if (typeof context[callback] !== 'function') {
      throw new TypeError(`${callback} must be callable`);
    }
  }
}

function isValidEngineAction(action: VRActionWheelEngineAction): boolean {
  return !!action &&
    typeof action === 'object' &&
    isNonEmptyString(action.id) &&
    isNonEmptyString(action.label) &&
    (action.icon === undefined || isNonEmptyString(action.icon)) &&
    typeof action.revalidate === 'function' &&
    typeof action.activate === 'function';
}

function isValidPartyMember(member: VRActionWheelPartyMember): boolean {
  return !!member &&
    typeof member === 'object' &&
    isNonEmptyString(member.id) &&
    isNonEmptyString(member.label) &&
    (member.icon === undefined || isNonEmptyString(member.icon)) &&
    typeof member.resolveCurrentIndex === 'function' &&
    typeof member.switchLeader === 'function';
}

function isSwitchablePartyMember(member: VRActionWheelPartyMember): boolean {
  return safelyResolvePartyIndex(member) > 0;
}

function safelyResolvePartyIndex(member: VRActionWheelPartyMember): number {
  try {
    const index = member.resolveCurrentIndex();
    return Number.isInteger(index) ? index : -1;
  } catch {
    return -1;
  }
}

function safelyReadItemName(item: VRActionMenuEntry['item']): unknown {
  if (!item || typeof item.getName !== 'function') return undefined;
  try {
    return item.getName();
  } catch {
    return undefined;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeNumber(value: number): number | null {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function normalizeIdentity(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  return null;
}
