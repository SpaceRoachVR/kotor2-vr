import { VRPanelMenuController } from './VRPanelInputController';

/**
 * Gives the legacy in-game action HUD temporary modal ownership in VR.
 * Pointer activation still invokes the HUD's original controls and action queue.
 */
export class VRContextActionPanelController implements VRPanelMenuController {
  private activeTargetId: string | null = null;

  constructor(private readonly delegate: VRPanelMenuController) {
    VRContextActionPanelController.validateDelegate(delegate);
  }

  get isOpen(): boolean {
    return this.activeTargetId !== null;
  }

  open(targetId: string): void {
    VRContextActionPanelController.validateTargetId(targetId);
    this.activeTargetId = targetId;
  }

  close(): void {
    this.activeTargetId = null;
  }

  resolve(targetId: string, hasActions: boolean): VRContextActionPanelController | null {
    VRContextActionPanelController.validateTargetId(targetId);
    if (!hasActions || this.activeTargetId !== targetId) {
      this.close();
      return null;
    }
    return this;
  }

  triggerControllerAPress(): void {
    this.delegate.triggerControllerAPress();
  }

  triggerControllerBPress(): void {
    this.close();
  }

  triggerControllerXPress(): void {
    this.delegate.triggerControllerXPress();
  }

  triggerControllerYPress(): void {
    this.delegate.triggerControllerYPress();
  }

  private static validateTargetId(targetId: string): void {
    if (typeof targetId !== 'string' || targetId.trim().length === 0) {
      throw new TypeError('targetId must be a non-empty string');
    }
  }

  private static validateDelegate(delegate: VRPanelMenuController): void {
    if (!delegate || typeof delegate !== 'object') {
      throw new TypeError('panel delegate is required');
    }
    for (const method of [
      'triggerControllerAPress',
      'triggerControllerBPress',
      'triggerControllerXPress',
      'triggerControllerYPress',
    ] as const) {
      if (typeof delegate[method] !== 'function') {
        throw new TypeError(`panel delegate must implement ${method}`);
      }
    }
  }
}
