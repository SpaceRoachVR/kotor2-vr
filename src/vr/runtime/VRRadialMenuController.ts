import { RoutedXRAction } from './XRInputRouter';
import { SemanticXRAction } from './XRTypes';

export interface VRRadialMenuItem {
  readonly id: string;
  readonly label: string;
  /** Engine icon resref, when the authored action supplies one. */
  readonly icon?: string;
  activate(): void;
}

export interface VRRadialPointerVector {
  readonly x: number;
  readonly y: number;
}

/**
 * Four-way controller radial: hold the trigger action, flick the stick, then
 * release it. The trigger action defaults to Menu (the target/contextual
 * action radial) but is configurable so an independent instance can be
 * bound to a different button — e.g. Wrist, for a wrist-device menu that
 * summons full panels rather than contextual target actions.
 */
export class VRRadialMenuController {
  private openState = false;
  private selectedIndex = 0;
  private menuHeld = false;
  private cancelHeld = false;
  private hasSelection = false;

  constructor(private readonly triggerAction: SemanticXRAction = SemanticXRAction.Menu) {}

  get isOpen(): boolean { return this.openState; }
  get selected(): number { return this.selectedIndex; }

  process(
    items: readonly VRRadialMenuItem[],
    actions: readonly RoutedXRAction[],
    pointerVector: VRRadialPointerVector | null = null
  ): boolean {
    VRRadialMenuController.validateItems(items);
    const ownedAtStart = this.openState;
    const menuPressed = actions.some((action) =>
      action.action === this.triggerAction && action.pressed
    );
    if (menuPressed && !this.menuHeld) {
      this.openState = true;
      this.selectedIndex = 0;
      this.hasSelection = false;
    }
    if (!this.openState) {
      this.menuHeld = menuPressed;
      return ownedAtStart;
    }

    const turn = actions.find((action) => action.action === SemanticXRAction.Turn && action.axes);
    const selection = VRRadialMenuController.validSelectionVector(pointerVector)
      ? pointerVector
      : turn?.axes && Math.hypot(turn.axes[0], turn.axes[1]) > 0.65
        ? { x: turn.axes[0], y: turn.axes[1] }
        : null;
    if (selection) {
      this.selectedIndex = VRRadialMenuController.indexForAxes(selection.x, selection.y, items.length);
      this.hasSelection = true;
    }
    const cancelPressed = actions.some((action) => action.action === SemanticXRAction.Cancel && action.pressed);
    if (cancelPressed && !this.cancelHeld) {
      this.openState = false;
      this.hasSelection = false;
    }
    this.cancelHeld = cancelPressed;

    // Population: One-style commitment: the menu only fires after the user
    // has aimed at a quadrant and releases the hold button. A neutral release
    // is a cancel, never a hidden default action.
    if (!menuPressed && this.menuHeld && this.openState && this.hasSelection) {
      items[this.selectedIndex].activate();
      this.openState = false;
      this.hasSelection = false;
    } else if (!menuPressed && this.menuHeld) {
      this.openState = false;
    }
    this.menuHeld = menuPressed;
    return ownedAtStart || this.openState;
  }

  close(): void {
    this.openState = false;
    this.menuHeld = false;
    this.cancelHeld = false;
    this.hasSelection = false;
  }

  private static indexForAxes(x: number, y: number, itemCount: number): number {
    const angle = Math.atan2(-y, x);
    const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
    return Math.floor((normalized + Math.PI / 4) / (Math.PI / 2)) % itemCount;
  }

  private static validSelectionVector(value: VRRadialPointerVector | null): value is VRRadialPointerVector {
    return value !== null &&
      Number.isFinite(value.x) &&
      Number.isFinite(value.y) &&
      Math.hypot(value.x, value.y) > 0.2;
  }

  private static validateItems(items: readonly VRRadialMenuItem[]): void {
    if (items.length !== 4 || items.some((item) => !item.id.trim() || !item.label.trim() || typeof item.activate !== 'function')) {
      throw new TypeError('radial menu requires four valid items');
    }
  }
}
