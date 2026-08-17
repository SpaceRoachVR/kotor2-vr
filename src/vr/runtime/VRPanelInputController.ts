import { RoutedXRAction } from './XRInputRouter';
import { SemanticXRAction } from './XRTypes';
import * as THREE from 'three';

export interface VRPanelMenuController {
  triggerControllerAPress(): void;
  triggerControllerBPress(): void;
  triggerControllerXPress(): void;
  triggerControllerYPress(): void;
}

export interface VRPanelPointerSink {
  setPointerPosition(position: THREE.Vector2 | null): void;
  activatePointer(): boolean;
}

type PanelButton = 'select' | 'a' | 'b' | 'x' | 'y';

const ACTION_TO_BUTTON: Readonly<Partial<Record<SemanticXRAction, PanelButton>>> = {
  [SemanticXRAction.Select]: 'select',
  [SemanticXRAction.Use]: 'a',
  [SemanticXRAction.Cancel]: 'b',
  [SemanticXRAction.Wrist]: 'x',
  [SemanticXRAction.Menu]: 'y',
};

/**
 * Gives a visible VR menu exclusive controller ownership without allowing the
 * press that opened the menu to leak through to its default action.
 */
export class VRPanelInputController {
  private owner: VRPanelMenuController | null = null;
  private awaitingRelease = false;
  private readonly previousPressed = new Map<PanelButton, boolean>();

  process(
    owner: VRPanelMenuController | null,
    actions: readonly RoutedXRAction[],
    pointerPosition: THREE.Vector2 | null = null,
    pointerSink: VRPanelPointerSink | null = null
  ): boolean {
    pointerSink?.setPointerPosition(pointerPosition);
    const pressed = VRPanelInputController.readPressed(actions);
    if (!owner) {
      this.cancel();
      return false;
    }

    if (owner !== this.owner) {
      this.owner = owner;
      this.awaitingRelease = VRPanelInputController.anyPressed(pressed);
      this.copyPressed(pressed);
      return true;
    }

    if (this.awaitingRelease) {
      if (!VRPanelInputController.anyPressed(pressed)) {
        this.awaitingRelease = false;
      }
      this.copyPressed(pressed);
      return true;
    }

    for (const button of ['select', 'a', 'b', 'x', 'y'] as const) {
      if (pressed.get(button) && !this.previousPressed.get(button)) {
        VRPanelInputController.activate(
          owner,
          button,
          pointerPosition,
          pointerSink
        );
        break;
      }
    }
    this.copyPressed(pressed);
    return true;
  }

  cancel(): void {
    this.owner = null;
    this.awaitingRelease = false;
    this.previousPressed.clear();
  }

  private copyPressed(pressed: ReadonlyMap<PanelButton, boolean>): void {
    for (const button of ['select', 'a', 'b', 'x', 'y'] as const) {
      this.previousPressed.set(button, pressed.get(button) ?? false);
    }
  }

  private static readPressed(
    actions: readonly RoutedXRAction[]
  ): ReadonlyMap<PanelButton, boolean> {
    const pressed = new Map<PanelButton, boolean>();
    for (const action of actions) {
      const button = ACTION_TO_BUTTON[action.action];
      if (button && action.pressed) pressed.set(button, true);
    }
    return pressed;
  }

  private static anyPressed(pressed: ReadonlyMap<PanelButton, boolean>): boolean {
    return [...pressed.values()].some(Boolean);
  }

  private static activate(
    owner: VRPanelMenuController,
    button: PanelButton,
    pointerPosition: THREE.Vector2 | null,
    pointerSink: VRPanelPointerSink | null
  ): void {
    switch (button) {
      case 'select':
        if (pointerPosition && pointerSink) pointerSink.activatePointer();
        break;
      case 'a': owner.triggerControllerAPress(); break;
      case 'b': owner.triggerControllerBPress(); break;
      case 'x': owner.triggerControllerXPress(); break;
      case 'y': owner.triggerControllerYPress(); break;
    }
  }
}
