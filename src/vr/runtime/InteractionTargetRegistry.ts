import * as THREE from 'three';
import { InteractionMode, XRHandRole } from './XRTypes';

export interface InteractionActivationContext {
  readonly actorId: string;
  readonly hand: XRHandRole;
  readonly interactionMode: InteractionMode;
  readonly engineTimestamp: number;
}

export interface InteractionTarget {
  readonly id: string;
  /** Short, player-facing affordance shown while the controller ray targets this object. */
  readonly label?: string;
  readonly radiusMetres: number;
  readonly interactionModes: readonly InteractionMode[];
  readonly getWorldPosition: (output: THREE.Vector3) => THREE.Vector3;
  readonly isAvailable: () => boolean;
  readonly activate: (context: InteractionActivationContext) => void;
}

export interface ResolvedInteractionTarget {
  readonly target: InteractionTarget;
  readonly interactionMode: 'near-touch' | 'ray';
  readonly distanceMetres: number;
  readonly hitPoint: THREE.Vector3;
}

/** Shared spatial registry for controller-ray and near-touch interaction. */
export class InteractionTargetRegistry {
  private readonly targets = new Map<string, InteractionTarget>();
  private readonly targetPosition = new THREE.Vector3();

  register(target: InteractionTarget): void {
    InteractionTargetRegistry.validateTarget(target);
    if (this.targets.has(target.id)) {
      throw new Error(`interaction target '${target.id}' is already registered`);
    }
    this.targets.set(target.id, {
      ...target,
      interactionModes: [...target.interactionModes],
    });
  }

  unregister(targetId: string): boolean {
    return this.targets.delete(targetId);
  }

  clear(): void {
    this.targets.clear();
  }

  resolveRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDistanceMetres: number
  ): ResolvedInteractionTarget | null {
    InteractionTargetRegistry.validateVector(origin, 'ray origin');
    InteractionTargetRegistry.validateVector(direction, 'ray direction');
    if (direction.lengthSq() <= Number.EPSILON) {
      throw new RangeError('ray direction must be finite and non-zero');
    }
    InteractionTargetRegistry.validatePositiveDistance(maxDistanceMetres, 'max ray distance');

    const normalizedDirection = direction.clone().normalize();
    let closest: ResolvedInteractionTarget | null = null;
    for (const target of this.targets.values()) {
      if (!target.interactionModes.includes('ray') || !target.isAvailable()) continue;
      const center = target.getWorldPosition(this.targetPosition);
      if (!InteractionTargetRegistry.isFiniteVector(center)) continue;
      const distance = InteractionTargetRegistry.intersectRaySphere(
        origin,
        normalizedDirection,
        center,
        target.radiusMetres
      );
      if (distance == null || distance > maxDistanceMetres) continue;
      if (!closest || distance < closest.distanceMetres) {
        closest = {
          target,
          interactionMode: 'ray',
          distanceMetres: distance,
          hitPoint: origin.clone().addScaledVector(normalizedDirection, distance),
        };
      }
    }
    return closest;
  }

  resolveNear(
    position: THREE.Vector3,
    maxReachMetres: number
  ): ResolvedInteractionTarget | null {
    InteractionTargetRegistry.validateVector(position, 'near-touch position');
    InteractionTargetRegistry.validatePositiveDistance(maxReachMetres, 'near-touch reach', true);

    let closest: ResolvedInteractionTarget | null = null;
    for (const target of this.targets.values()) {
      if (!target.interactionModes.includes('near-touch') || !target.isAvailable()) continue;
      const center = target.getWorldPosition(this.targetPosition);
      if (!InteractionTargetRegistry.isFiniteVector(center)) continue;
      const centerDistance = position.distanceTo(center);
      const surfaceDistance = Math.max(0, centerDistance - target.radiusMetres);
      if (surfaceDistance > maxReachMetres) continue;
      if (!closest || surfaceDistance < closest.distanceMetres) {
        const hitPoint = position.clone();
        if (centerDistance > Number.EPSILON) {
          hitPoint.addScaledVector(
            center.clone().sub(position).divideScalar(centerDistance),
            surfaceDistance
          );
        }
        closest = {
          target,
          interactionMode: 'near-touch',
          distanceMetres: surfaceDistance,
          hitPoint,
        };
      }
    }
    return closest;
  }

  private static intersectRaySphere(
    origin: THREE.Vector3,
    normalizedDirection: THREE.Vector3,
    center: THREE.Vector3,
    radius: number
  ): number | null {
    const originToCenter = origin.clone().sub(center);
    const c = originToCenter.lengthSq() - radius * radius;
    if (c <= 0) return 0;
    const b = originToCenter.dot(normalizedDirection);
    const discriminant = b * b - c;
    if (discriminant < 0) return null;
    const distance = -b - Math.sqrt(discriminant);
    return distance >= 0 ? distance : null;
  }

  private static validateTarget(target: InteractionTarget): void {
    if (!target || typeof target !== 'object') {
      throw new TypeError('interaction target is required');
    }
    if (typeof target.id !== 'string' || target.id.trim().length === 0) {
      throw new TypeError('target id must be a non-empty string');
    }
    InteractionTargetRegistry.validatePositiveDistance(target.radiusMetres, 'target radius');
    if (!Array.isArray(target.interactionModes) || target.interactionModes.length === 0) {
      throw new TypeError('target interactionModes must not be empty');
    }
    for (const mode of target.interactionModes) {
      if (mode !== 'near-touch' && mode !== 'ray' && mode !== 'grab') {
        throw new TypeError(`unsupported interaction mode '${String(mode)}'`);
      }
    }
    if (typeof target.getWorldPosition !== 'function') {
      throw new TypeError('target getWorldPosition must be a function');
    }
    if (typeof target.isAvailable !== 'function') {
      throw new TypeError('target isAvailable must be a function');
    }
    if (typeof target.activate !== 'function') {
      throw new TypeError('target activate must be a function');
    }
  }

  private static validateVector(vector: THREE.Vector3, label: string): void {
    if (!InteractionTargetRegistry.isFiniteVector(vector)) {
      throw new RangeError(`${label} must be finite`);
    }
  }

  private static isFiniteVector(vector: THREE.Vector3): boolean {
    return vector instanceof THREE.Vector3 &&
      Number.isFinite(vector.x) &&
      Number.isFinite(vector.y) &&
      Number.isFinite(vector.z);
  }

  private static validatePositiveDistance(
    value: number,
    label: string,
    allowZero = false
  ): void {
    const validMinimum = allowZero ? value >= 0 : value > 0;
    if (!Number.isFinite(value) || !validMinimum) {
      throw new RangeError(`${label} must be a finite ${allowZero ? 'non-negative' : 'positive'} number`);
    }
  }
}
