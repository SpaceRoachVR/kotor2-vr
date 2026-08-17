import * as THREE from 'three';
import { XRWorldPose } from './XRTypes';

export interface VRPanelPointerHit {
  readonly guiPosition: THREE.Vector2;
  readonly worldPosition: THREE.Vector3;
  readonly distanceMetres: number;
}

export interface VRPanelPointerHostOptions {
  readonly maximumDistanceMetres: number;
  readonly cursorRadiusMetres: number;
}

const DEFAULT_OPTIONS: VRPanelPointerHostOptions = {
  maximumDistanceMetres: 5,
  cursorRadiusMetres: 0.018,
};

/** Dominant-hand ray and hit cursor used exclusively while a VR panel owns input. */
export class VRPanelPointerHost {
  readonly rayObject: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly cursorObject: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly raycaster = new THREE.Raycaster();
  private readonly options: VRPanelPointerHostOptions;
  private readonly rayPositions: THREE.BufferAttribute;

  constructor(worldScene: THREE.Scene, options: Partial<VRPanelPointerHostOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    VRPanelPointerHost.validateOptions(this.options);

    const rayGeometry = new THREE.BufferGeometry();
    this.rayPositions = new THREE.BufferAttribute(new Float32Array(6), 3);
    rayGeometry.setAttribute('position', this.rayPositions);
    const rayMaterial = new THREE.LineBasicMaterial({
      color: 0x66eeff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
    });
    this.rayObject = new THREE.Line(rayGeometry, rayMaterial);
    this.rayObject.name = 'Kotor2VR.VRPanelPointerRay';
    this.rayObject.visible = false;
    this.rayObject.frustumCulled = false;
    this.rayObject.renderOrder = 1_000_001;

    const cursorMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    });
    this.cursorObject = new THREE.Mesh(
      new THREE.RingGeometry(
        this.options.cursorRadiusMetres * 0.55,
        this.options.cursorRadiusMetres,
        32
      ),
      cursorMaterial
    );
    this.cursorObject.name = 'Kotor2VR.VRPanelPointerCursor';
    this.cursorObject.visible = false;
    this.cursorObject.frustumCulled = false;
    this.cursorObject.renderOrder = 1_000_002;
    worldScene.add(this.rayObject, this.cursorObject);
  }

  update(
    panel: THREE.Object3D,
    targetRayPose: XRWorldPose,
    viewportWidth: number,
    viewportHeight: number
  ): VRPanelPointerHit | null {
    VRPanelPointerHost.validateViewport(viewportWidth, viewportHeight);
    const origin = targetRayPose.position;
    const direction = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(targetRayPose.orientation)
      .normalize();
    this.raycaster.near = 0;
    this.raycaster.far = this.options.maximumDistanceMetres;
    this.raycaster.set(origin, direction);
    panel.updateWorldMatrix(true, true);
    const intersection = this.raycaster.intersectObject(panel, false)[0];
    const endpoint = intersection?.point ?? origin.clone().addScaledVector(
      direction,
      this.options.maximumDistanceMetres
    );
    this.updateRayGeometry(origin, endpoint);
    this.rayObject.visible = true;

    if (!intersection?.uv) {
      this.cursorObject.visible = false;
      return null;
    }

    const panelOrientation = panel.getWorldQuaternion(new THREE.Quaternion());
    const panelNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(panelOrientation);
    this.cursorObject.position.copy(intersection.point).addScaledVector(panelNormal, 0.003);
    this.cursorObject.quaternion.copy(panelOrientation);
    this.cursorObject.visible = true;
    return {
      guiPosition: new THREE.Vector2(
        (intersection.uv.x - 0.5) * viewportWidth,
        (intersection.uv.y - 0.5) * viewportHeight
      ),
      worldPosition: intersection.point.clone(),
      distanceMetres: intersection.distance,
    };
  }

  clear(): void {
    this.rayObject.visible = false;
    this.cursorObject.visible = false;
  }

  dispose(): void {
    this.rayObject.removeFromParent();
    this.cursorObject.removeFromParent();
    this.rayObject.geometry.dispose();
    this.rayObject.material.dispose();
    this.cursorObject.geometry.dispose();
    this.cursorObject.material.dispose();
  }

  private updateRayGeometry(origin: THREE.Vector3, endpoint: THREE.Vector3): void {
    this.rayPositions.setXYZ(0, origin.x, origin.y, origin.z);
    this.rayPositions.setXYZ(1, endpoint.x, endpoint.y, endpoint.z);
    this.rayPositions.needsUpdate = true;
  }

  private static validateOptions(options: VRPanelPointerHostOptions): void {
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
}
