import { COLOUR_SLOT } from '@/game/tsl/crafting/UpgradeRules';
import type { SlotView, UpgradePart } from '@/game/tsl/crafting/UpgradeSession';
import { LimitProperty, UseLimit, alignmentLimitsOf, meetsUseLimits } from '@/engine/rules/ItemUseLimits';

/**
 * The upgrade parts an item will carry once its staged changes are
 * assembled: in each slot the staged part over the installed one, nothing
 * where a removal is staged. The colour slot is left out: a colour crystal
 * only sets the blade's ModelVariation and never joins the item's
 * properties (ModuleItem.getEffectiveProperties reads UpgradeSlotN only).
 */
export function partsAfterStaging(slots: readonly SlotView[]): UpgradePart[] {
  const parts: UpgradePart[] = [];
  for (const slot of slots) {
    if (slot.type === COLOUR_SLOT) continue;
    const part = slot.staged === null ? undefined : (slot.staged ?? slot.installed);
    if (part) parts.push(part);
  }
  return parts;
}

/**
 * The alignment use limits of the item after staging: its own properties
 * (isUseable() only, as InventoryManager.isItemUsableBy reads them) plus
 * every part's properties (installed parts always apply).
 */
export function useLimitsAfterStaging(
  ownProperties: readonly LimitProperty[],
  slots: readonly SlotView[],
  propertiesOf: (part: UpgradePart) => readonly LimitProperty[] | undefined,
): UseLimit[] {
  const limits = alignmentLimitsOf(ownProperties);
  for (const part of partsAfterStaging(slots)) limits.push(...alignmentLimitsOf(propertiesOf(part), true));
  return limits;
}

/**
 * Whether `wearer` can still use the item once the staged changes are
 * assembled. An item nobody wears is not checked here (true): the equipment
 * lists filter it when someone tries to equip it.
 */
export function wearerCanUseAfterStaging(
  wearer: { goodEvil: number } | undefined,
  ownProperties: readonly LimitProperty[],
  slots: readonly SlotView[],
  propertiesOf: (part: UpgradePart) => readonly LimitProperty[] | undefined,
): boolean {
  if (!wearer) return true;
  return meetsUseLimits(useLimitsAfterStaging(ownProperties, slots, propertiesOf), wearer);
}
