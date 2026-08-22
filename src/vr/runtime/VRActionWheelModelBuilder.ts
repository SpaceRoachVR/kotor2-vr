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
  readonly openEquipment: () => void;
  readonly openAbilities: () => void;
  readonly openJournal: () => void;
  readonly openMessages: () => void;
  readonly openOptions: () => void;
  /**
   * True when the player has queued actions or is in combat — the only state in
   * which clearing is meaningful. The wheel omits the route otherwise rather
   * than offering a control that would do nothing.
   */
  readonly canClearActions: boolean;
  /** Clears the action queue and cancels combat, as BTN_CLEARALL does. */
  readonly clearQueuedActions: () => void;
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

type VRActionWheelMenuCallback = keyof Pick<
  VRActionWheelBuildContext,
  'openInventory' | 'openCharacter' | 'openMap' | 'openComfortSettings' |
  'openEquipment' | 'openAbilities' | 'openJournal' | 'openMessages' | 'openOptions'
>;

interface VRActionWheelMenuRoute {
  readonly id: string;
  readonly label: string;
  /**
   * Verified against the retail `swpc_tex_gui.erf` key list. TSL names the
   * in-game overlay icons `lbl_icn_<screen>2`; the wheel previously used names
   * like `inv_bag01` and `iattackr`, none of which exist, so every wedge logged
   * a load failure and drew the generic fallback.
   */
  readonly icon: string;
  readonly callback: VRActionWheelMenuCallback;
}

/** Reached in one press — the screens opened often enough to want them shallow. */
const STATIC_ACTIONS: readonly VRActionWheelMenuRoute[] = [
  { id: 'menu:inventory', label: 'Inventory', icon: 'lbl_icn_inv2', callback: 'openInventory' },
  { id: 'menu:character', label: 'Character', icon: 'lbl_icn_char2', callback: 'openCharacter' },
  { id: 'menu:map', label: 'Map', icon: 'lbl_icn_map2', callback: 'openMap' },
];

/**
 * The rest of the flatscreen in-game overlay (ROADMAP 4.5).
 *
 * `InGameOverlay` offers eight screens — Messages, Journal, Map, Options,
 * Character, Abilities, Inventory, Equipment — and the wheel routed only three
 * of them, so Equipment, Abilities, Journal, Messages, and Options had no VR
 * route at all. Equipment in particular is not optional: it is where gear is
 * swapped.
 *
 * They go in a submenu rather than at the top level so the common three stay a
 * single press, matching how Party is already nested.
 */
const SCREEN_ACTIONS: readonly VRActionWheelMenuRoute[] = [
  { id: 'menu:equipment', label: 'Equipment', icon: 'lbl_icn_equ2', callback: 'openEquipment' },
  { id: 'menu:abilities', label: 'Abilities', icon: 'lbl_icn_abi2', callback: 'openAbilities' },
  { id: 'menu:journal', label: 'Journal', icon: 'lbl_icn_que2', callback: 'openJournal' },
  { id: 'menu:messages', label: 'Messages', icon: 'lbl_icn_msg2', callback: 'openMessages' },
  { id: 'menu:options', label: 'Options', icon: 'lbl_icn_opt2', callback: 'openOptions' },
];

const MENU_CALLBACKS: readonly VRActionWheelMenuCallback[] = [
  ...STATIC_ACTIONS.map((route) => route.callback),
  ...SCREEN_ACTIONS.map((route) => route.callback),
  'openComfortSettings',
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
    items.push(createStaticAction('menu:level-up', 'Level-Up', 'lbl_levelup', context.openCharacter));
  }

  const partyMembers = validPartyMembers(context.partyMembers);
  if (partyMembers.length > 0) {
    items.push({
      kind: 'submenu',
      id: 'submenu:party',
      label: 'Party',
      icon: 'lbl_icn_prty2',
      revalidate: () => partyMembers.some(isSwitchablePartyMember),
      buildMenu: () => buildPartyMenu(context.id, partyMembers),
    });
  }

  // The flatscreen overlay's BTN_CLEARALL (ROADMAP 4.5). Its sibling target
  // up/down controls have no VR counterpart by design: they exist because the
  // flat panel shows one action at a time, and the wheel already enumerates
  // every panel action at once.
  if (context.canClearActions === true) {
    items.push(createStaticAction(
      'action:clear-queue',
      'Clear Actions',
      'i_noaction',
      context.clearQueuedActions,
    ));
  }

  items.push({
    kind: 'submenu',
    id: 'submenu:screens',
    label: 'Screens',
    revalidate: () => true,
    buildMenu: () => createMenu(
      `${context.id.trim()}:screens`,
      'Screens',
      SCREEN_ACTIONS.map((route) =>
        createStaticAction(route.id, route.label, route.icon, context[route.callback])),
    ),
  });

  // VR-only, so there is no authored KOTOR icon to point at; the fallback is
  // the correct outcome rather than a missing-texture warning.
  items.push(createStaticAction(
    'menu:comfort-settings',
    'Comfort Settings',
    undefined,
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

/**
 * `icon` is optional: a VR-only entry with no authored KOTOR icon takes the
 * deterministic fallback silently, whereas naming a resref that does not exist
 * both logs a load failure every time the wheel opens and lands on the same
 * fallback anyway.
 */
function createStaticAction(
  id: string,
  label: string,
  icon: string | undefined,
  activate: () => void,
): VRRadialActionItem {
  return {
    kind: 'action',
    id,
    label,
    ...(icon === undefined ? {} : { icon }),
    revalidate: () => true,
    activate,
  };
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
  for (const callback of MENU_CALLBACKS) {
    if (typeof context[callback] !== 'function') {
      throw new TypeError(`${callback} must be callable`);
    }
  }
  if (typeof context.clearQueuedActions !== 'function') {
    throw new TypeError('clearQueuedActions must be callable');
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
