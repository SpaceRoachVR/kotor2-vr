export interface GUIFeatActor {
  getHasFeat(featId: number): boolean;
}

type MenuWithCreature = {
  creature?: unknown;
};

function isGUIFeatActor(value: unknown): value is GUIFeatActor {
  return Boolean(value) && typeof (value as GUIFeatActor).getHasFeat === 'function';
}

/**
 * Character-creation menus supply an actor that is not yet registered as the
 * in-world player. Normal ability menus do not, so they fall back to the
 * current player. Invalid candidates are intentionally ignored rather than
 * allowing GUI construction to dereference an incomplete object.
 */
export function resolveGUIFeatActor(
  menu: unknown,
  currentPlayer: unknown,
): GUIFeatActor | undefined {
  const menuCreature = menu && typeof menu === 'object'
    ? (menu as MenuWithCreature).creature
    : undefined;
  if (isGUIFeatActor(menuCreature)) return menuCreature;
  if (isGUIFeatActor(currentPlayer)) return currentPlayer;
  return undefined;
}
