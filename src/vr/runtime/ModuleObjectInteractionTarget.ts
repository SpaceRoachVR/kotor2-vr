import * as THREE from 'three';
import {
  InteractionActivationContext,
  InteractionTarget,
  InteractionTargetRegistry,
} from './InteractionTargetRegistry';
import { resolveDisplayName } from './resolveDisplayName';

export interface EngineInteractionActor {
  readonly id: number;
  readonly position?: THREE.Vector3;
  clearAllActions(): void;
}

export interface EngineInteractableObject {
  readonly id: number;
  readonly position: THREE.Vector3;
  readonly objectType?: number;
  readonly destroyed?: boolean;
  readonly willDestroy?: boolean;
  /** Engine-maintained world bounds, used to sit the VR tag on the object. */
  readonly box?: THREE.Box3;
  getName?(): string;
  isUseable(): boolean;
  onClick(callee: EngineInteractionActor): void;
}

export interface ModuleObjectInteractionTargetOptions {
  readonly radiusMetres?: number;
  readonly verticalOffsetMetres?: number;
  /**
   * Resolves how close the actor must be for this object to be interactable
   * at all. Injected so the engine's own per-type use distances stay the
   * single source of truth rather than being duplicated here.
   */
  readonly getInteractionRangeMetres?: (object: EngineInteractableObject) => number;
}

const DEFAULT_RADIUS_METRES = 0.5;
/**
 * Fallback height above an object's origin for its VR tag, used only when the
 * engine has no usable bounds for it. Objects sit on their origin, so a small
 * lift keeps the tag off the floor without detaching it from the object.
 *
 * This was 1m, which put the tag a metre over every footlocker and computer
 * console while KOTOR's own reticle stayed down on the object itself — two
 * separate markers for one thing, with only the floating one selectable.
 * Anything with real bounds now uses them instead (see `resolveVRInteractionAnchor`).
 */
const DEFAULT_VERTICAL_OFFSET_METRES = 0.25;
const DEFAULT_INTERACTION_RANGE_METRES = 2;

/**
 * Height above the object's origin at which its tag and selection point sit:
 * the vertical centre of the object's own bounds, so a low crate tags low and
 * a tall console tags at chest height — on the object either way.
 */
export function resolveVRInteractionAnchor(
  object: EngineInteractableObject,
  output: THREE.Vector3,
  fallbackMetres = DEFAULT_VERTICAL_OFFSET_METRES,
): THREE.Vector3 {
  validateEngineObject(object);
  if (!(output instanceof THREE.Vector3)) {
    throw new TypeError('interaction anchor output must be a THREE.Vector3');
  }
  if (!Number.isFinite(fallbackMetres)) {
    throw new RangeError('fallbackMetres must be finite');
  }
  const box = object.box;
  let resolvedHeight = fallbackMetres;
  if (box && !box.isEmpty()) {
    const centreZ = (box.min.z + box.max.z) / 2;
    const height = centreZ - object.position.z;
    if (Number.isFinite(height)) resolvedHeight = height;
  }
  return output.copy(object.position).setZ(object.position.z + resolvedHeight);
}

/** Resolves a VR target without queuing the desktop walk-to interaction. */
export function createModuleObjectInteractionTarget(
  object: EngineInteractableObject,
  getActiveActor: () => EngineInteractionActor | null,
  options: ModuleObjectInteractionTargetOptions = {}
): InteractionTarget {
  validateEngineObject(object);
  if (typeof getActiveActor !== 'function') {
    throw new TypeError('getActiveActor must be a function');
  }
  const radiusMetres = options.radiusMetres ?? DEFAULT_RADIUS_METRES;
  const verticalOffsetMetres = options.verticalOffsetMetres ?? DEFAULT_VERTICAL_OFFSET_METRES;
  validateFinitePositive(radiusMetres, 'radiusMetres');
  if (!Number.isFinite(verticalOffsetMetres)) {
    throw new RangeError('verticalOffsetMetres must be finite');
  }

  const getInteractionRangeMetres = options.getInteractionRangeMetres;

  const isAvailable = (): boolean => {
    const actor = getActiveActor();
    if (actor === null ||
      actor.id === object.id ||
      object.destroyed ||
      object.willDestroy ||
      !object.isUseable()) {
      return false;
    }
    // Out-of-range objects are not merely un-activatable, they are not
    // targets at all — no label, no reticle, no selection. Selecting a
    // distant object in the original engine queues a walk-to-target action
    // that drags the player across the level (and into walls) with no way to
    // cancel, so VR refuses to nominate the target in the first place rather
    // than trying to interrupt that walk afterwards.
    if (actor.position) {
      const rangeMetres = getInteractionRangeMetres?.(object) ?? DEFAULT_INTERACTION_RANGE_METRES;
      const distanceMetres = Math.hypot(
        actor.position.x - object.position.x,
        actor.position.y - object.position.y
      );
      if (distanceMetres > rangeMetres) return false;
    }
    return true;
  };

  return {
    id: `module-object:${object.id}`,
    label: getInteractionLabel(object),
    radiusMetres,
    interactionModes: ['near-touch', 'ray'],
    getWorldPosition: (output: THREE.Vector3): THREE.Vector3 =>
      resolveVRInteractionAnchor(object, output, verticalOffsetMetres),
    isAvailable,
    activate: (context: InteractionActivationContext): void => {
      const actor = getActiveActor();
      if (!actor || String(actor.id) !== context.actorId) {
        throw new Error('interaction rejected because the active actor changed');
      }
      if (!isAvailable()) {
        throw new Error(`interaction target '${object.id}' is no longer available`);
      }
      // Desktop onClick queues a walk-to action before opening a contextual
      // menu. VR selection must only nominate the target; GameState opens its
      // authored action panel from the resulting InteractionIntent.
    },
  };
}

function getInteractionLabel(object: EngineInteractableObject): string {
  const name = typeof object.getName === 'function'
    ? resolveDisplayName(object.getName())
    : '';
  return name ? `Use: ${name}` : 'Use';
}

/** Keeps registry ownership aligned with the current module's live interactables. */
export class ModuleObjectInteractionTargetSet {
  private readonly registeredObjects = new Map<number, EngineInteractableObject>();
  private readonly reportedSkips = new Set<string>();

  private reportSkippedObject(message: string): void {
    if (this.reportedSkips.has(message)) return;
    this.reportedSkips.add(message);
    console.warn(`[ModuleObjectInteractionTargetSet] ${message}`);
  }

  constructor(
    private readonly registry: InteractionTargetRegistry,
    private readonly getActiveActor: () => EngineInteractionActor | null,
    private readonly options: ModuleObjectInteractionTargetOptions = {}
  ) {
    if (!registry) throw new TypeError('interaction target registry is required');
    if (typeof getActiveActor !== 'function') {
      throw new TypeError('getActiveActor must be a function');
    }
  }

  synchronize(objects: readonly EngineInteractableObject[]): void {
    if (!Array.isArray(objects)) throw new TypeError('interactable objects must be an array');
    const currentObjects = new Map<number, EngineInteractableObject>();
    for (const object of objects) {
      // A single malformed or duplicate-id object must not drop every other
      // valid target for the frame — skip and report it instead of throwing,
      // since `objects` is the engine's live selectable-object list and one
      // bad entry (e.g. an object mid-destruction) would otherwise blind VR
      // interaction to everything else in range too.
      try {
        validateEngineObject(object);
      } catch (error) {
        this.reportSkippedObject(`invalid engine object skipped: ${(error as Error).message}`);
        continue;
      }
      if (currentObjects.has(object.id)) {
        this.reportSkippedObject(`duplicate interactable object id '${object.id}' skipped`);
        continue;
      }
      currentObjects.set(object.id, object);
    }

    for (const [id, registeredObject] of this.registeredObjects) {
      const currentObject = currentObjects.get(id);
      if (currentObject === registeredObject) continue;
      this.registry.unregister(`module-object:${id}`);
      this.registeredObjects.delete(id);
    }

    for (const [id, object] of currentObjects) {
      if (this.registeredObjects.get(id) === object) continue;
      this.registry.register(createModuleObjectInteractionTarget(
        object,
        this.getActiveActor,
        this.options
      ));
      this.registeredObjects.set(id, object);
    }
  }

  clear(): void {
    for (const id of this.registeredObjects.keys()) {
      this.registry.unregister(`module-object:${id}`);
    }
    this.registeredObjects.clear();
  }
}

function validateEngineObject(object: EngineInteractableObject): void {
  if (!object || typeof object !== 'object') {
    throw new TypeError('engine interactable object is required');
  }
  if (!Number.isInteger(object.id) || object.id < 0) {
    throw new RangeError('engine interactable object id must be a non-negative integer');
  }
  if (!(object.position instanceof THREE.Vector3)) {
    throw new TypeError('engine interactable object position must be a THREE.Vector3');
  }
  if (![object.position.x, object.position.y, object.position.z].every(Number.isFinite)) {
    throw new RangeError('engine interactable object position must be finite');
  }
  if (typeof object.isUseable !== 'function' || typeof object.onClick !== 'function') {
    throw new TypeError('engine interactable object must expose isUseable and onClick');
  }
}

function validateFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
}
