import * as THREE from 'three';
import { XRHandRole } from '../XRTypes';

export type GrabMotionConstraint = 'linear' | 'hinge' | 'free';

export interface VRGrabHandleOptions {
  readonly id: string;
  readonly constraint: GrabMotionConstraint;
  readonly axis?: THREE.Vector3;
  readonly minLimit?: number;
  readonly maxLimit?: number;
  readonly snapToleranceMetres?: number;
  readonly commitThreshold?: number; // Normalized 0.0 - 1.0 (e.g. 0.85 = 85% pulled to activate)
}

const DEFAULT_OPTIONS: Required<Omit<VRGrabHandleOptions, 'id' | 'axis'>> = {
  constraint: 'linear',
  minLimit: 0,
  maxLimit: 1.0,
  snapToleranceMetres: 0.15,
  commitThreshold: 0.85,
};

/**
 * Physical grab handle for world objects (doors, container latches, levers)
 * calculating constrained physical interaction from controller movement.
 */
export class VRGrabHandle {
  readonly id: string;
  readonly constraint: GrabMotionConstraint;
  readonly axis: THREE.Vector3;
  readonly minLimit: number;
  readonly maxLimit: number;
  readonly snapToleranceMetres: number;
  readonly commitThreshold: number;

  private grabbingHand: XRHandRole | null = null;
  private grabStartHandPos = new THREE.Vector3();
  private grabStartHandlePos = new THREE.Vector3();
  private currentValue = 0; // Normalized 0.0 - 1.0
  private committed = false;

  public onValueChanged?: (value: number) => void;
  public onCommitted?: () => void;

  constructor(options: VRGrabHandleOptions) {
    this.id = options.id;
    this.constraint = options.constraint ?? DEFAULT_OPTIONS.constraint;
    this.axis = options.axis ? options.axis.clone().normalize() : new THREE.Vector3(0, 0, 1);
    this.minLimit = options.minLimit ?? DEFAULT_OPTIONS.minLimit;
    this.maxLimit = options.maxLimit ?? DEFAULT_OPTIONS.maxLimit;
    this.snapToleranceMetres = options.snapToleranceMetres ?? DEFAULT_OPTIONS.snapToleranceMetres;
    this.commitThreshold = options.commitThreshold ?? DEFAULT_OPTIONS.commitThreshold;
  }

  isGrabbed(): boolean {
    return this.grabbingHand !== null;
  }

  getGrabbingHand(): XRHandRole | null {
    return this.grabbingHand;
  }

  getValue(): number {
    return this.currentValue;
  }

  canGrab(handPos: THREE.Vector3, handleWorldPos: THREE.Vector3): boolean {
    if (this.grabbingHand !== null) return false;
    return handPos.distanceTo(handleWorldPos) <= this.snapToleranceMetres;
  }

  startGrab(hand: XRHandRole, handPos: THREE.Vector3, handleWorldPos: THREE.Vector3): boolean {
    if (this.grabbingHand !== null) return false;
    this.grabbingHand = hand;
    this.grabStartHandPos.copy(handPos);
    this.grabStartHandlePos.copy(handleWorldPos);
    this.committed = false;
    return true;
  }

  updateGrab(handPos: THREE.Vector3): number {
    if (!this.grabbingHand) return this.currentValue;

    if (this.constraint === 'linear') {
      const delta = handPos.clone().sub(this.grabStartHandPos);
      const proj = delta.dot(this.axis);
      const range = this.maxLimit - this.minLimit;
      const norm = range > 0 ? Math.max(0, Math.min(1, proj / range)) : 0;
      this.currentValue = norm;
    } else if (this.constraint === 'hinge') {
      const delta = handPos.clone().sub(this.grabStartHandPos);
      const angle = Math.atan2(delta.x, delta.z);
      const norm = Math.max(0, Math.min(1, Math.abs(angle) / (this.maxLimit || Math.PI / 2)));
      this.currentValue = norm;
    } else {
      this.currentValue = Math.min(1, handPos.distanceTo(this.grabStartHandPos));
    }

    this.onValueChanged?.(this.currentValue);

    if (!this.committed && this.currentValue >= this.commitThreshold) {
      this.committed = true;
      this.onCommitted?.();
    }

    return this.currentValue;
  }

  releaseGrab(): void {
    this.grabbingHand = null;
  }

  reset(): void {
    this.grabbingHand = null;
    this.currentValue = 0;
    this.committed = false;
  }
}
