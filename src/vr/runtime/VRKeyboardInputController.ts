export interface VRKeyboardTextSink {
  onKeyDown(event: { readonly which: number; readonly shiftKey: boolean }): void;
}

const KEY_CODES: Readonly<Record<string, number>> = Object.freeze({
  BACKSPACE: 8,
  SPACE: 32,
});

/** Converts validated virtual-key presses into the legacy editable-label input API. */
export class VRKeyboardInputController {
  press(key: string, sink: VRKeyboardTextSink): void {
    if (!sink || typeof sink.onKeyDown !== 'function') {
      throw new TypeError('VR keyboard text sink must expose onKeyDown');
    }
    const normalizedKey = key.trim().toUpperCase();
    const which = KEY_CODES[normalizedKey] ?? VRKeyboardInputController.letterCode(normalizedKey);
    sink.onKeyDown({ which, shiftKey: false });
  }

  private static letterCode(key: string): number {
    if (!/^[A-Z0-9]$/.test(key)) {
      throw new RangeError(`unsupported VR keyboard key '${key}'`);
    }
    return key.charCodeAt(0);
  }
}
