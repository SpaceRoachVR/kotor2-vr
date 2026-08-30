import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';

export interface VRComfortSettingsRow {
  readonly label: string;
  readonly value: string;
}

const PANEL_WIDTH_METRES = 0.9;
const PANEL_HEIGHT_METRES = 0.5;
const ROW_COUNT = 4;

/**
 * Comfort settings surface (ROADMAP 2.6) — the settings VRSpike's own
 * ToggleLocomotionMode button doesn't reach: turn mode, snap-turn angle,
 * and the comfort vignette. A simple four-row cycle panel, raycast
 * hit-tested the same way as VRKeyboardHost.keyAtRay: point at a row,
 * press Select to cycle its value.
 */
export class VRComfortSettingsHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private positioned = false;
  private lastDrawnRows: readonly VRComfortSettingsRow[] | null = null;

  constructor(scene: THREE.Scene) {
    if (typeof document === 'undefined') throw new Error('VR comfort settings requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 900;
    this.canvas.height = 500;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR comfort settings canvas context unavailable');
    this.context = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.texture, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      })
    );
    this.object.name = 'Kotor2VR.ComfortSettings';
    this.object.scale.set(PANEL_WIDTH_METRES, PANEL_HEIGHT_METRES, 1);
    this.object.visible = false;
    this.object.renderOrder = 1_000_004;
    scene.add(this.object);
  }

  present(head: XRWorldPose, rows: readonly VRComfortSettingsRow[]): void {
    if (rows.length !== ROW_COUNT) {
      throw new RangeError(`VR comfort settings requires exactly ${ROW_COUNT} rows`);
    }
    if (!this.positioned) {
      this.place(head);
      this.positioned = true;
    }
    this.object.visible = true;
    if (!this.rowsEqual(rows, this.lastDrawnRows)) {
      this.lastDrawnRows = rows;
      this.draw(rows);
    }
  }

  clear(): void {
    this.object.visible = false;
    this.positioned = false;
    this.lastDrawnRows = null;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
  }

  /** Returns the row index (0-based) the given ray currently intersects, or null. */
  rowAtRay(pose: XRWorldPose): number | null {
    if (!this.object.visible) return null;
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(pose.orientation).normalize();
    this.raycaster.set(pose.position, direction);
    this.object.updateWorldMatrix(true, false);
    const hit = this.raycaster.intersectObject(this.object, false)[0];
    if (!hit?.uv) return null;
    const rowHeight = 1 / ROW_COUNT;
    // Canvas row 0 is drawn at the top, but UV.y = 0 is the plane's bottom.
    const rowFromTop = Math.floor((1 - hit.uv.y) / rowHeight);
    return Math.min(ROW_COUNT - 1, Math.max(0, rowFromTop));
  }

  private place(head: XRWorldPose): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(head.orientation);
    forward.z = 0;
    if (forward.lengthSq() < 1e-8) forward.set(0, 1, 0);
    forward.normalize();
    this.object.position.copy(head.position).addScaledVector(forward, 1.1);
    const normal = forward.clone().negate();
    const right = new THREE.Vector3(0, 0, 1).cross(normal).normalize();
    this.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, new THREE.Vector3(0, 0, 1), normal));
  }

  private rowsEqual(a: readonly VRComfortSettingsRow[], b: readonly VRComfortSettingsRow[] | null): boolean {
    if (!b || a.length !== b.length) return false;
    return a.every((row, index) => row.label === b[index].label && row.value === b[index].value);
  }

  private draw(rows: readonly VRComfortSettingsRow[]): void {
    const width = this.canvas.width;
    const height = this.canvas.height;
    const rowHeight = height / ROW_COUNT;
    this.context.fillStyle = 'rgba(2, 12, 16, 0.94)';
    this.context.fillRect(0, 0, width, height);
    this.context.font = 'bold 34px Arial';
    this.context.textBaseline = 'middle';
    rows.forEach((row, index) => {
      const y = index * rowHeight;
      this.context.fillStyle = index % 2 === 0 ? 'rgba(8, 48, 58, 0.7)' : 'rgba(8, 48, 58, 0.5)';
      this.context.fillRect(0, y, width, rowHeight);
      this.context.strokeStyle = '#62e8ff';
      this.context.lineWidth = 2;
      this.context.strokeRect(2, y + 2, width - 4, rowHeight - 4);
      this.context.textAlign = 'left';
      this.context.fillStyle = '#f4feff';
      this.context.fillText(row.label, 30, y + rowHeight / 2);
      this.context.textAlign = 'right';
      this.context.fillStyle = '#d7f45b';
      this.context.fillText(row.value, width - 30, y + rowHeight / 2);
    });
    this.texture.needsUpdate = true;
  }
}
