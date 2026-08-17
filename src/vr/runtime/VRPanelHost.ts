import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';

export interface VRPanelHostOptions {
  readonly distanceMetres: number;
  readonly widthMetres: number;
  readonly maximumTextureWidth: number;
  readonly maximumTextureHeight: number;
}

const DEFAULT_OPTIONS: VRPanelHostOptions = {
  distanceMetres: 1.5,
  widthMetres: 1.6,
  maximumTextureWidth: 1536,
  maximumTextureHeight: 1536,
};

const MAIN_MENU_RESREFS = new Set(['mainmenu8x6_p', 'mainmenu16x12']);
const MAIN_MENU_VERTICAL_OFFSET_METRES = 0.9;

/** Renders the authoritative legacy GUI scene onto a stable world-space panel. */
export class VRPanelHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly renderTarget: THREE.WebGLRenderTarget;
  private activeOwner: object | null = null;
  private textureWidth = 1;
  private textureHeight = 1;
  private readonly options: VRPanelHostOptions;
  private readonly lastHorizontalForward = new THREE.Vector3(0, 1, 0);

  constructor(worldScene: THREE.Scene, options: Partial<VRPanelHostOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    VRPanelHost.validateOptions(this.options);

    this.renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.renderTarget.texture.name = 'Kotor2VR.legacy-gui';
    this.renderTarget.texture.encoding = THREE.sRGBEncoding;

    const material = new THREE.MeshBasicMaterial({
      map: this.renderTarget.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.object = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.object.name = 'Kotor2VR.VRPanelHost';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 1_000_000;
    worldScene.add(this.object);
  }

  get owner(): object | null {
    return this.activeOwner;
  }

  get isVisible(): boolean {
    return this.object.visible;
  }

  present(
    owner: object,
    headPose: XRWorldPose,
    viewportWidth: number,
    viewportHeight: number
  ): void {
    if (!owner) throw new TypeError('VR panel owner is required');
    VRPanelHost.validateViewport(viewportWidth, viewportHeight);
    this.resizeTexture(viewportWidth, viewportHeight);

    // A legacy menu owns one world-space surface for its entire visible
    // lifetime. Recomputing this pose every XR frame turns it into a
    // head-locked HUD and makes controller rays appear to drift with the
    // player. Only place it when a different menu opens.
    if (this.activeOwner !== owner) {
      this.place(owner, headPose);
      this.activeOwner = owner;
    }

    const aspect = viewportWidth / viewportHeight;
    this.object.scale.set(
      this.options.widthMetres,
      this.options.widthMetres / aspect,
      1
    );
    this.object.visible = true;
  }

  private place(owner: object, headPose: XRWorldPose): void {

    const forward = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(headPose.orientation);
    forward.z = 0;
    if (forward.lengthSq() > 1e-8) {
      forward.normalize();
      this.lastHorizontalForward.copy(forward);
    } else {
      forward.copy(this.lastHorizontalForward);
    }
    this.object.position.copy(headPose.position).addScaledVector(
      forward,
      this.options.distanceMetres
    );
    this.object.position.z = headPose.position.z + VRPanelHost.getVerticalOffset(owner);

    const worldUp = new THREE.Vector3(0, 0, 1);
    const panelNormal = forward.clone().negate();
    const panelRight = worldUp.clone().cross(panelNormal).normalize();
    const uprightBasis = new THREE.Matrix4().makeBasis(
      panelRight,
      worldUp,
      panelNormal
    );
    this.object.quaternion.setFromRotationMatrix(uprightBasis);

    if (!VRPanelHost.placementLogged) {
      VRPanelHost.placementLogged = true;
      // "Menu appears backward" has two very different possible causes: the
      // plane is oriented/positioned wrong (would show up here), or the
      // texture content itself is mirrored (would not — geometry is
      // correct, only the pixels are flipped). This narrows it on the next
      // headset run instead of guessing at a fix blind.
      console.info(
        '[VRPanelHost] placed panel',
        {
          headPosition: headPose.position.toArray(),
          headForward: forward.toArray(),
          panelPosition: this.object.position.toArray(),
          panelNormal: panelNormal.toArray(),
          panelRight: panelRight.toArray(),
        }
      );
    }
  }

  private static placementLogged = false;

  renderGui(
    renderer: THREE.WebGLRenderer,
    guiScene: THREE.Scene,
    guiCamera: THREE.Camera
  ): void {
    const previousTarget = renderer.getRenderTarget();
    const previousXREnabled = renderer.xr.enabled;
    const previousAutoClear = renderer.autoClear;
    const previousClearAlpha = renderer.getClearAlpha();
    try {
      // Three substitutes the stereo XR cameras whenever XR is enabled, even
      // for an unrelated offscreen target. The legacy orthographic GUI camera
      // must remain authoritative for this pass.
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      renderer.setRenderTarget(this.renderTarget);
      renderer.setClearAlpha(0);
      renderer.clear(true, true, true);
      renderer.render(guiScene, guiCamera);
    } finally {
      renderer.setClearAlpha(previousClearAlpha);
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
      renderer.xr.enabled = previousXREnabled;
    }
  }

  clear(): void {
    this.activeOwner = null;
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.renderTarget.dispose();
  }

  private resizeTexture(viewportWidth: number, viewportHeight: number): void {
    const scale = Math.min(
      1,
      this.options.maximumTextureWidth / viewportWidth,
      this.options.maximumTextureHeight / viewportHeight
    );
    const width = Math.max(1, Math.round(viewportWidth * scale));
    const height = Math.max(1, Math.round(viewportHeight * scale));
    if (width === this.textureWidth && height === this.textureHeight) return;
    this.textureWidth = width;
    this.textureHeight = height;
    this.renderTarget.setSize(width, height);
  }

  private static validateOptions(options: VRPanelHostOptions): void {
    for (const [name, value] of Object.entries(options)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a finite positive number`);
      }
    }
  }

  private static validateViewport(width: number, height: number): void {
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
      throw new RangeError('VR panel viewport dimensions must be finite positive numbers');
    }
  }

  /**
   * The retail main-menu layouts leave their interactive content in the lower
   * half of the legacy canvas. Raise only those authored menus; chargen and
   * in-game panels already use their canvas centre as their visual centre.
   */
  private static getVerticalOffset(owner: object): number {
    const resref = (owner as { gui_resref?: unknown }).gui_resref;
    return typeof resref === 'string' && MAIN_MENU_RESREFS.has(resref.toLowerCase())
      ? MAIN_MENU_VERTICAL_OFFSET_METRES
      : 0;
  }
}
