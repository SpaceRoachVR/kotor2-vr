import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';
import { resolveVRKeyboardKeyAtUV, VR_KEYBOARD_LAYOUT } from './VRKeyboardLayout';

/** A controller-ray-selectable keyboard surface for legacy editable labels. */
export class VRKeyboardHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private positioned = false;

  get isVisible(): boolean { return this.object.visible; }

  constructor(scene: THREE.Scene) {
    if (typeof document === 'undefined') throw new Error('VR keyboard requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1200;
    this.canvas.height = 480;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.encoding = THREE.sRGBEncoding;
    this.draw();
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    }));
    this.object.name = 'Kotor2VR.Keyboard';
    this.object.visible = false;
    this.object.renderOrder = 1_000_003;
    scene.add(this.object);
  }

  present(head: XRWorldPose): void {
    if (this.positioned) {
      this.object.visible = true;
      return;
    }
    // Sit below eye level by default so the panel above it (e.g. a
    // name-entry popup showing the text being typed) stays clear rather
    // than being occluded by the keyboard plane.
    const lowered = head.position.clone().setZ(head.position.z - 0.35);
    this.place(lowered, head);
    this.positioned = true;
    this.object.visible = true;
  }

  /** Moves the keyboard as an intentional grab action, never with head tracking. */
  moveTo(hand: XRWorldPose, head: XRWorldPose): void {
    const target = hand.position.clone().add(new THREE.Vector3(0, 0, 0.15));
    this.place(target, head);
    this.positioned = true;
    this.object.visible = true;
  }

  private place(origin: THREE.Vector3, head: XRWorldPose): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(head.orientation);
    forward.z = 0;
    if (forward.lengthSq() < 1e-8) return;
    forward.normalize();
    this.object.position.copy(origin).addScaledVector(forward, 0.7);
    this.object.position.z = Math.max(origin.z, head.position.z - 0.35);
    const normal = forward.clone().negate();
    const right = new THREE.Vector3(0, 0, 1).cross(normal).normalize();
    this.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 0, 1), normal));
    this.object.scale.set(1.15, 0.46, 1);
  }

  clear(): void { this.object.visible = false; this.positioned = false; }

  keyAtRay(pose: XRWorldPose): string | null {
    if (!this.object.visible) return null;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation).normalize();
    this.raycaster.set(pose.position, direction);
    // `present` and `moveTo` can change the plane after the scene's update
    // pass. Raycaster uses matrixWorld, so synchronize it before intersecting.
    this.object.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObject(this.object, false)[0];
    if (!hit?.uv) return null;
    return resolveVRKeyboardKeyAtUV(hit.uv.x, hit.uv.y);
  }

  dispose(): void { this.object.removeFromParent(); this.object.geometry.dispose(); this.object.material.dispose(); this.texture.dispose(); }

  private draw(): void {
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR keyboard canvas context unavailable');
    context.fillStyle = 'rgba(2, 12, 16, 0.94)'; context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    context.font = 'bold 38px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle';
    for (const key of VR_KEYBOARD_LAYOUT) {
      const x = key.x * 120 + 5;
      const y = key.y * 120 + 5;
      const width = key.width * 120 - 10;
      const height = key.height * 120 - 10;
      context.fillStyle = 'rgba(8, 48, 58, 0.96)'; context.fillRect(x, y, width, height);
      context.strokeStyle = '#62e8ff'; context.lineWidth = 3; context.strokeRect(x, y, width, height);
      context.fillStyle = '#f4feff'; context.fillText(key.label, x + width / 2, y + height / 2);
    }
    this.texture.needsUpdate = true;
  }
}
