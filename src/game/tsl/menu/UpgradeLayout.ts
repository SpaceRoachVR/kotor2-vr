import { COLOUR_SLOT, upgradeTypeName } from "@/game/tsl/crafting/UpgradeRules";

export type UpgradeLayout = 'standard' | 'lightsaber';

export interface LayoutRect { left: number; top: number; width: number; height: number }

/** The slot-control suffixes of upgrade_p, in slot order, for a layout. */
export function slotControlNames(layout: UpgradeLayout): string[] {
  return layout === 'lightsaber'
    ? ['31_LS', '32_LS', '33_LS', '34_LS', '35_LS', '36_LS']
    : ['31', '32', '33'];
}

/** Whether a GUI control key is hidden in `layout` (the other layout's controls, 3D_MODEL). */
export function hiddenInLayout(key: string, layout: UpgradeLayout): boolean {
  if (/(^|_)3D_MODEL$/.test(key)) return true;
  if (/(^|_)3D_MODEL_LS$/.test(key)) return layout !== 'lightsaber';
  if (/^(BTN|LBL)_UPGRADE\d+_LS$/.test(key)) return layout !== 'lightsaber';
  if (/^(BTN|LBL)_UPGRADE\d+$/.test(key)) return layout === 'lightsaber';
  if (key === 'LBL_PROPERTY') return layout === 'lightsaber';
  return false;
}

/**
 * LB_ITEMS's height so its rows stay clear of the slot buttons: it ends
 * `gap` above the topmost button it overlaps (every button counts when
 * `anyButton` is set), and is the list's own height when none overlaps or the
 * cut would not shorten it.
 */
export function fittedListHeight(list: LayoutRect, buttons: LayoutRect[], gap: number, anyButton = false): number {
  let top = Infinity;
  for (const b of buttons) {
    const overlaps = anyButton || (
      b.left < list.left + list.width && b.left + b.width > list.left &&
      b.top < list.top + list.height && b.top + b.height > list.top);
    if (overlaps) top = Math.min(top, b.top);
  }
  if (!isFinite(top)) return list.height;
  const height = top - list.top - gap;
  return height <= 0 || height >= list.height ? list.height : height;
}

/** Whether a slot's list offers a Remove row (never for the colour crystal). */
export function offersRemove(slotType: number, shown: boolean): boolean {
  return shown && slotType !== COLOUR_SLOT;
}

/** LBL_SLOTNAME text: the slot type and its part; an unknown colour reads Unknown. */
export function slotNameText(slotType: number, partName: string | undefined, emptyText: string): string {
  const fallback = slotType === COLOUR_SLOT ? 'Unknown' : emptyText;
  return `${upgradeTypeName(slotType)}: ${partName ?? fallback}`;
}

/**
 * LB_ITEMS's top and height. Standard: the original top, cut above the
 * reference slot button (fittedListHeight). Lightsaber: the _LS buttons and
 * the preview sit inside the list's retail extent, so the list moves below
 * LBL_SLOTNAME (`gap` under it) and keeps the original bottom edge.
 */
export function fittedListExtent(
  original: LayoutRect, slotButton: LayoutRect | undefined, slotName: LayoutRect | undefined,
  gap: number, lightsaber: boolean,
): { top: number; height: number } {
  if (lightsaber && slotName) {
    const top = slotName.top + slotName.height + gap;
    const height = original.top + original.height - top;
    return height > 0 ? { top, height } : { top: original.top, height: original.height };
  }
  const height = slotButton ? fittedListHeight(original, [slotButton], gap, true) : original.height;
  return { top: original.top, height };
}
