import * as THREE from 'three';

/**
 * Far enough that both eyes see one ring. At 0.12 m in front of the head
 * centre each eye's clear zone sat ~15 degrees toward the nose and the ring
 * would not fuse (critic run 13). At 5 m the eyes differ by under a degree.
 */
const VIGNETTE_DISTANCE_METRES = 5;
/** Covers about 76 degrees off centre: past the edge of a Quest's view. */
const VIGNETTE_SIZE_METRES = 1.0 * VIGNETTE_DISTANCE_METRES / 0.12;
/**
 * Clear within 28 degrees of centre, fully dark from 50. The clear zone was
 * 48.7 degrees, so it never darkened the top or bottom of a Quest's view and
 * barely touched the sides (critic run 12).
 */
const CLEAR_DEGREES = 28;
const DARK_DEGREES = 50;

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
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('VR comfort vignette canvas context unavailable');
    const pixelsPerMetre = 512 / (VIGNETTE_SIZE_METRES / 2);
    const radiusAt = (degrees: number) => Math.tan(THREE.MathUtils.degToRad(degrees)) * VIGNETTE_DISTANCE_METRES * pixelsPerMetre;
    const inner = radiusAt(CLEAR_DEGREES);
    const outer = radiusAt(DARK_DEGREES);
    context.fillStyle = 'rgba(0, 0, 0, 1)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'destination-out';
    const gradient = context.createRadialGradient(512, 512, inner, 512, 512, outer);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
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
