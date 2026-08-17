import * as THREE from 'three';

const LASER_LENGTH_METRES = 20;

/**
 * Blaster aim laser (ROADMAP 3.6): a visible beam from the dominant hand,
 * shown only while a blaster is the equipped weapon mode. Attached as a
 * child of the right-hand controller anchor so it tracks the weapon with
 * no extra per-frame transform work.
 */
export class VRBlasterLaserHost {
  readonly object: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.LineBasicMaterial;

  constructor(handAnchor: THREE.Object3D) {
    this.geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -LASER_LENGTH_METRES),
    ]);
    this.material = new THREE.LineBasicMaterial({
      color: 0xff5a3c,
      transparent: true,
      opacity: 0.55,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.object = new THREE.Line(this.geometry, this.material);
    this.object.name = 'Kotor2VR.BlasterLaser';
    this.object.visible = false;
    handAnchor.add(this.object);
  }

  present(): void {
    this.object.visible = true;
  }

  clear(): void {
    this.object.visible = false;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
