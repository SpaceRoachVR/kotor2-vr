import * as THREE from 'three';

const FADE_DISTANCE_METRES = 0.08;
const FADE_SIZE_METRES = 1.2;

/**
 * Fade-to-black between authored camera cuts (ROADMAP 5.2): the theater
 * reprojection mechanism swaps the shown camera instantly, which reads as a
 * jarring snap in a headset in a way it never did on a 2D screen. A single
 * opaque quad parented to the XR camera, briefly ramped to full black and
 * back whenever the authored camera reference changes between frames.
 */
export class VRCutsceneFadeHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  constructor(camera: THREE.Camera) {
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(FADE_SIZE_METRES, FADE_SIZE_METRES),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.object.name = 'Kotor2VR.CutsceneFade';
    this.object.renderOrder = 1_000_005;
    this.object.position.set(0, 0, -FADE_DISTANCE_METRES);
    this.object.visible = false;
    camera.add(this.object);
  }

  /** `opacity` is clamped to [0, 1]; 0 hides the fade entirely. */
  setOpacity(opacity: number): void {
    const clamped = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0;
    this.object.material.opacity = clamped;
    this.object.visible = clamped > 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
  }
}

export interface VRCutsceneFadeEnvelopeConfiguration {
  readonly totalDurationMilliseconds: number;
}

const DEFAULT_ENVELOPE_CONFIGURATION: VRCutsceneFadeEnvelopeConfiguration = {
  totalDurationMilliseconds: 260,
};

/**
 * Tracks the fade's triangular opacity envelope (0 → 1 → 0) once triggered,
 * kept separate from the THREE-dependent host so the timing math is
 * testable without a renderer.
 */
export class VRCutsceneFadeEnvelope {
  private readonly configuration: VRCutsceneFadeEnvelopeConfiguration;
  private triggeredAt: number | null = null;

  constructor(configuration: Partial<VRCutsceneFadeEnvelopeConfiguration> = {}) {
    this.configuration = { ...DEFAULT_ENVELOPE_CONFIGURATION, ...configuration };
    if (
      !Number.isFinite(this.configuration.totalDurationMilliseconds) ||
      this.configuration.totalDurationMilliseconds <= 0
    ) {
      throw new RangeError('totalDurationMilliseconds must be finite and positive');
    }
  }

  trigger(timestamp: number): void {
    if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be finite');
    this.triggeredAt = timestamp;
  }

  /** Returns the current opacity in [0, 1] for `timestamp`, 0 once the envelope has finished. */
  sample(timestamp: number): number {
    if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be finite');
    if (this.triggeredAt === null) return 0;
    const elapsed = timestamp - this.triggeredAt;
    const half = this.configuration.totalDurationMilliseconds / 2;
    if (elapsed < 0 || elapsed >= this.configuration.totalDurationMilliseconds) return 0;
    return elapsed < half ? elapsed / half : 1 - (elapsed - half) / half;
  }

  reset(): void {
    this.triggeredAt = null;
  }
}
