import * as THREE from 'three';

const RING_SIZE_METRES = 0.05;
const RING_LOCAL_OFFSET = new THREE.Vector3(0, 0, -0.12);

/**
 * Diegetic round-timer indicator (ROADMAP 3.5): a small ring on the weapon
 * hilt itself rather than a HUD element, filling as the next roll-eligible
 * swing/shot becomes available. Presented as a child of the right-hand
 * controller anchor so it tracks the weapon with no extra per-frame
 * transform work.
 */
export class VRHiltTimerHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastDrawnReadiness = -1;

  constructor(private readonly handAnchor: THREE.Object3D) {
    if (typeof document === 'undefined') throw new Error('VR hilt timer requires a browser document');
    this.canvas = document.createElement('canvas');
    this.canvas.width = 128;
    this.canvas.height = 128;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR hilt timer canvas context unavailable');
    this.context = context;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(RING_SIZE_METRES, RING_SIZE_METRES),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.object.name = 'Kotor2VR.HiltTimer';
    this.object.renderOrder = 1_000_004;
    this.object.position.copy(RING_LOCAL_OFFSET);
    this.object.visible = false;
    handAnchor.add(this.object);
  }

  /** `readiness` is clamped to [0, 1]; hides the ring entirely at 1 (ready, nothing to show). */
  present(readiness: number): void {
    const clamped = Number.isFinite(readiness) ? Math.min(1, Math.max(0, readiness)) : 1;
    if (clamped >= 1) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    if (Math.abs(clamped - this.lastDrawnReadiness) < 0.02) return;
    this.lastDrawnReadiness = clamped;
    this.draw(clamped);
  }

  clear(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
  }

  private draw(readiness: number): void {
    const size = this.canvas.width;
    const center = size / 2;
    const radius = size * 0.4;
    this.context.clearRect(0, 0, size, size);

    this.context.strokeStyle = 'rgba(40, 40, 40, 0.65)';
    this.context.lineWidth = size * 0.12;
    this.context.beginPath();
    this.context.arc(center, center, radius, 0, Math.PI * 2);
    this.context.stroke();

    this.context.strokeStyle = readiness >= 1 ? '#5cffb1' : '#62e8ff';
    this.context.lineWidth = size * 0.12;
    this.context.beginPath();
    this.context.arc(center, center, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * readiness);
    this.context.stroke();

    this.texture.needsUpdate = true;
  }
}
