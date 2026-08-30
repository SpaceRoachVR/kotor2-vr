import type { LegacyGUIVRPointerSemanticTarget } from './LegacyGUIVRPointerAdapter';

interface LegacyGUIListControl {
  readonly list?: {
    getVRPointerTargetsAtPointer?: () => readonly LegacyGUIVRPointerSemanticTarget[];
  };
}

/**
 * Finds semantic targets through the live controls exposed by GameState's
 * normal menu hit-testing route. This intentionally does not inspect menu
 * types: dialogue and computer reply rows remain authored GUI list controls.
 */
export function getLegacyGUIVRPointerSemanticTargets(
  getActiveControls: () => readonly LegacyGUIListControl[],
): readonly LegacyGUIVRPointerSemanticTarget[] {
  const lists = new Set<NonNullable<LegacyGUIListControl['list']>>();
  for (const control of getActiveControls()) {
    const list = control.list;
    if (typeof list?.getVRPointerTargetsAtPointer === 'function') lists.add(list);
  }
  return [...lists].flatMap((list) => list.getVRPointerTargetsAtPointer!());
}
