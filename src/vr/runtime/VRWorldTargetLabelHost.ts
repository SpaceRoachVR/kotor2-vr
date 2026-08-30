import * as THREE from 'three';

export interface VRWorldTargetIndicator {
  readonly id: string;
  readonly name: string;
  readonly position: THREE.Vector3;
}

const HORIZONTAL_EPSILON = 1e-8;

export interface VRWorldTargetLabelTextureRenderer {
  render(text: string): THREE.Texture;
  dispose(): void;
}

export interface VRWorldTargetLabelHostOptions {
  readonly verticalOffsetMetres: number;
  readonly widthMetres: number;
  readonly heightMetres: number;
}

const DEFAULT_OPTIONS: VRWorldTargetLabelHostOptions = {
  verticalOffsetMetres: 0.32,
  widthMetres: 0.6,
  heightMetres: 0.12,
};

/**
 * Upright world label paired with KOTOR's existing interaction reticle.
 *
 * Deliberately a Mesh, not a Sprite. A THREE.Sprite billboards against the
 * camera's full basis including its up vector, so tilting your head rolled the
 * label with it — readable, but it swims. This yaw-billboards instead, keeping
 * world up (Z, in this engine) as the label's local Y so it stays flat and
 * level however the head is oriented. Same convention as
 * VRWorldActionPromptHost.faceHeadUpright and VRRadialMenuHost.
 */
export class VRWorldTargetLabelHost {
  readonly object: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private currentText = '';
  private readonly options: VRWorldTargetLabelHostOptions;
  /** Retains the last valid horizontal facing for a head directly above. */
  private readonly lastHorizontalNormal = new THREE.Vector3(0, -1, 0);

  constructor(
    worldScene: THREE.Scene,
    private readonly textRenderer: VRWorldTargetLabelTextureRenderer = new CanvasVRWorldTargetLabelTextureRenderer(),
    options: Partial<VRWorldTargetLabelHostOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    VRWorldTargetLabelHost.validateOptions(this.options);
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(this.options.widthMetres, this.options.heightMetres),
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.object.name = 'Kotor2VR.WorldTargetLabel';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 999_999;
    worldScene.add(this.object);
  }

  get text(): string {
    return this.currentText;
  }

  update(indicator: VRWorldTargetIndicator, headPosition?: THREE.Vector3): void {
    const text = indicator.name.trim();
    if (!text) {
      this.clear();
      return;
    }
    if (text !== this.currentText) {
      this.object.material.map = this.textRenderer.render(text);
      this.object.material.needsUpdate = true;
      this.currentText = text;
    }
    this.object.position.copy(indicator.position);
    this.object.position.z += this.options.verticalOffsetMetres;
    if (headPosition) this.faceHeadUpright(headPosition);
    this.object.visible = true;
  }

  /** Yaw-only billboard: the label turns to follow the head but never rolls. */
  private faceHeadUpright(headPosition: THREE.Vector3): void {
    const normal = headPosition.clone().sub(this.object.position);
    normal.z = 0;
    if (normal.lengthSq() <= HORIZONTAL_EPSILON) {
      normal.copy(this.lastHorizontalNormal);
    } else {
      normal.normalize();
      this.lastHorizontalNormal.copy(normal);
    }
    const up = new THREE.Vector3(0, 0, 1);
    const right = up.clone().cross(normal).normalize();
    this.object.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, normal),
    );
  }

  clear(): void {
    this.currentText = '';
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.material.dispose();
    this.textRenderer.dispose();
  }

  private static validateOptions(options: VRWorldTargetLabelHostOptions): void {
    for (const [name, value] of Object.entries(options)) {
      if (!Number.isFinite(value) || value <= 0) {
        throw new RangeError(`${name} must be a finite positive number`);
      }
    }
  }
}

/** Crisp no-asset text texture for world interaction names. */
export class CanvasVRWorldTargetLabelTextureRenderer implements VRWorldTargetLabelTextureRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;

  constructor() {
    if (typeof document === 'undefined') {
      throw new Error('Canvas VR label renderer requires a browser document');
    }
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 192;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Unable to create the VR label 2D canvas context');
    this.context = context;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.encoding = THREE.sRGBEncoding;
    this.texture.name = 'Kotor2VR.world-target-label';
  }

  render(text: string): THREE.Texture {
    const normalizedText = text.trim();
    if (!normalizedText) throw new RangeError('VR target label text cannot be empty');

    const { context, canvas } = this;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(4, 18, 22, 0.88)';
    context.fillRect(8, 8, canvas.width - 16, canvas.height - 16);
    context.strokeStyle = 'rgba(96, 232, 255, 0.95)';
    context.lineWidth = 6;
    context.strokeRect(11, 11, canvas.width - 22, canvas.height - 22);

    let fontSize = 68;
    do {
      context.font = `600 ${fontSize}px Arial, sans-serif`;
      if (context.measureText(normalizedText).width <= canvas.width - 96) break;
      fontSize -= 4;
    } while (fontSize > 32);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = '#f2fdff';
    context.fillText(normalizedText, canvas.width / 2, canvas.height / 2, canvas.width - 96);
    this.texture.needsUpdate = true;
    return this.texture;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
