import * as THREE from 'three';
import { XRHandRole } from '../XRTypes';

export type BodySocketLocation =
  | 'hip-left'
  | 'hip-right'
  | 'shoulder-left'
  | 'shoulder-right'
  | 'wrist-left'
  | 'wrist-right';

export interface SocketItemDescriptor {
  readonly id: string;
  readonly tag?: string;
  readonly name?: string;
  readonly weaponMode?: string;
}

export interface BodySocketConfiguration {
  readonly location: BodySocketLocation;
  readonly snapRadiusMetres?: number;
  readonly allowedWeaponModes?: readonly string[];
}

const DEFAULT_SOCKET_OFFSETS: Record<BodySocketLocation, THREE.Vector3> = {
  'hip-left': new THREE.Vector3(-0.25, -0.65, 0.05),
  'hip-right': new THREE.Vector3(0.25, -0.65, 0.05),
  'shoulder-left': new THREE.Vector3(-0.2, -0.15, -0.15),
  'shoulder-right': new THREE.Vector3(0.2, -0.15, -0.15),
  'wrist-left': new THREE.Vector3(0, 0, 0),
  'wrist-right': new THREE.Vector3(0, 0, 0),
};

/**
 * Manages player-attached body sockets (hip holsters, shoulder sheaths, wrist datapads)
 * allowing physical spatial interaction without menus.
 */
export class VRPhysicalSocket {
  readonly location: BodySocketLocation;
  readonly snapRadiusMetres: number;
  private readonly allowedWeaponModes: Set<string> | null;
  private occupiedItem: SocketItemDescriptor | null = null;
  private readonly localOffset: THREE.Vector3;
  private readonly tempWorldPos = new THREE.Vector3();

  constructor(config: BodySocketConfiguration) {
    this.location = config.location;
    this.snapRadiusMetres = config.snapRadiusMetres ?? 0.18;
    this.allowedWeaponModes = config.allowedWeaponModes ? new Set(config.allowedWeaponModes) : null;
    this.localOffset = DEFAULT_SOCKET_OFFSETS[this.location].clone();
  }

  isOccupied(): boolean {
    return this.occupiedItem !== null;
  }

  getItem(): SocketItemDescriptor | null {
    return this.occupiedItem;
  }

  canAcceptItem(item: SocketItemDescriptor): boolean {
    if (this.occupiedItem !== null) return false;
    if (!this.allowedWeaponModes) return true;
    if (!item.weaponMode) return true;
    return this.allowedWeaponModes.has(item.weaponMode);
  }

  attachItem(item: SocketItemDescriptor): boolean {
    if (!this.canAcceptItem(item)) return false;
    this.occupiedItem = item;
    return true;
  }

  detachItem(): SocketItemDescriptor | null {
    const item = this.occupiedItem;
    this.occupiedItem = null;
    return item;
  }

  getWorldPosition(headPosition: THREE.Vector3, headOrientation: THREE.Quaternion, output: THREE.Vector3): THREE.Vector3 {
    // Yaw only from head orientation so looking up/down does not swing hip holsters
    const euler = new THREE.Euler().setFromQuaternion(headOrientation, 'YXZ');
    const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), euler.y);

    return output
      .copy(this.localOffset)
      .applyQuaternion(yawQuaternion)
      .add(headPosition);
  }

  isHandInRange(
    handPosition: THREE.Vector3,
    headPosition: THREE.Vector3,
    headOrientation: THREE.Quaternion
  ): boolean {
    const socketWorldPos = this.getWorldPosition(headPosition, headOrientation, this.tempWorldPos);
    return handPosition.distanceTo(socketWorldPos) <= this.snapRadiusMetres;
  }
}
