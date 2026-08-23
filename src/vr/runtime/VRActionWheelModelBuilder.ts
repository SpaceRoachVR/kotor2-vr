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
  /**
   * Which `ActionMenuManager` panel this came from. Carried through because the
   * panel *is* the categorisation (ROADMAP 4.8): `UpdateActionMenus` puts Attack
   * and the equipped-weapon attack-mode feats in target panel 0 and hostile
   * Force powers in target panel 1, and friendly powers in self panel 1. The
   * wheel used to flatten all of it into one top-level list, throwing that away
   * and then paginating.
   */
  readonly panelIndex: number;
  revalidate(): boolean;
  activate(): void;
}

/** Target panel 0: Attack plus the feats filtered by `getEquippedWeaponType()`. */
const ATTACK_PANEL_INDEX = 0;
/** Target panel 1 (hostile) and self panel 1 (friendly) are both Force powers. */
const FORCE_POWER_PANEL_INDEX = 1;

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
  /**
   * True only when the aimed target is a hostile creature — the sole case in
   * which `ActionMenuManager` fills the target panels with combat actions.
   *
   * For anything else (a door, a container, a trap) those same panel indices
   * carry Security, Bash, Open, and mine Disarm/Recover, which are world
   * actions and must stay at the top level rather than being filed under
   * "Attacks". The two cases never co-occur, because the engine builds its
   * target panels for whichever single `oTarget` is current — which is why the
   * combat top level is exactly six items and never paginates.
   */
  readonly targetIsHostileCreature: boolean;
  readonly partyMembers: readonly VRActionWheelPartyMember[];
  readonly openComfortSettings: () => void;
  /**
   * Opens the engine's in-game menu on the Character tab.
   *
   * One wedge replaces eight. The wheel used to spend three top-level wedges
   * (Inventory, Character, Map) plus a five-item Screens submenu on what is one
   * menu with a tab bar: every one of the eight screens sets
   * `childMenu = MenuTop` in `MenuManager`, `GameMenu.show()` shows the child,
   * and `getActiveControls()` includes the child's controls — so the tab bar is
   * up and clickable the moment any screen opens. The player switches tabs
   * there rather than reopening the wheel.
   */
  readonly openMenu: () => void;
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
  'openComfortSettings' | 'openMenu'
>;

const MENU_CALLBACKS: readonly VRActionWheelMenuCallback[] = ['openComfortSettings', 'openMenu'];

/** Builds an immutable, engine-independent snapshot in deterministic route order. */
export function buildVRActionWheel(context: VRActionWheelBuildContext): VRRadialMenuDefinition {
  validateBuildContext(context);

  const items: VRRadialContentItem[] = [];
  const engineIds = new Set<string>();
  const rootId = context.id.trim();
  const hostile = context.targetIsHostileCreature === true;

  // Combat splits into two submenus over the panels the engine already
  // filtered. Non-combat target actions (Security, Bash, Open, mine
  // Disarm/Recover) stay at the top level, where the player expects to reach
  // them in one press.
  const combatTargetActions = hostile ? context.targetActions : [];
  const worldTargetActions = hostile ? [] : context.targetActions;

  const attackActions = actionsFromPanel(combatTargetActions, ATTACK_PANEL_INDEX);
  const forcePowerActions = [
    ...actionsFromPanel(combatTargetActions, FORCE_POWER_PANEL_INDEX),
    ...actionsFromPanel(context.selfActions, FORCE_POWER_PANEL_INDEX),
  ];

  appendSubmenuOfEngineActions(items, {
    id: 'submenu:attacks',
    label: 'Attacks',
    icon: 'i_attack',
    menuId: `${rootId}:attacks`,
    actions: attackActions,
  });

  appendSubmenuOfEngineActions(items, {
    id: 'submenu:force-powers',
    label: 'Force Powers',
    // The Abilities tab icon, where Force powers live. `ip_forcepower` looks
    // like it should exist and does not — naming a missing resref logs a load
    // failure every time the wheel opens and lands on the same fallback anyway.
    icon: 'lbl_icn_abi2',
    menuId: `${rootId}:force-powers`,
    actions: forcePowerActions,
  });

  // Anything the engine produced that the two combat panels did not claim:
  // world actions when the target is not hostile, and any future panel this
  // build does not know about. Dropping them silently would make an authored
  // action unreachable, which is worse than an extra wedge.
  appendEngineActions(items, worldTargetActions, engineIds);
  appendEngineActions(
    items,
    context.selfActions.filter((action) => readPanelIndex(action) !== FORCE_POWER_PANEL_INDEX),
    engineIds,
  );
  if (hostile) {
    appendEngineActions(
      items,
      context.targetActions.filter((action) => {
        const panel = readPanelIndex(action);
        return panel !== ATTACK_PANEL_INDEX && panel !== FORCE_POWER_PANEL_INDEX;
      }),
      engineIds,
    );
  }

  items.push(createStaticAction('menu:screens', 'Menu', 'lbl_icn_char2', context.openMenu));

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

/**
 * A missing or malformed `panelIndex` must not silently land in a combat page.
 * `NaN` matches no panel constant, so such an action falls through to the
 * top-level catch-all instead of being filed under a category it may not
 * belong to.
 */
function readPanelIndex(action: VRActionWheelEngineAction): number {
  const panelIndex = action?.panelIndex;
  return Number.isInteger(panelIndex) ? (panelIndex as number) : Number.NaN;
}

function actionsFromPanel(
  actions: readonly VRActionWheelEngineAction[],
  panelIndex: number,
): readonly VRActionWheelEngineAction[] {
  return actions.filter((action) => readPanelIndex(action) === panelIndex);
}

/**
 * Adds a combat submenu, but only when it has at least one currently valid
 * action. An empty wedge would be a control that does nothing — and worse, an
 * empty menu fails `validateVRRadialMenu`'s "at least one page" rule with a
 * `RangeError`, which would take the whole wheel down mid-fight.
 */
function appendSubmenuOfEngineActions(
  output: VRRadialContentItem[],
  submenu: {
    readonly id: string;
    readonly label: string;
    readonly icon: string;
    readonly menuId: string;
    readonly actions: readonly VRActionWheelEngineAction[];
  },
): void {
  const buildItems = (): VRRadialContentItem[] => {
    const items: VRRadialContentItem[] = [];
    appendEngineActions(items, submenu.actions, new Set<string>());
    return items;
  };

  if (buildItems().length === 0) return;

  output.push({
    kind: 'submenu',
    id: submenu.id,
    label: submenu.label,
    icon: submenu.icon,
    revalidate: () => buildItems().length > 0,
    // Called lazily when the submenu opens, so the page re-snapshots the
    // engine's validity then rather than when the wheel was first opened.
    buildMenu: () => createMenu(submenu.menuId, submenu.label, buildItems()),
  });
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
    Number.isInteger(action.panelIndex) &&
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
