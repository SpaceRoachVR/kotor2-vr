import * as THREE from 'three';

export interface VRWeaponStanceTextureRenderer {
  render(text: string): THREE.Texture;
  dispose(): void;
}

export interface VRWeaponStanceHostOptions {
  readonly widthMetres: number;
  readonly heightMetres: number;
  /** Local offset from the grip anchor, below the round-timer ring. */
  readonly localOffset: THREE.Vector3;
}

const DEFAULT_OPTIONS: VRWeaponStanceHostOptions = {
  widthMetres: 0.1,
  heightMetres: 0.028,
  // The ring sits at z = -0.12 on the same anchor; this hangs just under it.
  localOffset: new THREE.Vector3(0, -0.042, -0.12),
};

/**
 * Diegetic attack-stance readout (ROADMAP 4.8), beside the round timer on the
 * weapon itself rather than as a HUD element.
 *
 * Mounted on the same grip anchor the round timer uses, so it belongs to
 * whatever is held — the hilt for a sabre, the body for a blaster. That is the
 * locked rule: the timer and the stance belong to the weapon in your hand,
 * whatever it is.
 *
 * The texture renderer is injected for the same reason as
 * `VRWorldTargetLabelHost`: it keeps the host testable without a real canvas.
 */
export class VRWeaponStanceHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private currentText: string | null = null;

  constructor(
    handAnchor: THREE.Object3D,
    private readonly textRenderer: VRWeaponStanceTextureRenderer =
    new CanvasVRWeaponStanceTextureRenderer(),
    options: Partial<VRWeaponStanceHostOptions> = {},
  ) {
    if (!handAnchor) throw new TypeError('VR weapon stance host requires a hand anchor');
    const resolved: VRWeaponStanceHostOptions = { ...DEFAULT_OPTIONS, ...options };
    VRWeaponStanceHost.validateOptions(resolved);

    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(resolved.widthMetres, resolved.heightMetres),
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.object.name = 'Kotor2VR.WeaponStance';
    // Above the hilt ring, which is 1_000_004, so the two cannot z-fight.
    this.object.renderOrder = 1_000_005;
    this.object.position.copy(resolved.localOffset);
    this.object.visible = false;
    handAnchor.add(this.object);
  }

  get isVisible(): boolean {
    return this.object.visible;
  }

  /** Empty or blank text hides the plaque rather than drawing an empty quad. */
  present(text: string): void {
    const trimmed = typeof text === 'string' ? text.trim() : '';
    if (trimmed.length === 0) {
      this.clear();
      return;
    }

    this.object.visible = true;
    if (trimmed === this.currentText) return;
    this.currentText = trimmed;

    const texture = this.textRenderer.render(trimmed);
    const previous = this.object.material.map;
    this.object.material.map = texture;
    this.object.material.needsUpdate = true;
    // The canvas renderer reuses one texture, so only dispose a genuinely
    // replaced one — disposing the live texture would blank the plaque.
    if (previous && previous !== texture) previous.dispose();
  }

  clear(): void {
    this.object.visible = false;
    // Deliberately keeps currentText: clearing is a visibility change, not a
    // content change, so re-presenting the same stance must not redraw.
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.object.material.map?.dispose();
    this.object.material.dispose();
    this.textRenderer.dispose();
  }

  private static validateOptions(options: VRWeaponStanceHostOptions): void {
    for (const key of ['widthMetres', 'heightMetres'] as const) {
      const value = options[key];
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${key} must be a positive finite number`);
      }
    }
    const offset = options.localOffset;
    if (!offset || !Number.isFinite(offset.x) || !Number.isFinite(offset.y) || !Number.isFinite(offset.z)) {
      throw new RangeError('localOffset must contain finite coordinates');
    }
  }
}

export class CanvasVRWeaponStanceTextureRenderer implements VRWeaponStanceTextureRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;

  constructor() {
    if (typeof document === 'undefined') {
      throw new Error('VR weapon stance readout requires a browser document');
    }
    this.canvas = document.createElement('canvas');
    // 512x144 over a 0.10 x 0.028 m plaque. Text this small is right at the
    // legibility floor through lenses, so it is drawn light-on-dark with a
    // stroke rather than relying on contrast against the world behind it.
    this.canvas.width = 512;
    this.canvas.height = 144;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR weapon stance canvas context unavailable');
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
  }

  render(text: string): THREE.Texture {
    const { width, height } = this.canvas;
    this.context.clearRect(0, 0, width, height);

    this.context.fillStyle = 'rgba(8, 14, 20, 0.78)';
    this.context.fillRect(0, 0, width, height);

    this.context.font = 'bold 78px sans-serif';
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';

    // Shrink to fit rather than clipping: a truncated stance name is worse than
    // a smaller one, since the ranks differ only by their prefix (Flurry vs
    // Improved Flurry vs Master Flurry).
    const upper = text.toUpperCase();
    let fontSize = 78;
    while (fontSize > 28 && this.context.measureText(upper).width > width * 0.92) {
      fontSize -= 4;
      this.context.font = `bold ${fontSize}px sans-serif`;
    }

    this.context.lineWidth = Math.max(2, fontSize * 0.12);
    this.context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    this.context.strokeText(upper, width / 2, height / 2);
    this.context.fillStyle = '#d8f2ff';
    this.context.fillText(upper, width / 2, height / 2);

    this.texture.needsUpdate = true;
    return this.texture;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
