import * as THREE from 'three';

/**
 * Makes an engine pause unmistakable (ROADMAP 3.18). The world dims and a
 * small "PAUSED" plate sits low in the view, both head-locked. Every VR
 * surface — the wheel, panels, the hilt readout — draws above the dimming
 * (render order 999_999 and up), so planning while paused stays readable.
 */

const DIM_DISTANCE_METRES = 0.13;
const DIM_SIZE_METRES = 0.6;
const DIM_OPACITY = 0.35;
const LABEL_DISTANCE_METRES = 0.9;
const LABEL_WIDTH_METRES = 0.22;
const LABEL_HEIGHT_METRES = 0.055;
/** Below the horizon so it never covers what the player is aiming at. */
const LABEL_DROP_METRES = 0.3;
/** Under every VR surface (999_999 and up), above the world. */
const DIM_RENDER_ORDER = 999_998;

export type VRPauseLabelTextureFactory = () => THREE.Texture | null;

export class VRPauseIndicatorHost {
  readonly object: THREE.Group;
  private readonly dim: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;

  constructor(camera: THREE.Object3D, createLabelTexture: VRPauseLabelTextureFactory = createPausedLabelTexture) {
    if (!camera) throw new TypeError('VR pause indicator requires a camera');
    this.object = new THREE.Group();
    this.object.name = 'Kotor2VR.PauseIndicator';
    this.object.visible = false;
    camera.add(this.object);

    this.dim = new THREE.Mesh(
      new THREE.PlaneGeometry(DIM_SIZE_METRES, DIM_SIZE_METRES),
      new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: DIM_OPACITY,
        depthTest: false, depthWrite: false, toneMapped: false,
      }),
    );
    this.dim.name = 'Kotor2VR.PauseIndicator.Dim';
    this.dim.renderOrder = DIM_RENDER_ORDER;
    this.dim.position.set(0, 0, -DIM_DISTANCE_METRES);
    this.object.add(this.dim);

    const texture = createLabelTexture();
    this.label = texture
      ? new THREE.Mesh(
        new THREE.PlaneGeometry(LABEL_WIDTH_METRES, LABEL_HEIGHT_METRES),
        new THREE.MeshBasicMaterial({
          map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
        }),
      )
      : null;
    if (this.label) {
      this.label.name = 'Kotor2VR.PauseIndicator.Label';
      this.label.renderOrder = DIM_RENDER_ORDER + 1;
      this.label.position.set(0, -LABEL_DROP_METRES, -LABEL_DISTANCE_METRES);
      this.object.add(this.label);
    }
  }

  get isVisible(): boolean {
    return this.object.visible;
  }

  present(paused: boolean): void {
    this.object.visible = paused === true;
  }

  dispose(): void {
    this.dim.geometry.dispose();
    this.dim.material.dispose();
    if (this.label) {
      this.label.geometry.dispose();
      this.label.material.map?.dispose();
      this.label.material.dispose();
    }
    this.object.removeFromParent();
  }
}

function createPausedLabelTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = 'rgba(8, 20, 28, 0.8)';
  context.fillRect(0, 0, 512, 128);
  context.strokeStyle = '#62e8ff';
  context.lineWidth = 6;
  context.strokeRect(3, 3, 506, 122);
  context.fillStyle = '#e6fbff';
  context.font = 'bold 64px sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('PAUSED', 256, 66);
  return new THREE.CanvasTexture(canvas);
}
