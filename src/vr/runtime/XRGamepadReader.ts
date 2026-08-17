import { XRButtonState, XRHandRole } from './XRTypes';
import { XRControllerSnapshot } from './XRInputRouter';

/** Copies transient WebXR Gamepad state into an immutable per-frame snapshot. */
export class XRGamepadReader {
  static read(inputSources: readonly XRInputSource[]): readonly XRControllerSnapshot[] {
    const controllers: XRControllerSnapshot[] = [];
    for (const source of inputSources) {
      if ((source.handedness !== 'left' && source.handedness !== 'right') || !source.gamepad) {
        continue;
      }
      const hand = source.handedness as XRHandRole;
      const buttons: XRButtonState[] = Array.from(source.gamepad.buttons, (button) => ({
        pressed: !!button.pressed,
        touched: !!button.touched,
        value: Number.isFinite(button.value)
          ? Math.min(1, Math.max(0, button.value))
          : 0,
      }));
      const axes = Array.from(source.gamepad.axes, (axis) =>
        Number.isFinite(axis) ? Math.min(1, Math.max(-1, axis)) : 0
      );
      controllers.push({
        hand,
        profiles: [...source.profiles],
        buttons,
        axes,
      });
    }
    return controllers;
  }
}
