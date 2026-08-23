import * as THREE from 'three';

export interface VRCombatTargetHighlight {
  readonly id: string;
  /** The creature's base position in world space. Engine world up is +Z. */
  readonly position: THREE.Vector3;
}

export interface VRCombatTargetHighlightOptions {
  readonly innerRadiusMetres: number;
  readonly outerRadiusMetres: number;
  /** Lifted off the floor so it does not z-fight the walkmesh. */
  readonly groundClearanceMetres: number;
  readonly colour: number;
}

const DEFAULT_OPTIONS: VRCombatTargetHighlightOptions = {
  innerRadiusMetres: 0.52,
  outerRadiusMetres: 0.62,
  groundClearanceMetres: 0.02,
  colour: 0xff5540,
};

/**
 * World-space highlight on the creature the action wheel is acting on
 * (ROADMAP 4.8).
 *
 * The wheel captures its target when it opens and cannot re-aim while held, so
 * the player needs to see *which* enemy the page in front of them applies to.
 * A name alone cannot settle that — two identical Sith troopers have the same
 * name — so this marks the actual creature.
 *
 * Originally this was to be the engine's own name plate and health bar via
 * `CursorManager`. Those live in `InGameOverlay`, which is no longer presented
 * in VR at all, so the readout moved into the world instead. That is the better
 * outcome: it is diegetic, needs no 2D surface, and is unambiguous about which
 * target it means.
 *
 * A flat ring at the creature's feet rather than an outline: it never occludes
 * the creature, reads at a glance from any angle, and matches what KOTOR's own
 * selection reticle already does on the flat screen.
 */
export class VRCombatTargetHighlightHost {
  readonly object: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly options: VRCombatTargetHighlightOptions;

  constructor(worldScene: THREE.Object3D, options: Partial<VRCombatTargetHighlightOptions> = {}) {
    if (!worldScene) throw new TypeError('VR combat target highlight requires a world scene');
    this.options = { ...DEFAULT_OPTIONS, ...options };
    VRCombatTargetHighlightHost.validateOptions(this.options);

    this.object = new THREE.Mesh(
      // Ring geometry is authored in the XY plane, which is already the ground
      // plane in this engine's Z-up world — so no rotation is needed, and none
      // should be added.
      new THREE.RingGeometry(
        this.options.innerRadiusMetres,
        this.options.outerRadiusMetres,
        48,
      ),
      new THREE.MeshBasicMaterial({
        color: this.options.colour,
        transparent: true,
        opacity: 0.85,
        // Visible through geometry: the ring is a readout, and a target behind
        // a crate is exactly when knowing which one matters.
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.object.name = 'Kotor2VR.CombatTargetHighlight';
    this.object.renderOrder = 1_000_003;
    this.object.visible = false;
    worldScene.add(this.object);
  }

  get isVisible(): boolean {
    return this.object.visible;
  }

  present(highlight: VRCombatTargetHighlight | null): void {
    const position = highlight?.position;
    // A non-finite position would put the ring at the world origin, which reads
    // as a real highlight on nothing. Showing nothing is the honest outcome.
    if (!position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)) {
      this.clear();
      return;
    }

    this.object.position.set(
      position.x,
      position.y,
      position.z + this.options.groundClearanceMetres,
    );
    this.object.visible = true;
  }

  clear(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
  }

  private static validateOptions(options: VRCombatTargetHighlightOptions): void {
    const { innerRadiusMetres, outerRadiusMetres, groundClearanceMetres } = options;
    for (const [name, value] of Object.entries({ innerRadiusMetres, outerRadiusMetres })) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a positive finite number`);
      }
    }
    if (outerRadiusMetres <= innerRadiusMetres) {
      throw new RangeError('outerRadiusMetres must exceed innerRadiusMetres');
    }
    if (!Number.isFinite(groundClearanceMetres) || groundClearanceMetres < 0) {
      throw new RangeError('groundClearanceMetres must be a non-negative finite number');
    }
  }
}
