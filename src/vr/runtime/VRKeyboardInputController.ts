export interface VRKeyboardTextSink {
  onKeyDown(event: { readonly which: number; readonly shiftKey: boolean }): void;
}

/** Persistent keyboard modifier state consumed by the host's visible latches. */
export interface VRKeyboardState {
  readonly shift: boolean;
  readonly capsLock: boolean;
}

const KEY_CODES: Readonly<Record<string, number>> = Object.freeze({
  BACKSPACE: 8,
  SPACE: 32,
});

/** Converts validated virtual-key presses into the legacy editable-label input API. */
export class VRKeyboardInputController {
  private shift = false;
  private capsLock = false;

  get state(): VRKeyboardState {
    return Object.freeze({ shift: this.shift, capsLock: this.capsLock });
  }

  press(key: string, sink: VRKeyboardTextSink): void {
    if (!sink || typeof sink.onKeyDown !== 'function') {
      throw new TypeError('VR keyboard text sink must expose onKeyDown');
    }
    const normalizedKey = key.trim().toUpperCase();
    if (normalizedKey === 'SHIFT') {
      this.shift = !this.shift;
      return;
    }
    if (normalizedKey === 'CAPS') {
      this.capsLock = !this.capsLock;
      return;
    }
    const which = KEY_CODES[normalizedKey] ?? VRKeyboardInputController.letterCode(normalizedKey);
    const isLetter = /^[A-Z]$/.test(normalizedKey);
    const shiftKey = isLetter && this.shift !== this.capsLock;
    sink.onKeyDown({ which, shiftKey });
    if (isLetter) this.shift = false;
  }

  reset(): void {
    this.shift = false;
    this.capsLock = false;
  }

  private static letterCode(key: string): number {
    if (!/^[A-Z0-9]$/.test(key)) {
      throw new RangeError(`unsupported VR keyboard key '${key}'`);
    }
    return key.charCodeAt(0);
  }
}
