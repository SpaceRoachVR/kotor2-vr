/**
 * Stable parameter indices for ActionItemCastSpell.
 *
 * Item-cast actions use a different layout than ActionCastSpell. Keeping the
 * indices named prevents target and spell identifiers from being interpreted
 * as one another when an action is revalidated at execution time.
 */
export const ItemCastSpellParameter = Object.freeze({
  Target: 0,
  Area: 1,
  TargetX: 2,
  TargetY: 3,
  TargetZ: 4,
  SpellId: 5,
  CasterLevel: 6,
  Delay: 7,
  ProjectilePath: 8,
  ProjectileSpellId: 9,
  Item: 10,
  ImpactScript: 11,
} as const);

export type ItemCastSpellParameterIndex =
  (typeof ItemCastSpellParameter)[keyof typeof ItemCastSpellParameter];

export interface ItemCastSpellParameterWriter {
  setParameter(index: number, type: ActionParameterType, value: unknown): unknown;
}

export interface ItemCastSpellParameterValues {
  target: unknown;
  area: unknown;
  targetPosition: Readonly<{ x: number; y: number; z: number }>;
  spellId: number;
  casterLevel: number;
  delay: number;
  projectilePath: number;
  projectileSpellId: number;
  item: unknown;
  impactScript: string;
}

/**
 * Writes an item-cast action using its serialized parameter contract.
 */
export function writeItemCastSpellParameters(
  action: ItemCastSpellParameterWriter,
  values: Readonly<ItemCastSpellParameterValues>,
): void {
  action.setParameter(ItemCastSpellParameter.Target, ActionParameterType.DWORD, values.target);
  action.setParameter(ItemCastSpellParameter.Area, ActionParameterType.DWORD, values.area);
  action.setParameter(ItemCastSpellParameter.TargetX, ActionParameterType.FLOAT, values.targetPosition.x);
  action.setParameter(ItemCastSpellParameter.TargetY, ActionParameterType.FLOAT, values.targetPosition.y);
  action.setParameter(ItemCastSpellParameter.TargetZ, ActionParameterType.FLOAT, values.targetPosition.z);
  action.setParameter(ItemCastSpellParameter.SpellId, ActionParameterType.INT, values.spellId);
  action.setParameter(ItemCastSpellParameter.CasterLevel, ActionParameterType.INT, values.casterLevel);
  action.setParameter(ItemCastSpellParameter.Delay, ActionParameterType.FLOAT, values.delay);
  action.setParameter(ItemCastSpellParameter.ProjectilePath, ActionParameterType.INT, values.projectilePath);
  action.setParameter(ItemCastSpellParameter.ProjectileSpellId, ActionParameterType.INT, values.projectileSpellId);
  action.setParameter(ItemCastSpellParameter.Item, ActionParameterType.DWORD, values.item);
  action.setParameter(ItemCastSpellParameter.ImpactScript, ActionParameterType.STRING, values.impactScript);
}
import { ActionParameterType } from "@/enums/actions/ActionParameterType";
