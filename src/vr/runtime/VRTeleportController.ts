import * as THREE from 'three';

export interface VRTeleportConfiguration {
  readonly engageThreshold: number;
  readonly maxDistanceMetres: number;
}

const DEFAULT_CONFIGURATION: VRTeleportConfiguration = {
  engageThreshold: 0.5,
  maxDistanceMetres: 4,
};

export type VRTeleportPhase = 'idle' | 'aiming' | 'committed';

export interface VRTeleportResult {
  readonly phase: VRTeleportPhase;
  /** Normalized world-space aim direction while aiming/committed; null while idle. */
  readonly direction: THREE.Vector2 | null;
}

/**
 * Discrete point-and-release teleport: the comfort alternative to continuous
 * smooth movement. Deflecting the stick past `engageThreshold` aims in that
 * direction; releasing back under it commits a teleport once, one frame,
 * the same edge-detection shape as `VRSnapTurnController`.
 */
export class VRTeleportController {
  private readonly configuration: VRTeleportConfiguration;
  private aiming = false;
  private lastDirection: THREE.Vector2 | null = null;

  constructor(configuration: Partial<VRTeleportConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    VRTeleportController.validateConfiguration(this.configuration);
  }

  get maxDistanceMetres(): number {
    return this.configuration.maxDistanceMetres;
  }

  process(stickInput: THREE.Vector2): VRTeleportResult {
    if (!Number.isFinite(stickInput.x) || !Number.isFinite(stickInput.y)) {
      throw new TypeError('teleport stick input must be finite');
    }
    const magnitude = stickInput.length();
    if (magnitude >= this.configuration.engageThreshold) {
      this.aiming = true;
      this.lastDirection = stickInput.clone().normalize();
      return { phase: 'aiming', direction: this.lastDirection.clone() };
    }
    if (this.aiming) {
      this.aiming = false;
      const direction = this.lastDirection;
      this.lastDirection = null;
      return { phase: 'committed', direction };
    }
    return { phase: 'idle', direction: null };
  }

  reset(): void {
    this.aiming = false;
    this.lastDirection = null;
  }

  private static validateConfiguration(configuration: VRTeleportConfiguration): void {
    if (
      !Number.isFinite(configuration.engageThreshold) ||
      configuration.engageThreshold <= 0 ||
      configuration.engageThreshold > 1
    ) {
      throw new RangeError('engageThreshold must be in (0, 1]');
    }
    if (!Number.isFinite(configuration.maxDistanceMetres) || configuration.maxDistanceMetres <= 0) {
      throw new RangeError('maxDistanceMetres must be finite and positive');
    }
  }
}
