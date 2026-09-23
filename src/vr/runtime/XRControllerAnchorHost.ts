import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';
import type { VRHandModel, VRHandModelLoader } from './hands/VRHandModel';
import { resolveVRHandFingerCurl, smoothVRHandFingerCurl } from './hands/VRHandFingerCurl';

export interface XRControllerAnchorHostOptions {
  /**
   * Supplies the skinned first-person hand. Injected rather than imported:
   * the production loader pulls in three's ESM GLTF loader, which neither
   * this module's unit tests nor anything else outside the bundle can load.
   * Without one, humanoid hands are simply not drawn.
   */
  readonly loadHandModel?: VRHandModelLoader | null;
}

type HandModelLoadState = 'idle' | 'loading' | 'ready' | 'failed';

/** Explicit, physical-space correction used only when an authored grip is absent. */
export interface HeldItemClassFallbackTransform {
  readonly position?: THREE.Vector3;
  readonly rotation?: THREE.Euler;
  readonly scale?: number;
}

/**
 * Engine ownership stays with `model`; the hand host owns only its flattened
 * presentation copy. Authored grip nodes win over per-class fallbacks.
 */
export interface HeldItemVisualDescriptor {
  readonly model: THREE.Object3D;
  readonly baseItemClass: string;
  readonly authoredGripNode?: THREE.Object3D | null;
  readonly classFallback: HeldItemClassFallbackTransform;
  /**
   * A ranged weapon: the hand's gameplay ray leaves its muzzle along its
   * barrel instead of along the controller's own target ray. See
   * {@link XRControllerAnchorHost.getAimPose}.
   */
  readonly aimsAlongBarrel?: boolean;
}

/** A held weapon's muzzle and barrel direction, in its grip anchor's space. */
export interface HeldItemBarrel {
  readonly origin: THREE.Vector3;
  readonly direction: THREE.Vector3;
}

/**
 * Below this a model has no barrel worth aiming along — an empty or degenerate
 * mesh — and the controller's own ray is the better answer.
 */
const MINIMUM_BARREL_LENGTH_METRES = 0.05;

const CONTROLLER_RAY_FORWARD = new THREE.Vector3(0, 0, -1);

/**
 * Finds a held weapon's barrel from its own geometry, in grip space.
 *
 * Odyssey weapon models are authored axis-aligned, and a gun's longest extent
 * is its barrel. The grip origin sits in the handle, so the barrel reaches much
 * further toward the muzzle than behind it; that side is the muzzle. Measured
 * on the Mining Laser held in the headset: grip-space bounds y -0.304..0.068,
 * z -0.146..0.067, x -0.055..0.075 — barrel along -Y, muzzle 30 cm out.
 *
 * Measured rather than tabled because the same half-turn fallback serves every
 * weapon class and a per-class table would silently drift from the model.
 */
export function measureHeldItemBarrel(visual: THREE.Object3D): HeldItemBarrel | null {
  visual.updateMatrix();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const vertex = new THREE.Vector3();
  const toAnchor = new THREE.Matrix4();
  let sampled = 0;
  visual.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const positions = (mesh as { isMesh?: boolean }).isMesh
      ? mesh.geometry?.getAttribute?.('position')
      : undefined;
    if (!positions) return;
    // Composed from each link's own `matrix`, never recomputed: the
    // presentation clone's meshes carry hand-set matrices with
    // `matrixAutoUpdate` off, and `updateMatrix()` would reset them to identity.
    toAnchor.copy(visual.matrix);
    const chain: THREE.Object3D[] = [];
    for (let current: THREE.Object3D | null = mesh; current && current !== visual; current = current.parent) {
      chain.unshift(current);
    }
    for (const link of chain) toAnchor.multiply(link.matrix);
    for (let index = 0; index < positions.count; index++) {
      vertex.fromBufferAttribute(positions as THREE.BufferAttribute, index).applyMatrix4(toAnchor);
      min.min(vertex);
      max.max(vertex);
      sampled++;
    }
  });
  if (sampled === 0) return null;

  const extent = new THREE.Vector3().subVectors(max, min);
  const axis: 'x' | 'y' | 'z' = extent.x >= extent.y && extent.x >= extent.z
    ? 'x'
    : extent.y >= extent.z ? 'y' : 'z';
  if (!(extent[axis] >= MINIMUM_BARREL_LENGTH_METRES)) return null;

  const towardMax = Math.abs(max[axis]) >= Math.abs(min[axis]);
  const origin = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  origin[axis] = towardMax ? max[axis] : min[axis];
  const direction = new THREE.Vector3();
  direction[axis] = towardMax ? 1 : -1;
  return { origin, direction };
}

/**
 * Builds a render-only copy of an engine model for the hand anchor.
 *
 * `Object3D.clone()` cannot be used here. Three's `Object3D.copy` deep-copies
 * `userData` with `JSON.parse(JSON.stringify(...))`, and every Odyssey node
 * carries a `userData` graph that refers back to its own meshes — so cloning
 * an equipped weapon threw `Converting circular structure to JSON` on the
 * first XR frame that had anything in hand, taking the whole tracked-input
 * update down with it.
 *
 * Only world-space geometry and materials matter for a held presentation
 * model, so flatten the source's visible meshes into plain meshes that share
 * (never copy) their geometry and material. Nothing engine-owned is mutated,
 * and there is no `userData` to serialize.
 */
function createPresentationClone(
  source: THREE.Object3D,
  authoredGripNode: THREE.Object3D | null
): THREE.Object3D {
  const root = new THREE.Group();
  source.updateWorldMatrix(true, true);
  const presentationOrigin = authoredGripNode ?? source;
  const inversePresentationMatrix = new THREE.Matrix4().copy(presentationOrigin.matrixWorld).invert();

  source.traverseVisible((node) => {
    const mesh = node as THREE.Mesh;
    if (!(mesh as { isMesh?: boolean }).isMesh || !mesh.geometry || !mesh.material) return;
    // Share the engine's geometry/material rather than copying them: this is a
    // presentation-only mirror, so it must never own — or dispose — resources
    // the module still renders with.
    const copy = new THREE.Mesh(mesh.geometry, mesh.material);
    copy.matrixAutoUpdate = false;
    // Re-express each mesh relative to the authored grip (or model root) so
    // the flattened result keeps the original internal layout at the hand.
    copy.matrix.multiplyMatrices(inversePresentationMatrix, mesh.matrixWorld);
    copy.frustumCulled = false;
    root.add(copy);
  });

  return root;
}

/**
 * Owns rig-relative hand visuals and controller-ray anchors.
 */
export class XRControllerAnchorHost {
  private readonly anchors: Readonly<Record<XRHandRole, THREE.Group>>;
  private readonly rayAnchors: Readonly<Record<XRHandRole, THREE.Group>>;
  private readonly humanoidHandVisuals: Record<XRHandRole, THREE.Group | null> = { left: null, right: null };
  private readonly handModels: Record<XRHandRole, VRHandModel | null> = { left: null, right: null };
  private readonly handModelLoadState: Record<XRHandRole, HandModelLoadState> = { left: 'idle', right: 'idle' };
  private readonly loadHandModel: VRHandModelLoader | null;
  private lastHandPoseTimestamp: number | null = null;
  private disposed = false;
  private readonly heldVisuals: Record<XRHandRole, THREE.Object3D | null> = { left: null, right: null };
  /** Sources are cached so an equipped model is cloned only when equipment changes. */
  private readonly heldSources: Record<XRHandRole, THREE.Object3D | null> = { left: null, right: null };
  private readonly heldDescriptorKeys: Record<XRHandRole, string | null> = { left: null, right: null };
  private readonly heldBarrels: Record<XRHandRole, HeldItemBarrel | null> = { left: null, right: null };
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  constructor(
    private readonly rig: THREE.Object3D,
    // Purpose-built pointer/cursor systems (panel, radial menu, keyboard) and
    // the world-interaction target label already show where a hand is aimed.
    // This raw debug ray is redundant with those in normal play — up to
    // three ray-like things could be visible on one hand at once — so it
    // defaults off; pass `true` to re-enable it for interaction debugging.
    showDebugGeometry = false,
    options: XRControllerAnchorHostOptions = {}
  ) {
    this.loadHandModel = options.loadHandModel ?? null;
    const left = this.createAnchor('left');
    const right = this.createAnchor('right');
    const leftRay = this.createRayAnchor('left', 0x45d7ff, showDebugGeometry);
    const rightRay = this.createRayAnchor('right', 0xffa34d, showDebugGeometry);
    this.anchors = { left, right };
    this.rayAnchors = { left: leftRay, right: rightRay };
    this.rig.add(left, right, leftRay, rightRay);
    this.clear();
  }

  getAnchor(hand: XRHandRole): THREE.Group {
    return this.anchors[hand];
  }

  getRayAnchor(hand: XRHandRole): THREE.Group {
    return this.rayAnchors[hand];
  }

  /**
   * Displays first-person hands for humanoid player characters.
   *
   * Equipment remains a separate flattened presentation model on the same
   * controller anchor. That preserves the authored weapon model and grip while
   * the hand closes around it. Droid player characters pass `false`: their
   * equipment remains visibly stabilized at the dominant controller, but no
   * humanoid anatomy is shown.
   *
   * The skinned model loads asynchronously on the first `true`; until it
   * arrives the (empty) presentation group already exists, so visibility
   * toggles made during the load are honoured when it lands.
   */
  setHumanoidHandsVisible(visible: boolean): void {
    if (typeof visible !== 'boolean') {
      throw new TypeError('humanoid-hand visibility must be a boolean');
    }

    for (const hand of ['left', 'right'] as const) {
      let presentation = this.humanoidHandVisuals[hand];
      if (!presentation) {
        if (!visible) continue;
        presentation = new THREE.Group();
        presentation.name = `Kotor2VR.${hand}HumanoidHandVisual`;
        this.anchors[hand].add(presentation);
        this.humanoidHandVisuals[hand] = presentation;
      }
      presentation.visible = visible;
      if (visible) this.ensureHandModel(hand, presentation);
    }
  }

  /** The loaded skinned hand, or null while loading, absent, or failed. */
  getHandModel(hand: XRHandRole): VRHandModel | null {
    return this.handModels[hand];
  }

  private ensureHandModel(hand: XRHandRole, presentation: THREE.Group): void {
    if (this.handModelLoadState[hand] !== 'idle' || !this.loadHandModel) return;
    this.handModelLoadState[hand] = 'loading';
    let pending: Promise<VRHandModel>;
    try {
      pending = this.loadHandModel(hand);
    } catch (error) {
      this.failHandModel(hand, error);
      return;
    }
    pending.then((model) => {
      if (this.disposed) {
        model.dispose();
        return;
      }
      model.root.name = `${presentation.name}.Model`;
      presentation.add(model.root);
      this.handModels[hand] = model;
      this.handModelLoadState[hand] = 'ready';
    }, (error) => this.failHandModel(hand, error));
  }

  private failHandModel(hand: XRHandRole, error: unknown): void {
    // No retry: the model is embedded in the bundle, so a failure is a real
    // defect (a corrupt asset, a renamed joint) and retrying every frame
    // would only flood the console the way this engine's per-frame throws do.
    this.handModelLoadState[hand] = 'failed';
    console.error(`[XRControllerAnchorHost] ${hand} hand model failed to load; hands will not be drawn`, error);
  }

  /** Curls each loaded hand from its controller's buttons. */
  private updateHandPoses(inputFrame: XRInputFrame | null): void {
    const timestamp = inputFrame?.timestamp;
    const deltaSeconds = typeof timestamp === 'number' && Number.isFinite(timestamp) && this.lastHandPoseTimestamp !== null
      ? (timestamp - this.lastHandPoseTimestamp) / 1_000
      : 0;
    this.lastHandPoseTimestamp = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : null;

    for (const hand of ['left', 'right'] as const) {
      const model = this.handModels[hand];
      if (!model || !this.humanoidHandVisuals[hand]?.visible) continue;
      const target = resolveVRHandFingerCurl({
        hand: inputFrame?.hands[hand],
        holdingItem: this.heldVisuals[hand] !== null,
      });
      // The first frame (or one after a tracking gap) snaps to the pose.
      model.applyCurl(deltaSeconds > 0 ? smoothVRHandFingerCurl(model.getCurl(), target, deltaSeconds) : target);
    }
  }

  /**
   * Hides everything drawn at the controllers — hands, held weapons, the hilt
   * ring and controller rays — while poses keep updating, so anchors still
   * report correct world positions to anything that reads them. Set while a
   * movie, cutscene, conversation or menu owns the view (round 6: "player
   * hands and pointer should be invisible during cut scenes, interactions,
   * and movies").
   */
  setPresentationSuppressed(suppressed: boolean): void {
    this.presentationSuppressed = suppressed === true;
  }

  private presentationSuppressed = false;

  update(inputFrame: XRInputFrame | null): void {
    this.rig.updateWorldMatrix(true, false);
    const inverseRigOrientation = this.rig
      .getWorldQuaternion(new THREE.Quaternion())
      .invert();

    for (const hand of ['left', 'right'] as const) {
      const pose = inputFrame?.hands[hand]?.pose;
      const targetRayPose = inputFrame?.hands[hand]?.targetRayPose;
      const anchor = this.anchors[hand];
      const rayAnchor = this.rayAnchors[hand];
      if (!pose || !targetRayPose || pose.trackingState === 'unavailable') {
        anchor.visible = false;
        rayAnchor.visible = false;
        continue;
      }
      this.applyWorldPose(anchor, pose, inverseRigOrientation);
      this.applyWorldPose(rayAnchor, targetRayPose, inverseRigOrientation);
      anchor.visible = !this.presentationSuppressed;
      rayAnchor.visible = !this.presentationSuppressed &&
        targetRayPose.trackingState !== 'unavailable' && this.heldVisuals[hand] === null;
    }
    this.updateHandPoses(inputFrame);
  }

  /** Attaches a flattened presentation-only engine model to the tracked hand. */
  setHeldVisual(hand: XRHandRole, descriptor: HeldItemVisualDescriptor | null): void {
    const descriptorKey = descriptor ? XRControllerAnchorHost.getDescriptorKey(descriptor) : null;
    if (descriptor && this.heldSources[hand] === descriptor.model && this.heldDescriptorKeys[hand] === descriptorKey) return;
    const anchor = this.anchors[hand];
    const existing = this.heldVisuals[hand];
    if (existing) anchor.remove(existing);
    this.heldSources[hand] = descriptor?.model ?? null;
    this.heldDescriptorKeys[hand] = descriptorKey;
    this.heldBarrels[hand] = null;
    if (!descriptor) {
      this.heldVisuals[hand] = null;
      return;
    }

    const authoredGripNode = XRControllerAnchorHost.resolveAuthoredGripNode(descriptor);
    const visual = createPresentationClone(descriptor.model, authoredGripNode);
    visual.name = `Kotor2VR.${hand}HeldItem`;
    if (!authoredGripNode) this.applyClassFallback(visual, descriptor.classFallback);
    anchor.add(visual);
    this.heldVisuals[hand] = visual;
    // Measured once per equip, not per frame: the clone never changes shape.
    this.heldBarrels[hand] = descriptor.aimsAlongBarrel === true ? measureHeldItemBarrel(visual) : null;
  }

  /**
   * Where this hand's gameplay ray points while it holds a ranged weapon: out
   * of the muzzle, along the barrel, composed onto the hand's grip pose.
   *
   * A pistol sits in the fist along the grip, and on Touch controllers the grip
   * is pitched about 45 degrees from the target ray, so the barrel pointed well
   * below the pointer that actually aimed. Round 7: "weapon grip/character hand
   * angle is not the same as the pointer angle, which makes for confusing
   * shooting. The ray pointers should be adjusted to match the angle the
   * blasters point at." The weapon and hand stay as they are; the ray follows
   * them.
   *
   * Null without a ranged weapon, or when its barrel cannot be measured — the
   * controller ray stands in unchanged.
   */
  getAimPose(hand: XRHandRole, gripPose: XRWorldPose | null | undefined): XRWorldPose | null {
    const barrel = this.heldBarrels[hand];
    if (!barrel || !gripPose || gripPose.trackingState === 'unavailable') return null;
    const position = barrel.origin.clone().applyQuaternion(gripPose.orientation).add(gripPose.position);
    const orientation = gripPose.orientation.clone()
      .multiply(new THREE.Quaternion().setFromUnitVectors(CONTROLLER_RAY_FORWARD, barrel.direction))
      .normalize();
    return {
      position,
      orientation,
      linearVelocity: gripPose.linearVelocity,
      angularVelocity: gripPose.angularVelocity,
      trackingState: gripPose.trackingState,
    };
  }

  clear(): void {
    for (const hand of ['left', 'right'] as const) {
      const anchor = this.anchors[hand];
      const rayAnchor = this.rayAnchors[hand];
      anchor.visible = false;
      anchor.position.set(0, 0, 0);
      anchor.quaternion.identity();
      rayAnchor.visible = false;
      rayAnchor.position.set(0, 0, 0);
      rayAnchor.quaternion.identity();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clear();
    for (const hand of ['left', 'right'] as const) {
      this.handModels[hand]?.dispose();
      this.handModels[hand] = null;
    }
    this.rig.remove(
      this.anchors.left,
      this.anchors.right,
      this.rayAnchors.left,
      this.rayAnchors.right
    );
    for (const geometry of this.disposableGeometries) geometry.dispose();
    for (const material of this.disposableMaterials) material.dispose();
  }

  private applyClassFallback(
    visual: THREE.Object3D,
    fallback: HeldItemClassFallbackTransform
  ): void {
    if (!fallback || typeof fallback !== 'object') {
      throw new TypeError('held-item class fallback must be an object');
    }
    if (fallback.position) {
      if (!Number.isFinite(fallback.position.x) || !Number.isFinite(fallback.position.y) || !Number.isFinite(fallback.position.z)) {
        throw new RangeError('held-item class fallback position must be finite');
      }
      visual.position.copy(fallback.position);
    }
    if (fallback.rotation) {
      if (!Number.isFinite(fallback.rotation.x) || !Number.isFinite(fallback.rotation.y) || !Number.isFinite(fallback.rotation.z)) {
        throw new RangeError('held-item class fallback rotation must be finite');
      }
      visual.rotation.copy(fallback.rotation);
    }
    if (fallback.scale !== undefined) {
      if (!Number.isFinite(fallback.scale) || fallback.scale <= 0) {
        throw new RangeError('held-item class fallback scale must be finite and positive');
      }
      visual.scale.setScalar(fallback.scale);
    }
  }

  private static resolveAuthoredGripNode(descriptor: HeldItemVisualDescriptor): THREE.Object3D | null {
    const candidate = descriptor.authoredGripNode;
    if (!candidate) return null;
    let belongsToModel = candidate === descriptor.model;
    if (!belongsToModel) {
      descriptor.model.traverse((node) => { if (node === candidate) belongsToModel = true; });
    }
    return belongsToModel ? candidate : null;
  }

  private static getDescriptorKey(descriptor: HeldItemVisualDescriptor): string {
    if (!(descriptor.model instanceof THREE.Object3D)) {
      throw new TypeError('held-item descriptor model must be a THREE.Object3D');
    }
    if (typeof descriptor.baseItemClass !== 'string' || !descriptor.baseItemClass.trim()) {
      throw new TypeError('held-item descriptor baseItemClass must be a non-empty string');
    }
    const fallback = descriptor.classFallback;
    if (!fallback || typeof fallback !== 'object') {
      throw new TypeError('held-item descriptor classFallback must be an object');
    }
    const position = fallback.position ? `${fallback.position.x},${fallback.position.y},${fallback.position.z}` : '';
    const rotation = fallback.rotation ? `${fallback.rotation.x},${fallback.rotation.y},${fallback.rotation.z},${fallback.rotation.order}` : '';
    const scale = fallback.scale ?? '';
    const barrel = descriptor.aimsAlongBarrel === true ? 'barrel' : '';
    return `${descriptor.baseItemClass.trim()}|${descriptor.authoredGripNode?.uuid ?? ''}|${position}|${rotation}|${scale}|${barrel}`;
  }

  private applyWorldPose(
    anchor: THREE.Group,
    pose: XRWorldPose,
    inverseRigOrientation: THREE.Quaternion
  ): void {
    anchor.position.copy(pose.position);
    this.rig.worldToLocal(anchor.position);
    anchor.quaternion
      .copy(inverseRigOrientation)
      .multiply(pose.orientation)
      .normalize();
  }

  private createAnchor(
    hand: XRHandRole
  ): THREE.Group {
    const anchor = new THREE.Group();
    anchor.name = `Kotor2VR.${hand}ControllerAnchor`;
    return anchor;
  }

  private createRayAnchor(
    hand: XRHandRole,
    color: number,
    showDebugGeometry: boolean
  ): THREE.Group {
    const anchor = new THREE.Group();
    anchor.name = `Kotor2VR.${hand}ControllerRayAnchor`;
    if (!showDebugGeometry) return anchor;

    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -0.35),
    ]);
    const rayMaterial = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.65,
      depthTest: true,
      depthWrite: false,
    });
    const ray = new THREE.Line(rayGeometry, rayMaterial);
    ray.name = `${anchor.name}.DebugRay`;
    anchor.add(ray);

    this.disposableGeometries.push(rayGeometry);
    this.disposableMaterials.push(rayMaterial);
    return anchor;
  }
}
