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
const DEFAULT_VERTICAL_OFFSET_METRES = 1;
const DEFAULT_INTERACTION_RANGE_METRES = 2;

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
      output.copy(object.position).setZ(object.position.z + verticalOffsetMetres),
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
  if (typeof object.isUseable !== 'function' || typeof object.onClick !== 'function') {
    throw new TypeError('engine interactable object must expose isUseable and onClick');
  }
}

function validateFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number`);
  }
}
