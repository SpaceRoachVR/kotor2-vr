import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

/**
 * Owns rig-relative hand visuals and controller-ray anchors.
 */
export class XRControllerAnchorHost {
  private readonly anchors: Readonly<Record<XRHandRole, THREE.Group>>;
  private readonly rayAnchors: Readonly<Record<XRHandRole, THREE.Group>>;
  private readonly heldVisuals: Record<XRHandRole, THREE.Object3D | null> = { left: null, right: null };
  /** Sources are cached so an equipped model is cloned only when equipment changes. */
  private readonly heldSources: Record<XRHandRole, THREE.Object3D | null> = { left: null, right: null };
  private readonly disposableGeometries: THREE.BufferGeometry[] = [];
  private readonly disposableMaterials: THREE.Material[] = [];

  constructor(
    private readonly rig: THREE.Object3D,
    // Purpose-built pointer/cursor systems (panel, radial menu, keyboard) and
    // the world-interaction target label already show where a hand is aimed.
    // This raw debug ray is redundant with those in normal play — up to
    // three ray-like things could be visible on one hand at once — so it
    // defaults off; pass `true` to re-enable it for interaction debugging.
    showDebugGeometry = false
  ) {
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
      anchor.visible = true;
      rayAnchor.visible = targetRayPose.trackingState !== 'unavailable' && this.heldVisuals[hand] === null;
    }
  }

  /** Attaches a cloned, engine-owned weapon/item model to the tracked hand. */
  setHeldVisual(hand: XRHandRole, source: THREE.Object3D | null): void {
    if (this.heldSources[hand] === source) return;
    const anchor = this.anchors[hand];
    const existing = this.heldVisuals[hand];
    if (existing) anchor.remove(existing);
    this.heldSources[hand] = source;
    if (!source) {
      this.heldVisuals[hand] = null;
      return;
    }

    const visual = source.clone(true);
    visual.name = `Kotor2VR.${hand}HeldItem`;
    visual.updateWorldMatrix(true, true);
    const size = new THREE.Box3().setFromObject(visual).getSize(new THREE.Vector3());
    const longestDimension = Math.max(size.x, size.y, size.z);
    // Odyssey models span wildly different source-unit sizes. Normalize the
    // cloned presentation model to a physical, readable 28 cm held item.
    const normalizedScale = Number.isFinite(longestDimension) && longestDimension > 0.0001
      ? 0.28 / longestDimension
      : 0.01;
    visual.scale.multiplyScalar(normalizedScale);
    visual.rotation.set(Math.PI / 2, 0, 0);
    anchor.add(visual);
    this.heldVisuals[hand] = visual;
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
    this.clear();
    this.rig.remove(
      this.anchors.left,
      this.anchors.right,
      this.rayAnchors.left,
      this.rayAnchors.right
    );
    for (const geometry of this.disposableGeometries) geometry.dispose();
    for (const material of this.disposableMaterials) material.dispose();
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
