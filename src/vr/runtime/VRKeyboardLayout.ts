export interface VRKeyboardKey {
  readonly label: string;
  readonly value: string;
  /** Horizontal keyboard-grid units, where the full keyboard is ten units wide. */
  readonly x: number;
  /** Vertical keyboard-grid units, where each row is one unit high. */
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const LETTER_ROWS = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'] as const;

export const VR_KEYBOARD_LAYOUT: readonly VRKeyboardKey[] = Object.freeze([
  ...LETTER_ROWS.flatMap((letters, row) => {
    const xOffset = row === 0 ? 0 : row === 1 ? 0.5 : 1.5;
    return [...letters].map((letter, column) => ({
      label: letter,
      value: letter,
      x: xOffset + column,
      y: row,
      width: 1,
      height: 1,
    }));
  }),
  { label: 'SPACE', value: 'SPACE', x: 0.4, y: 3, width: 4.4, height: 1 },
  { label: 'BACK', value: 'BACKSPACE', x: 5, y: 3, width: 2.2, height: 1 },
  // Without this the keyboard never goes away: it opens for any editable field
  // on the foreground menu and owns the controller ray for as long as it is
  // up, so the panel's own Accept/Back buttons underneath cannot be reached.
  { label: 'DONE', value: 'DONE', x: 7.4, y: 3, width: 2.2, height: 1 },
]);

/** Finishes text entry and hands the controller ray back to the panel. */
export const VR_KEYBOARD_DONE_KEY = 'DONE';

/** Maps a plane UV to one deliberately-sized virtual keyboard key. */
export function resolveVRKeyboardKeyAtUV(u: number, v: number): string | null {
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
    return null;
  }
  const x = u * 10;
  const y = (1 - v) * 4;
  const key = VR_KEYBOARD_LAYOUT.find((candidate) =>
    x >= candidate.x && x < candidate.x + candidate.width &&
    y >= candidate.y && y < candidate.y + candidate.height
  );
  return key?.value ?? null;
}
