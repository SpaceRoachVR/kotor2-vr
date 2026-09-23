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
/** The combat queue holds three requests; the plaque shows up to that many rows. */
export const VR_WEAPON_STANCE_MAX_LINES = 3;

/**
 * The hilt readout for the queued combat requests: every one, next first, one
 * per line. Round 11 (K6): "it shows the next special +1 on the hilt when it
 * should show all queued actions in a stack."
 */
export function formatVRCombatQueueReadout(labels: readonly (string | null | undefined)[]): string {
  return (labels ?? [])
    .map((label) => (typeof label === 'string' ? label.trim() : ''))
    .filter((label) => label.length > 0)
    .slice(0, VR_WEAPON_STANCE_MAX_LINES)
    .join('\n');
}

export class VRWeaponStanceHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private currentText: string | null = null;
  private readonly rowHeight: number;
  private readonly topY: number;

  constructor(
    handAnchor: THREE.Object3D,
    private readonly textRenderer: VRWeaponStanceTextureRenderer =
    new CanvasVRWeaponStanceTextureRenderer(),
    options: Partial<VRWeaponStanceHostOptions> = {},
  ) {
    if (!handAnchor) throw new TypeError('VR weapon stance host requires a hand anchor');
    const resolved: VRWeaponStanceHostOptions = { ...DEFAULT_OPTIONS, ...options };
    VRWeaponStanceHost.validateOptions(resolved);

    this.rowHeight = resolved.heightMetres;
    // The first row sits where the single-line plaque always did; more rows
    // hang below it, away from the round-timer ring above.
    this.topY = resolved.localOffset.y + resolved.heightMetres / 2;
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(resolved.widthMetres, resolved.heightMetres * VR_WEAPON_STANCE_MAX_LINES),
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
    this.layoutRows(1);
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
    this.layoutRows(trimmed.split('\n').filter((line) => line.trim().length > 0).length);
  }

  /** Rows shown on the plaque, 1 to VR_WEAPON_STANCE_MAX_LINES. */
  get rowCount(): number {
    return Math.round(this.object.scale.y * VR_WEAPON_STANCE_MAX_LINES);
  }

  /** Shows the top `rows` rows of the texture on a plaque that tall. */
  private layoutRows(rows: number): void {
    const n = Math.min(VR_WEAPON_STANCE_MAX_LINES, Math.max(1, Math.floor(rows) || 1));
    const fraction = n / VR_WEAPON_STANCE_MAX_LINES;
    this.object.scale.y = fraction;
    this.object.position.y = this.topY - (this.rowHeight * n) / 2;
    const map = this.object.material.map;
    if (map) {
      map.repeat.set(1, fraction);
      map.offset.set(0, 1 - fraction);
    }
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
    // 512x144 per row over a 0.10 x 0.028 m row. Text this small is right at the
    // legibility floor through lenses, so it is drawn light-on-dark with a
    // stroke rather than relying on contrast against the world behind it.
    this.canvas.width = 512;
    this.canvas.height = 144 * VR_WEAPON_STANCE_MAX_LINES;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('VR weapon stance canvas context unavailable');
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
  }

  render(text: string): THREE.Texture {
    const { width, height } = this.canvas;
    const rowHeight = height / VR_WEAPON_STANCE_MAX_LINES;
    this.context.clearRect(0, 0, width, height);

    const lines = text.split('\n').map((line) => line.trim().toUpperCase()).filter((line) => line.length > 0)
      .slice(0, VR_WEAPON_STANCE_MAX_LINES);
    this.context.fillStyle = 'rgba(8, 14, 20, 0.78)';
    this.context.fillRect(0, 0, width, rowHeight * Math.max(1, lines.length));

    this.context.font = 'bold 78px sans-serif';
    this.context.textAlign = 'center';
    this.context.textBaseline = 'middle';

    // Shrink to fit rather than clipping: a truncated stance name is worse than
    // a smaller one, since the ranks differ only by their prefix (Flurry vs
    // Improved Flurry vs Master Flurry). One size for every row, set by the
    // longest, so the stack reads as one list.
    let fontSize = 78;
    const widest = () => Math.max(0, ...lines.map((line) => this.context.measureText(line).width));
    while (fontSize > 28 && widest() > width * 0.92) {
      fontSize -= 4;
      this.context.font = `bold ${fontSize}px sans-serif`;
    }

    this.context.lineWidth = Math.max(2, fontSize * 0.12);
    lines.forEach((line, row) => {
      const y = rowHeight * row + rowHeight / 2;
      this.context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      this.context.strokeText(line, width / 2, y);
      // The next action is brightest; what follows it is dimmer.
      this.context.fillStyle = row === 0 ? '#d8f2ff' : '#8fb3c4';
      this.context.fillText(line, width / 2, y);
    });

    this.texture.needsUpdate = true;
    return this.texture;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
