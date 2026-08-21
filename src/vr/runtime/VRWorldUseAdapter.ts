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
  readonly keyRequired?: unknown;
  readonly plot?: unknown;
  readonly scripts?: unknown;
  readonly tag?: unknown;
  readonly templateResRef?: unknown;
  getName?(): string;
  getTag?(): string;
  getTemplateResRef?(): string | null;
  isLocked?(): boolean;
  use(actor: VRWorldUseActor): void;
}

export interface VRWorldUseOutcome {
  readonly handled: boolean;
  readonly feedbackLabel?: string;
}

export interface VRWorldUseActionDescriptor {
  readonly id: string;
  readonly label: string;
  revalidate(): boolean;
  activate(): VRWorldUseOutcome;
}

export interface VRWorldUseSafetySource {
  /** Authored target actions captured by the same refresh that builds the prompt. */
  readonly authoredActionCount: number;
  /** Re-resolves authored ownership at revalidation and execution boundaries. */
  getLiveAuthoredActionCount(): number;
}

export type SafeDirectVRWorldUseClassification = 'ordinary' | 'ebon-hawk-galaxy-map';

// Roomscale reach is not desktop click reach. The original 1.5m/2m values were
// tight enough that a player standing at a natural conversational distance from
// a console got no prompt at all, with nothing on screen to explain why — the
// name label comes from the engine's own cursor path at a much larger range, so
// the object looks targeted while the prompt silently refuses. Widened by one
// metre on Allen's playtest call (2026-08-21).
const PLACEABLE_USE_DISTANCE = 2.5;
const DOOR_USE_DISTANCE = 3;

/** Describes direct world use without invoking or queuing any engine action. */
export function describeDirectVRWorldUse(
  actor: VRWorldUseActor,
  target: VRWorldUseTarget,
  logger: Pick<Console, 'info' | 'error'> = console,
  safetySource: VRWorldUseSafetySource = {
    authoredActionCount: 0,
    getLiveAuthoredActionCount: () => 0,
  },
): VRWorldUseActionDescriptor | null {
  validateActor(actor);
  validateTarget(target);
  validateSafetySource(safetySource);
  if (!isSupportedAndInRange(actor, target) ||
    !isSafeDirectVRWorldUse(target, safetySource.authoredActionCount)) return null;

  const name = resolveDisplayName(target.getName?.()) || 'Object';
  const remainsSafe = (): boolean => {
    try {
      return isSafeDirectVRWorldUse(target, safetySource.getLiveAuthoredActionCount());
    } catch {
      return false;
    }
  };
  return {
    id: `direct-use:${target.id}`,
    label: `Use: ${name}`,
    revalidate: (): boolean => isSupportedAndInRange(actor, target) && remainsSafe(),
    activate: (): VRWorldUseOutcome => remainsSafe()
      ? executeDirectVRWorldUse(actor, target, logger)
      : { handled: false },
  };
}

/**
 * Classifies the narrow set of targets that may use their existing engine
 * `use()` route without stealing ownership from locks, story state, or an
 * authored ActionMenu action.
 */
export function classifySafeDirectVRWorldUse(
  target: VRWorldUseTarget,
  authoredActionCount: number,
): SafeDirectVRWorldUseClassification | null {
  try {
    if (!Number.isInteger(authoredActionCount) || authoredActionCount < 0) return null;
    const supportedType = (target.objectType & (
      ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable
    )) !== 0;
    if (!supportedType) return null;
    if (authoredActionCount > 0 || typeof target.isLocked !== 'function' || target.isLocked()) {
      return null;
    }
    if (!isExplicitFalseFlag(target.keyRequired)) return null;

    if (isEbonHawkGalaxyMap(target)) return 'ebon-hawk-galaxy-map';

    // `Plot` is deliberately NOT a gate. In Odyssey it marks an object as
    // indestructible, not unusable — flatscreen opens plot-flagged containers
    // and consoles normally, which is the behaviour VR has to match. Gating on
    // it refused every prologue tutorial object (the Plasteel Cylinder, the
    // Communications Console) while the Galaxy Map worked only because the
    // check above returns before reaching it. The real ownership guard is an
    // authored failure script, which is kept: if the object scripts its own
    // refusal, the engine owns that outcome and the generic route must not
    // pre-empt it. Locks, keys, and authored ActionMenu actions are still
    // checked above.
    if (hasStoryFailureScript(target.scripts)) return null;
    return 'ordinary';
  } catch {
    return null;
  }
}

export function isSafeDirectVRWorldUse(
  target: VRWorldUseTarget,
  authoredActionCount: number,
): boolean {
  return classifySafeDirectVRWorldUse(target, authoredActionCount) !== null;
}

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

  return executeDirectVRWorldUse(actor, target, logger);
}

function executeDirectVRWorldUse(
  actor: VRWorldUseActor,
  target: VRWorldUseTarget,
  logger: Pick<Console, 'info' | 'error'>,
): VRWorldUseOutcome {
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

function isSupportedAndInRange(actor: VRWorldUseActor, target: VRWorldUseTarget): boolean {
  const allowedDistance = getUseDistance(target.objectType);
  return allowedDistance !== null && distance2D(actor.position, target.position) <= allowedDistance;
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

function validateSafetySource(source: VRWorldUseSafetySource): void {
  if (!source || !Number.isInteger(source.authoredActionCount) || source.authoredActionCount < 0 ||
    typeof source.getLiveAuthoredActionCount !== 'function') {
    throw new TypeError('VR world-use safety source must expose authored action counts');
  }
}

function isEbonHawkGalaxyMap(target: VRWorldUseTarget): boolean {
  if ((target.objectType & ModuleObjectType.ModulePlaceable) === 0) return false;
  const tag = readIdentity(target.getTag, target.tag, target);
  const templateResRef = readIdentity(target.getTemplateResRef, target.templateResRef, target);
  return tag === 'galaxymap' && templateResRef === 'invisible001';
}

function readIdentity(
  getter: (() => unknown) | undefined,
  property: unknown,
  receiver: VRWorldUseTarget,
): string {
  const value = typeof getter === 'function' ? getter.call(receiver) : property;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function hasStoryFailureScript(scripts: unknown): boolean {
  if (!scripts || typeof scripts !== 'object') return false;
  const entries = Object.entries(scripts as Readonly<Record<string, unknown>>);
  return entries.some(([key, value]) => {
    if (key.toLowerCase() !== 'onfailtoopen' || value == null) return false;
    if (typeof value === 'object' && 'name' in value) {
      const name = (value as { readonly name?: unknown }).name;
      return typeof name === 'string' ? name.trim().length > 0 : Boolean(name);
    }
    return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
  });
}

function isExplicitFalseFlag(value: unknown): boolean {
  return value === false || value === 0;
}
