export interface VRSnapTurnConfiguration {
  readonly engageThreshold: number;
  readonly resetThreshold: number;
}

const DEFAULT_CONFIGURATION: VRSnapTurnConfiguration = {
  engageThreshold: 0.7,
  resetThreshold: 0.3,
};

const DEFAULT_INCREMENT_RADIANS = Math.PI / 4; // 45 degrees

/**
 * Discrete-increment turn: the comfort alternative to continuous smooth turn,
 * which some players find nauseating. Fires one fixed-size turn per stick
 * deflection past `engageThreshold`, then requires the stick to fall back
 * under `resetThreshold` before it can fire again — a standard controller
 * edge-detection gate, not a per-frame continuous mapping. The increment
 * size is a live comfort setting, not fixed configuration, so it's passed
 * to `process()` rather than baked in at construction.
 */
export class VRSnapTurnController {
  private readonly configuration: VRSnapTurnConfiguration;
  private armed = true;

  constructor(configuration: Partial<VRSnapTurnConfiguration> = {}) {
    this.configuration = { ...DEFAULT_CONFIGURATION, ...configuration };
    VRSnapTurnController.validateConfiguration(this.configuration);
  }

  /** Returns a signed turn increment in radians, or 0 if no snap fires this frame. */
  process(turnAxisValue: number, incrementRadians: number = DEFAULT_INCREMENT_RADIANS): number {
    if (!Number.isFinite(turnAxisValue)) {
      throw new TypeError('turnAxisValue must be finite');
    }
    if (!Number.isFinite(incrementRadians) || incrementRadians <= 0) {
      throw new RangeError('incrementRadians must be finite and positive');
    }
    const magnitude = Math.abs(turnAxisValue);
    if (magnitude < this.configuration.resetThreshold) {
      this.armed = true;
      return 0;
    }
    if (!this.armed || magnitude < this.configuration.engageThreshold) return 0;
    this.armed = false;
    return Math.sign(turnAxisValue) * incrementRadians;
  }

  reset(): void {
    this.armed = true;
  }

  private static validateConfiguration(configuration: VRSnapTurnConfiguration): void {
    if (
      !Number.isFinite(configuration.engageThreshold) ||
      configuration.engageThreshold <= 0 ||
      configuration.engageThreshold > 1
    ) {
      throw new RangeError('engageThreshold must be in (0, 1]');
    }
    if (
      !Number.isFinite(configuration.resetThreshold) ||
      configuration.resetThreshold < 0 ||
      configuration.resetThreshold >= configuration.engageThreshold
    ) {
      throw new RangeError('resetThreshold must be finite, non-negative, and below engageThreshold');
    }
  }
}
