export interface SelectablePlayerPosition {
  x: number;
  y: number;
  z: number;
}

export interface SelectablePlayerLike {
  position: SelectablePlayerPosition;
}

/** A module transition may enter INGAME one frame before party[0] is installed. */
export function hasSelectablePlayerPosition(player: unknown): player is SelectablePlayerLike {
  if (!player || typeof player !== 'object') return false;
  const position = (player as { position?: unknown }).position;
  if (!position || typeof position !== 'object') return false;
  const vector = position as Partial<SelectablePlayerPosition>;
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}
