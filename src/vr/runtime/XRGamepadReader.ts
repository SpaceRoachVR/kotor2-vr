import { XRButtonState, XRHandRole } from './XRTypes';
import { XRControllerSnapshot } from './XRInputRouter';
import { XRInputCapabilitySnapshot } from '../input/XRInputCapabilityValidator';

type CapabilityGamepad = Gamepad & {
  readonly hapticActuators?: readonly { pulse?: unknown }[];
};

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

  static readCapabilities(inputSources: readonly XRInputSource[]): readonly XRInputCapabilitySnapshot[] {
    const capabilities: XRInputCapabilitySnapshot[] = [];
    for (const source of inputSources) {
      if ((source.handedness !== 'left' && source.handedness !== 'right') || !source.gamepad) continue;
      const gamepad = source.gamepad as CapabilityGamepad;
      const vibrationActuator = (gamepad as Gamepad & { readonly vibrationActuator?: unknown }).vibrationActuator;
      const hasPulseActuator = gamepad.hapticActuators?.some((actuator) =>
        typeof actuator?.pulse === 'function'
      ) ?? false;
      capabilities.push({
        hand: source.handedness,
        profiles: [...source.profiles],
        targetRayMode: source.targetRayMode,
        gamepadMapping: gamepad.mapping,
        buttonCount: gamepad.buttons.length,
        axisCount: gamepad.axes.length,
        hasGripSpace: source.gripSpace !== undefined,
        haptics: hasPulseActuator || vibrationActuator !== null && vibrationActuator !== undefined
          ? 'pulse'
          : 'none',
      });
    }
    return capabilities;
  }
}
