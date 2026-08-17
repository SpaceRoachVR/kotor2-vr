import * as THREE from 'three';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import { resolveDisplayName } from './resolveDisplayName';

export interface VRWorldUseActor {
  readonly id: number;
  readonly position: THREE.Vector3;
}

export interface VRWorldUseTarget {
  readonly id: number;
  readonly objectType: number;
  readonly position: THREE.Vector3;
  getName?(): string;
  use(actor: VRWorldUseActor): void;
}

export interface VRWorldUseOutcome {
  readonly handled: boolean;
  readonly feedbackLabel?: string;
}

const PLACEABLE_USE_DISTANCE = 1.5;
const DOOR_USE_DISTANCE = 2;

/**
 * Executes the engine's close-range `use` route without adding a desktop
 * ActionUseObject/ActionOpenDoor walk-to action. The target itself remains
 * responsible for all authored locks, keys, scripts, containers and menus.
 */
export function tryDirectVRWorldUse(
  actor: VRWorldUseActor,
  target: VRWorldUseTarget,
  logger: Pick<Console, 'info' | 'error'> = console,
): VRWorldUseOutcome {
  validateActor(actor);
  validateTarget(target);
  const allowedDistance = getUseDistance(target.objectType);
  if (allowedDistance === null) return { handled: false };

  const distance = distance2D(actor.position, target.position);
  const name = resolveDisplayName(target.getName?.()) || 'Object';
  const type = isDoor(target.objectType) ? 'door' : 'placeable';
  if (distance > allowedDistance) {
    logger.info(`[VR interaction] target=${target.id} type=${type} distance=${distance.toFixed(2)} route=blocked-range`);
    return { handled: true, feedbackLabel: `${name}: Move closer` };
  }

  try {
    target.use(actor);
    logger.info(`[VR interaction] target=${target.id} type=${type} distance=${distance.toFixed(2)} route=direct-use result=ok`);
    return { handled: true, feedbackLabel: `Use: ${name}` };
  } catch (error) {
    logger.error(`[VR interaction] target=${target.id} type=${type} route=direct-use result=error`, error);
    return { handled: true, feedbackLabel: `${name}: Unavailable` };
  }
}

function getUseDistance(objectType: number): number | null {
  if (isDoor(objectType)) return DOOR_USE_DISTANCE;
  if ((objectType & ModuleObjectType.ModulePlaceable) !== 0) return PLACEABLE_USE_DISTANCE;
  return null;
}

/**
 * How close the player must be for an object to be targetable at all. Shares
 * `getUseDistance`'s per-type values so the range that shows a label is the
 * same range that permits the interaction — anything else would show
 * affordances the engine then refuses to honour. Types without a direct-use
 * route (creatures, triggers) fall back to a conversational reach.
 */
export const VR_DEFAULT_INTERACTION_RANGE_METRES = 3;

export function getVRInteractionRange(objectType: number): number {
  return getUseDistance(objectType) ?? VR_DEFAULT_INTERACTION_RANGE_METRES;
}

function isDoor(objectType: number): boolean {
  return (objectType & ModuleObjectType.ModuleDoor) !== 0;
}

function distance2D(first: THREE.Vector3, second: THREE.Vector3): number {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function validateActor(actor: VRWorldUseActor): void {
  if (!actor || !Number.isInteger(actor.id) || !(actor.position instanceof THREE.Vector3)) {
    throw new TypeError('VR world-use actor must have an integer id and THREE.Vector3 position');
  }
}

function validateTarget(target: VRWorldUseTarget): void {
  if (!target || !Number.isInteger(target.id) || !Number.isInteger(target.objectType) ||
    !(target.position instanceof THREE.Vector3) || typeof target.use !== 'function') {
    throw new TypeError('VR world-use target must expose id, objectType, position, and use');
  }
}
