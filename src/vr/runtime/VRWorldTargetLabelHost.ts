import * as THREE from 'three';

export interface VRWorldTargetIndicator {
  readonly id: string;
  readonly name: string;
  readonly position: THREE.Vector3;
}

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

/** Head-facing world label paired with KOTOR's existing interaction reticle. */
export class VRWorldTargetLabelHost {
  readonly object: THREE.Sprite;
  private currentText = '';
  private readonly options: VRWorldTargetLabelHostOptions;

  constructor(
    worldScene: THREE.Scene,
    private readonly textRenderer: VRWorldTargetLabelTextureRenderer = new CanvasVRWorldTargetLabelTextureRenderer(),
    options: Partial<VRWorldTargetLabelHostOptions> = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    VRWorldTargetLabelHost.validateOptions(this.options);
    this.object = new THREE.Sprite(new THREE.SpriteMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
    }));
    this.object.name = 'Kotor2VR.WorldTargetLabel';
    this.object.visible = false;
    this.object.frustumCulled = false;
    this.object.renderOrder = 999_999;
    this.object.scale.set(this.options.widthMetres, this.options.heightMetres, 1);
    worldScene.add(this.object);
  }

  get text(): string {
    return this.currentText;
  }

  update(indicator: VRWorldTargetIndicator): void {
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
    this.object.visible = true;
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
