import * as THREE from 'three';

const VIGNETTE_DISTANCE_METRES = 0.12;
const VIGNETTE_SIZE_METRES = 0.5;

/**
 * Comfort vignette (ROADMAP 2.5): narrows the effective field of view during
 * movement, a standard mitigation for vection-induced discomfort. Attached
 * as a child of the XR camera so it always tracks the head with no extra
 * per-frame transform work — only its opacity changes.
 */
export class VRComfortVignetteHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly texture: THREE.CanvasTexture;

  constructor(camera: THREE.Camera) {
    if (typeof document === 'undefined') throw new Error('VR comfort vignette requires a browser document');
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('VR comfort vignette canvas context unavailable');
    const gradient = context.createRadialGradient(256, 256, 140, 256, 256, 256);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    this.texture = new THREE.CanvasTexture(canvas);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(VIGNETTE_SIZE_METRES, VIGNETTE_SIZE_METRES),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.object.name = 'Kotor2VR.ComfortVignette';
    this.object.renderOrder = 1_000_004;
    this.object.position.set(0, 0, -VIGNETTE_DISTANCE_METRES);
    this.object.visible = false;
    camera.add(this.object);
  }

  /** `intensity` is clamped to [0, 1]; 0 hides the vignette entirely. */
  setIntensity(intensity: number): void {
    const clamped = Number.isFinite(intensity) ? Math.min(1, Math.max(0, intensity)) : 0;
    this.object.material.opacity = clamped;
    this.object.visible = clamped > 0;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.texture.dispose();
  }
}
