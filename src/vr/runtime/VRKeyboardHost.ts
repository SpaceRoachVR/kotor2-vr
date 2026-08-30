import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';
import { resolveVRKeyboardKeyAtUV, VR_KEYBOARD_DONE_KEY, VR_KEYBOARD_LAYOUT } from './VRKeyboardLayout';
import { VRKeyboardState } from './VRKeyboardInputController';

/** A controller-ray-selectable keyboard surface for legacy editable labels. */
export class VRKeyboardHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: THREE.CanvasTexture;
  private readonly cursor: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private positioned = false;
  private highlightedKey: string | null = null;
  private modifierState: VRKeyboardState = Object.freeze({ shift: false, capsLock: false });

  get isVisible(): boolean { return this.object.visible; }

  /** The key currently under the aiming ray, for tests and callers. */
  get hoveredKey(): string | null { return this.highlightedKey; }

  /** Synchronizes modifier latches with the input controller without moving the surface. */
  setModifierState(state: VRKeyboardState): void {
    if (!state || typeof state.shift !== 'boolean' || typeof state.capsLock !== 'boolean') {
      throw new TypeError('VR keyboard modifier state must contain boolean shift and capsLock values');
    }
    if (state.shift === this.modifierState.shift && state.capsLock === this.modifierState.capsLock) return;
    this.modifierState = Object.freeze({ shift: state.shift, capsLock: state.capsLock });
    this.draw();
  }

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

    // Typing on a plane you cannot aim at is guesswork. The highlighted key
    // says which key would be pressed; this dot says exactly where the ray
    // meets the plane, so near-misses at key borders are visible rather than
    // felt only after the wrong letter appears.
    this.cursor = new THREE.Mesh(
      new THREE.CircleGeometry(0.012, 24),
      new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
    );
    this.cursor.name = 'Kotor2VR.KeyboardCursor';
    this.cursor.visible = false;
    this.cursor.renderOrder = 1_000_004;
    scene.add(this.cursor);
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

  clear(): void {
    this.object.visible = false;
    this.positioned = false;
    this.cursor.visible = false;
    this.setHighlight(null);
  }

  /**
   * Resolves the aimed key and, as a side effect, shows where the ray lands.
   * One raycast drives both the returned key and the on-plane feedback so the
   * highlight can never disagree with the key that a press would produce.
   */
  keyAtRay(pose: XRWorldPose): string | null {
    if (!this.object.visible) {
      this.setHighlight(null);
      this.cursor.visible = false;
      return null;
    }
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation).normalize();
    this.raycaster.set(pose.position, direction);
    // `present` and `moveTo` can change the plane after the scene's update
    // pass. Raycaster uses matrixWorld, so synchronize it before intersecting.
    this.object.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObject(this.object, false)[0];
    if (!hit?.uv) {
      this.setHighlight(null);
      this.cursor.visible = false;
      return null;
    }

    // Lift the dot marginally off the plane along its own normal so it is not
    // z-fighting with the keyboard texture it annotates.
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(this.object.quaternion);
    this.cursor.position.copy(hit.point).addScaledVector(normal, 0.004);
    this.cursor.quaternion.copy(this.object.quaternion);
    this.cursor.visible = true;

    const key = resolveVRKeyboardKeyAtUV(hit.uv.x, hit.uv.y);
    this.setHighlight(key);
    return key;
  }

  private setHighlight(key: string | null): void {
    if (key === this.highlightedKey) return;
    this.highlightedKey = key;
    this.draw();
  }

  dispose(): void {
    this.object.removeFromParent(); this.object.geometry.dispose(); this.object.material.dispose(); this.texture.dispose();
    this.cursor.removeFromParent(); this.cursor.geometry.dispose(); this.cursor.material.dispose();
  }

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
      const aimed = key.value === this.highlightedKey;
      const done = key.value === VR_KEYBOARD_DONE_KEY;
      const modifierActive = (key.value === 'SHIFT' && this.modifierState.shift) ||
        (key.value === 'CAPS' && this.modifierState.capsLock);
      context.fillStyle = aimed
        ? 'rgba(96, 232, 255, 0.92)'
        : modifierActive ? 'rgba(251, 183, 64, 0.96)'
        : done ? 'rgba(14, 74, 52, 0.96)' : 'rgba(8, 48, 58, 0.96)';
      context.fillRect(x, y, width, height);
      context.strokeStyle = aimed ? '#ffffff' : modifierActive ? '#fff1a2' : done ? '#6dffb0' : '#62e8ff';
      context.lineWidth = aimed ? 6 : 3;
      context.strokeRect(x, y, width, height);
      context.fillStyle = aimed ? '#02222b' : '#f4feff';
      context.fillText(key.label, x + width / 2, y + height / 2);
    }
    this.texture.needsUpdate = true;
  }
}
