import { ModuleCreatureArmorSlot } from "@/enums/module/ModuleCreatureArmorSlot";

/**
 * How each equipment slot maps onto `ModuleCreature.equipment` and onto the
 * model node its item hangs from.
 *
 * `ModuleCreature.equipment` is keyed by NAME while every caller — the
 * equipment menu, `equipItem`, `unequipSlot`, NWScript — speaks the numeric
 * `ModuleCreatureArmorSlot` mask, so the mapping has to live somewhere. It is
 * here, as data, because the hand-written switch it replaces had drifted:
 * `RIGHTARMBAND` appeared twice (the second case dead), and `BELT` detached
 * its model from `model.rhand`, which is the right *hand* node and never held
 * a belt.
 */
export type EquipmentAttachNode = 'rhand' | 'lhand' | 'parent';

export interface EquipmentSlotRule {
  /** Property name on `ModuleCreature.equipment`. */
  readonly key: string;
  /** Model node the item is attached to, if any. */
  readonly attach?: EquipmentAttachNode;
  /** Whether unequipping destroys the item's model. */
  readonly destroyOnUnequip: boolean;
  /** Whether unequipping requires the creature model to be rebuilt. */
  readonly reloadModelOnUnequip: boolean;
}

const RULES: ReadonlyMap<number, EquipmentSlotRule> = new Map([
  [ModuleCreatureArmorSlot.IMPLANT, { key: 'IMPLANT', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.HEAD, { key: 'HEAD', attach: 'parent', destroyOnUnequip: false, reloadModelOnUnequip: true }],
  [ModuleCreatureArmorSlot.ARMS, { key: 'ARMS', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.RIGHTARMBAND, { key: 'RIGHTARMBAND', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.LEFTARMBAND, { key: 'LEFTARMBAND', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.ARMOR, { key: 'ARMOR', destroyOnUnequip: false, reloadModelOnUnequip: true }],
  [ModuleCreatureArmorSlot.RIGHTHAND, { key: 'RIGHTHAND', attach: 'rhand', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.LEFTHAND, { key: 'LEFTHAND', attach: 'lhand', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.RIGHTHAND2, { key: 'RIGHTHAND2', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.LEFTHAND2, { key: 'LEFTHAND2', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.BELT, { key: 'BELT', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.HIDE, { key: 'HIDE', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.CLAW1, { key: 'CLAW1', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.CLAW2, { key: 'CLAW2', destroyOnUnequip: true, reloadModelOnUnequip: false }],
  [ModuleCreatureArmorSlot.CLAW3, { key: 'CLAW3', destroyOnUnequip: true, reloadModelOnUnequip: false }],
]);

/** The rule for one slot mask, or undefined for a mask that names no slot. */
export function resolveEquipmentSlotRule(slot: number): EquipmentSlotRule | undefined {
  return RULES.get(slot);
}

/** The `equipment` property name for one slot mask. */
export function equipmentKeyForSlot(slot: number): string | undefined {
  return RULES.get(slot)?.key;
}

/** Every slot mask the equipment system understands. */
export function equipmentSlotMasks(): number[] {
  return Array.from(RULES.keys());
}
