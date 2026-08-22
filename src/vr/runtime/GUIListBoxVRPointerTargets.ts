import * as THREE from 'three';
import type {
  LegacyGUIVRPointerControl,
  LegacyGUIVRPointerSemanticTarget,
} from './LegacyGUIVRPointerAdapter';

export interface GUIListBoxVRPointerRow extends LegacyGUIVRPointerControl {
  readonly disableSelection: boolean;
  readonly box: THREE.Box2;
}

interface GUIListBoxVRPointerArrow {
  readonly visible: boolean;
  readonly userData: { readonly box?: THREE.Box2 };
}

interface GUIListBoxVRPointerScrollBar {
  readonly upArrow?: GUIListBoxVRPointerArrow;
  readonly downArrow?: GUIListBoxVRPointerArrow;
}

/** Structural contract implemented by GUIListBox without coupling XR tests to renderer setup. */
export interface GUIListBoxVRPointerTargetSource extends LegacyGUIVRPointerControl {
  readonly children: readonly GUIListBoxVRPointerRow[];
  readonly maxScroll: number;
  readonly scrollWrapper?: { readonly visible: boolean };
  readonly scrollbar?: GUIListBoxVRPointerScrollBar;
  select(row: GUIListBoxVRPointerRow): void;
  scrollUp(): void;
  scrollDown(): void;
}

/**
 * Produces authored list-row and arrow actions for the current mouse/ray
 * position. The callback keeps availability live when a target is latched
 * then the underlying panel changes before trigger release.
 */
export function getGUIListBoxVRPointerTargetsAtPointer(
  list: GUIListBoxVRPointerTargetSource,
  getPointerPosition: () => THREE.Vector2,
): readonly LegacyGUIVRPointerSemanticTarget[] {
  if (!list.isVisible()) return [];

  const targets: LegacyGUIVRPointerSemanticTarget[] = [];
  for (let index = 0; index < list.children.length; index++) {
    const row = list.children[index];
    if (!isSelectableRowAtPointer(row, getPointerPosition())) continue;
    targets.push({
      name: `${list.name} row ${index + 1}`,
      control: row,
      isAvailable: () => isSelectableRowAtPointer(row, getPointerPosition()),
      activate: () => list.select(row),
    });
  }

  const scrollbarVisible = list.maxScroll > 0 && list.scrollWrapper?.visible === true;
  const upArrow = list.scrollbar?.upArrow;
  if (scrollbarVisible && isArrowAtPointer(upArrow, getPointerPosition())) {
    targets.push({
      name: `${list.name} scroll up`,
      control: list,
      isAvailable: () => list.maxScroll > 0 && list.scrollWrapper?.visible === true &&
        isArrowAtPointer(upArrow, getPointerPosition()),
      activate: () => list.scrollUp(),
    });
  }

  const downArrow = list.scrollbar?.downArrow;
  if (scrollbarVisible && isArrowAtPointer(downArrow, getPointerPosition())) {
    targets.push({
      name: `${list.name} scroll down`,
      control: list,
      isAvailable: () => list.maxScroll > 0 && list.scrollWrapper?.visible === true &&
        isArrowAtPointer(downArrow, getPointerPosition()),
      activate: () => list.scrollDown(),
    });
  }

  return targets;
}

function isSelectableRowAtPointer(row: GUIListBoxVRPointerRow, pointer: THREE.Vector2): boolean {
  return row.isVisible() && !row.disableSelection && row.box.containsPoint(pointer);
}

function isArrowAtPointer(
  arrow: GUIListBoxVRPointerArrow | undefined,
  pointer: THREE.Vector2,
): boolean {
  return arrow?.visible === true && arrow.userData.box?.containsPoint(pointer) === true;
}
