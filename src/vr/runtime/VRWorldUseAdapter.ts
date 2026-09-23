import * as THREE from 'three';
import {
  activateSelectedObject,
  SelectedObjectActivationResult,
} from '@/engine/interaction/SelectedObjectActivation';
import { ModuleObjectType } from '@/enums/module/ModuleObjectType';
import { resolveDisplayName } from './resolveDisplayName';

export interface VRWorldUseActor {
  readonly id: number;
  readonly position: THREE.Vector3;
  clearAllActions(): void;
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
  isLocked?(): boolean;
  getName?(): string;
  getTag?(): string;
  getTemplateResRef?(): string | null;
  onClick(actor: VRWorldUseActor): void;
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
  /**
   * Whether the actor is carrying the key this target names, re-resolved at
   * each boundary like the count above — a key dropped or consumed between
   * opening the prompt and pressing it must refuse again.
   *
   * `keyRequired` alone refuses the direct-use route, which is right for a lock
   * the player cannot open and wrong for one they can. Reported from a headset
   * session: the cargo hold locker offered no options at all while its key sat
   * in the inventory, because Security refuses a key lock, Bash refuses a
   * non-blastable one, and this route refused everything that was left. The
   * engine already settles the attempt in `ModulePlaceable.attemptUnlockWithKey`,
   * which looks the key up by tag; this only decides whether the player is
   * allowed to make it.
   *
   * Optional, so existing callers keep today's behaviour.
   */
  actorHoldsRequiredKey?(): boolean;
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
  // Re-read at each boundary rather than captured once: a key spent, dropped or
  // traded away between building the prompt and pressing it must refuse again.
  const holdsKey = (): boolean => {
    try {
      return safetySource.actorHoldsRequiredKey?.() === true;
    } catch {
      return false;
    }
  };
  if (!isSupportedAndInRange(actor, target) ||
    !isSafeDirectVRWorldUse(target, safetySource.authoredActionCount, holdsKey())) return null;

  const name = resolveDisplayName(target.getName?.()) || 'Object';
  const remainsSafe = (): boolean => {
    try {
      return isSafeDirectVRWorldUse(target, safetySource.getLiveAuthoredActionCount(), holdsKey());
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
 * Classifies the narrow set of targets that may use the native selected-target
 * activation route without stealing ownership from key requirements, story
 * state, or an authored ActionMenu action.
 *
 * Locked objects are allowed through: trying a locked door is a legal move that
 * flatscreen permits, and the engine — not this classifier — owns what happens
 * when the attempt fails.
 */
export function classifySafeDirectVRWorldUse(
  target: VRWorldUseTarget,
  authoredActionCount: number,
  actorHoldsRequiredKey: boolean = false,
): SafeDirectVRWorldUseClassification | null {
  try {
    if (!Number.isInteger(authoredActionCount) || authoredActionCount < 0) return null;
    const supportedType = (target.objectType & (
      ModuleObjectType.ModuleDoor | ModuleObjectType.ModulePlaceable
    )) !== 0;
    if (!supportedType) return null;
    if (authoredActionCount > 0) return null;

    // `isLocked` is deliberately NOT a gate. Flatscreen lets the player walk up
    // to a locked door and simply try it; the engine answers with its own
    // refusal, and that answer is information — it is how the player learns the
    // door is locked rather than merely shut. Refusing here meant a locked
    // bashable door offered "Bash" as its only option, so the only way to ask a
    // door whether it was locked was to attack it. An earlier fix excluded Bash
    // from `authoredActionCount` for exactly this reason but left this gate in
    // place, so it never achieved its own stated goal.
    //
    // The guards that actually protect ownership are still here: an authored
    // ActionMenu action wins outright, `keyRequired` still refuses below, and
    // an authored failure script still refuses further down. The engine owns
    // the outcome of the attempt either way — this only decides whether the
    // player is allowed to make it.
    // ...unless the actor is actually carrying the key. `keyRequired` refuses a
    // lock the player cannot open, which is right, and refused one they can,
    // which left the cargo hold locker with no options at all: Security refuses
    // a key lock, Bash refuses a non-blastable one, and this route refused the
    // remainder. The engine still owns the outcome — `attemptUnlockWithKey`
    // looks the key up by tag and answers for itself.
    //
    // And both of the ownership guards below only mean anything while the
    // object is LOCKED. A key requirement is a condition on unlocking, and an
    // OnFailToOpen script runs only when opening fails — an unlocked door or
    // container cannot fail to open. Flatscreen clicks such an object and it
    // opens (or starts its conversation). Refusing it anyway is what stranded
    // the player at Peragus' holding cell: `PrisonRoomDr` was unlocked by the
    // story with `KeyRequired=1`, an empty `KeyName` and
    // `OnFailToOpen=a_compdlg`, so both guards refused and it offered nothing.
    // Unknown lock state is treated as locked.
    const locked = typeof target.isLocked === 'function' ? target.isLocked() !== false : true;
    if (locked && !isExplicitFalseFlag(target.keyRequired) && !actorHoldsRequiredKey) return null;

    if (isEbonHawkGalaxyMap(target)) return 'ebon-hawk-galaxy-map';

    // `Plot` is deliberately NOT a gate. In Odyssey it marks an object as
    // indestructible, not unusable — flatscreen opens plot-flagged containers
    // and consoles normally, which is the behaviour VR has to match. Gating on
    // it refused every prologue tutorial object (the Plasteel Cylinder, the
    // Communications Console) while the Galaxy Map worked only because the
    // check above returns before reaching it. The real ownership guard is an
    // authored failure script, which is kept: if the object scripts its own
    // refusal, the engine owns that outcome and the generic route must not
    // pre-empt it. Keys and authored ActionMenu actions are still checked
    // above; locks deliberately are not.
    //
    // Holding the named key also passes it: the key IS the authored way in, and
    // the engine's attemptUnlockWithKey consumes it before any failure script
    // could run. The Ebon Hawk cargo locker (`locker_locked`) is key-locked,
    // not blastable, plot-flagged and carries `OnFailToOpen=a_compdlg` — with
    // the key in hand it still offered nothing.
    if (locked && !actorHoldsRequiredKey && hasStoryFailureScript(target.scripts)) return null;
    return 'ordinary';
  } catch {
    return null;
  }
}

export function isSafeDirectVRWorldUse(
  target: VRWorldUseTarget,
  authoredActionCount: number,
  actorHoldsRequiredKey: boolean = false,
): boolean {
  return classifySafeDirectVRWorldUse(target, authoredActionCount, actorHoldsRequiredKey) !== null;
}

/**
 * Executes the native selected-target activation route. The target's `onClick`
 * remains responsible for authored walking, locks, keys, scripts, containers,
 * combat, and menus, exactly as it is for a flatscreen click.
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

  const activation = activateSelectedObject(actor, target);
  if (activation.status === 'activated') {
    logger.info(`[VR interaction] target=${target.id} type=${type} distance=${distance.toFixed(2)} route=native-selected-activation result=ok`);
    return { handled: true, feedbackLabel: `Use: ${name}` };
  }
  reportActivationFailure(target, type, activation, logger);
  return { handled: true, feedbackLabel: `${name}: Unavailable` };
}

function reportActivationFailure(
  target: VRWorldUseTarget,
  type: string,
  activation: Extract<SelectedObjectActivationResult, { readonly status: 'failed' }>,
  logger: Pick<Console, 'error'>,
): void {
  logger.error(`[VR interaction] target=${target.id} type=${type} route=native-selected-activation result=error`, activation.error);
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
  if (!actor || !Number.isInteger(actor.id) || !(actor.position instanceof THREE.Vector3) ||
    typeof actor.clearAllActions !== 'function') {
    throw new TypeError('VR world-use actor must have an integer id, THREE.Vector3 position, and clearAllActions');
  }
}

function validateTarget(target: VRWorldUseTarget): void {
  if (!target || !Number.isInteger(target.id) || !Number.isInteger(target.objectType) ||
    !(target.position instanceof THREE.Vector3) || typeof target.onClick !== 'function') {
    throw new TypeError('VR world-use target must expose id, objectType, position, and onClick');
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
