import { ModuleObjectType } from '@/enums/module/ModuleObjectType';

export interface CombatTargetClassification {
  readonly objectType?: unknown;
}

/**
 * VR automatically clears only combat against inanimate world objects. A
 * creature target remains under the d20 combat loop and is never cancelled as
 * collateral damage from the world-object safety escape hatch.
 */
export function shouldAutoCancelNonCreatureCombat(target: CombatTargetClassification | null | undefined): boolean {
  const objectType = target?.objectType;
  if (typeof objectType !== 'number' || !Number.isInteger(objectType)) return false;
  return (objectType & ModuleObjectType.ModuleCreature) === 0;
}
