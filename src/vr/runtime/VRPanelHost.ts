import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';
import { captureVRPanelRepaintSignals, VRPanelRepaintPolicy } from './VRPanelRepaintPolicy';

export interface VRPanelHostOptions {
  readonly distanceMetres: number;
  readonly widthMetres: number;
  readonly maximumTextureWidth: number;
  readonly maximumTextureHeight: number;
}

/**
 * The part of the legacy GUI canvas a panel shows, in normalized texture
 * coordinates (u right, v up, both 0..1). The plane is sized to the region, so
 * what it shows keeps the scale it has on a full panel, and pointer hits map
 * back through the plane's own UVs to the right canvas position.
 */
export interface VRPanelRegion {
  readonly uMin: number;
  readonly uMax: number;
  readonly vMin: number;
  readonly vMax: number;
}

export interface VRPanelPresentOptions {
  /** Defaults to the whole canvas. */
  readonly region?: VRPanelRegion | null;
  /** Added to the panel's height relative to the head when it is placed. */
  readonly verticalOffsetMetres?: number;
}

const FULL_REGION: VRPanelRegion = { uMin: 0, uMax: 1, vMin: 0, vMax: 1 };

/** A menu-owned nested pass rendered while the legacy GUI camera is authoritative. */
export interface LegacyPanelRenderPass {
  render(renderer: THREE.WebGLRenderer): void;
}

/**
 * One engine-owned layer composited into a stable VR panel texture. Layers
 * share a target so cutscene imagery and its authored captions cannot drift
 * apart as separate world-space meshes.
 */
export interface LegacyPanelRenderLayer {
  readonly scene: THREE.Scene;
  readonly camera: THREE.Camera;
  readonly renderPass?: LegacyPanelRenderPass | null;
}

const DEFAULT_OPTIONS: VRPanelHostOptions = {
  distanceMetres: 1.5,
  widthMetres: 1.6,
  maximumTextureWidth: 1536,
  maximumTextureHeight: 1536,
};

const MAIN_MENU_RESREFS = new Set(['mainmenu8x6_p', 'mainmenu16x12']);
/**
 * The authored main-menu layouts (both 4:3) put their interactive content in
 * the lower half of the canvas, so the panel is raised to bring that content
 * to eye level. The offset is a quarter of the panel's height — the distance
 * from the panel's centre to the centre of its lower half — which for the
 * default 1.6m width at 4:3 is 0.3m.
 *
 * This was previously 0.9m, which put the whole panel above the player's
 * eyeline in the headset. That value had been tuned against a rig whose
 * height was derived from an arbitrary camera when no module was loaded;
 * with the rig now anchored to the floor, the geometric derivation holds.
 */
const MAIN_MENU_VERTICAL_OFFSET_METRES = 0.3;

/** Renders the authoritative legacy GUI scene onto a stable world-space panel. */
export class VRPanelHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly renderTarget: THREE.WebGLRenderTarget;
  private activeOwner: object | null = null;
  private textureWidth = 1;
  private textureHeight = 1;
  private readonly options: VRPanelHostOptions;
  private readonly lastHorizontalForward = new THREE.Vector3(0, 1, 0);
  /**
   * Owned here rather than by the caller so it cannot outlive the pixels it
   * describes: every `clear()` resets it, and the render target keeps its
   * contents while hidden. A caller-held policy would have to remember to
   * reset at each of the five places this host is cleared, and the one it
   * forgot would show a reopened panel the previous session's last frame.
   */
  private readonly repaintPolicy = new VRPanelRepaintPolicy();
  private viewportWidth = 0;
  private viewportHeight = 0;
  private activeRegion: VRPanelRegion = FULL_REGION;

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
    viewportHeight: number,
    options: VRPanelPresentOptions = {}
  ): void {
    if (!owner) throw new TypeError('VR panel owner is required');
    VRPanelHost.validateViewport(viewportWidth, viewportHeight);
    const region = VRPanelHost.validateRegion(options.region ?? FULL_REGION);
    const verticalOffset = options.verticalOffsetMetres ?? 0;
    if (!Number.isFinite(verticalOffset)) throw new RangeError('VR panel vertical offset must be finite');
    this.resizeTexture(viewportWidth, viewportHeight);
    this.viewportWidth = viewportWidth;
    this.viewportHeight = viewportHeight;
    // A different region is a different surface: re-place it rather than
    // resizing a panel the player has already located in the world.
    if (!VRPanelHost.sameRegion(region, this.activeRegion)) {
      this.applyRegion(region);
      this.activeOwner = null;
    }

    // A legacy menu owns one world-space surface for its entire visible
    // lifetime. Recomputing this pose every XR frame turns it into a
    // head-locked HUD and makes controller rays appear to drift with the
    // player. Only place it when a different menu opens.
    if (this.activeOwner !== owner) {
      // Never pin a panel from a pose that has not arrived yet. A head exactly
      // at the world origin is the first frame of a session before tracking
      // and the rig have settled; placement would pin the panel there — in the
      // floor — for its whole lifetime. Wait a frame instead.
      if (headPose.position.lengthSq() < 1e-6) {
        this.object.visible = false;
        return;
      }
      this.place(owner, headPose, verticalOffset);
      this.activeOwner = owner;
    }

    const aspect = viewportWidth / viewportHeight;
    this.object.scale.set(
      this.options.widthMetres * (region.uMax - region.uMin),
      (this.options.widthMetres / aspect) * (region.vMax - region.vMin),
      1
    );
    this.object.visible = true;
  }

  private place(owner: object, headPose: XRWorldPose, verticalOffsetMetres = 0): void {

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
    this.object.position.z = headPose.position.z + VRPanelHost.getVerticalOffset(owner) + verticalOffsetMetres;

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

  /**
   * Composites the GUI only when something observable has changed since the
   * last composite.
   *
   * This pass draws the entire legacy GUI scene into a target up to
   * 1536x1536, and it used to run on every XR frame for as long as any menu
   * was open — 72 times a second to redraw an inventory list nobody touched.
   * `VRPanelRepaintPolicy` documents precisely what the gate can and cannot
   * observe, and why it still repaints on a short floor regardless.
   *
   * @returns whether the composite actually ran
   */
  renderGuiIfChanged(
    renderer: THREE.WebGLRenderer,
    guiScene: THREE.Scene,
    guiCamera: THREE.Camera,
    legacyPanelRenderPass: LegacyPanelRenderPass | null = null,
    pointer: { x: number, y: number } | null = null,
  ): boolean {
    const shouldRepaint = this.repaintPolicy.shouldRepaint(
      captureVRPanelRepaintSignals(
        this.activeOwner,
        pointer,
        this.viewportWidth,
        this.viewportHeight,
      )
    );
    if (shouldRepaint) {
      this.renderGui(renderer, guiScene, guiCamera, legacyPanelRenderPass);
    }
    return shouldRepaint;
  }

  renderGui(
    renderer: THREE.WebGLRenderer,
    guiScene: THREE.Scene,
    guiCamera: THREE.Camera,
    legacyPanelRenderPass: LegacyPanelRenderPass | null = null
  ): void {
    this.renderGuiLayers(renderer, [{
      scene: guiScene,
      camera: guiCamera,
      renderPass: legacyPanelRenderPass,
    }]);
  }

  /**
   * Renders one or more legacy-camera layers into this panel's single target.
   * This deliberately clears color and depth once before the first layer. Each
   * later legacy GUI layer retains that authored color, but starts with a clean
   * depth buffer so a previous perspective cutscene cannot occlude ordinary
   * depth-tested GUI captions or replies.
   */
  renderGuiLayers(
    renderer: THREE.WebGLRenderer,
    layers: readonly LegacyPanelRenderLayer[],
  ): void {
    if (!renderer) throw new TypeError('VR panel renderer is required');
    if (!Array.isArray(layers) || layers.length === 0) {
      throw new RangeError('VR panel requires at least one render layer');
    }
    for (const layer of layers) {
      if (!(layer?.scene instanceof THREE.Scene) || !(layer.camera instanceof THREE.Camera)) {
        throw new TypeError('VR panel render layers require a THREE scene and camera');
      }
      if (layer.renderPass !== undefined && layer.renderPass !== null && typeof layer.renderPass.render !== 'function') {
        throw new TypeError('VR panel render layer pass must expose render(renderer)');
      }
    }

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
      for (let index = 0; index < layers.length; index++) {
        const layer = layers[index];
        if (index > 0) {
          renderer.clearDepth();
        }
        layer.renderPass?.render(renderer);
        renderer.render(layer.scene, layer.camera);
      }
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
    // The render target keeps its pixels while hidden, so a panel reopened on
    // the same menu would otherwise show the last frame of the old one.
    this.repaintPolicy.reset();
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.dispose();
    this.renderTarget.dispose();
  }

  /** Points the plane's UVs at the region so hits report canvas positions inside it. */
  private applyRegion(region: VRPanelRegion): void {
    const uv = this.object.geometry.getAttribute('uv') as THREE.BufferAttribute;
    const position = this.object.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < uv.count; index++) {
      // PlaneGeometry spans -0.5..0.5; map each corner to its end of the region.
      uv.setXY(
        index,
        position.getX(index) < 0 ? region.uMin : region.uMax,
        position.getY(index) < 0 ? region.vMin : region.vMax,
      );
    }
    uv.needsUpdate = true;
    this.activeRegion = region;
  }

  private static sameRegion(first: VRPanelRegion, second: VRPanelRegion): boolean {
    return first.uMin === second.uMin && first.uMax === second.uMax &&
      first.vMin === second.vMin && first.vMax === second.vMax;
  }

  private static validateRegion(region: VRPanelRegion): VRPanelRegion {
    const { uMin, uMax, vMin, vMax } = region ?? ({} as VRPanelRegion);
    const inRange = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
    if (!inRange(uMin) || !inRange(uMax) || !inRange(vMin) || !inRange(vMax) || uMin >= uMax || vMin >= vMax) {
      throw new RangeError('VR panel region must be a non-empty rectangle within 0..1');
    }
    return region;
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
