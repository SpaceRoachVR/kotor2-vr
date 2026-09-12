import * as THREE from 'three';
import type { XRHandRole } from '../XRTypes';
import { VR_HAND_OPEN_CURL, type VRHandFingerCurl } from './VRHandFingerCurl';
import { VRHandSkeletonPoser, VR_HAND_JOINT_NAMES, type VRHandJointTransform } from './VRHandSkeletonPoser';

/** Produces a ready hand model; injected so the VR runtime never imports a GLTF loader. */
export type VRHandModelLoader = (hand: XRHandRole) => Promise<VRHandModel>;

/**
 * A loaded, skinned hand, positioned so its closed fist sits on the WebXR grip
 * pose. Everything here is presentation: it owns its own geometry, material
 * and skeleton and never touches an engine object.
 */
export class VRHandModel {
  readonly root: THREE.Group;
  private readonly bones: ReadonlyMap<string, THREE.Object3D>;
  private readonly poser: VRHandSkeletonPoser;
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly ownedMaterials: THREE.Material[] = [];
  private curl: VRHandFingerCurl = VR_HAND_OPEN_CURL;

  /**
   * @param armature The model's scene root. Joints are looked up by their
   *   WebXR names anywhere below it.
   */
  constructor(armature: THREE.Object3D, readonly hand: XRHandRole, material: THREE.Material) {
    const bones = new Map<string, THREE.Object3D>();
    armature.traverse((node) => {
      if (VR_HAND_JOINT_NAMES.includes(node.name) && !bones.has(node.name)) bones.set(node.name, node);
    });
    armature.updateMatrixWorld(true);
    const rest = new Map<string, VRHandJointTransform>();
    for (const [name, bone] of bones) {
      // The generic hands are flat — every joint is a child of the armature —
      // so a joint's local transform already is its armature-space transform.
      // A nested rig would need this relaxed; refuse it rather than mis-pose.
      if (bone.parent && bones.has(bone.parent.name)) {
        throw new Error(`hand joint ${name} is parented to another joint; only flat WebXR hand rigs are supported`);
      }
      rest.set(name, { position: bone.position.clone(), quaternion: bone.quaternion.clone() });
    }
    this.poser = new VRHandSkeletonPoser(rest, hand);
    this.bones = bones;

    armature.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!(mesh as { isMesh?: boolean }).isMesh) return;
      // Skinned bounds are computed from the bind pose, so a curled or moving
      // hand would pop out of existence near the frustum edge.
      mesh.frustumCulled = false;
      const previous = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const old of previous) old?.dispose();
      mesh.material = material;
      if (mesh.geometry) this.ownedGeometries.push(mesh.geometry);
    });
    this.ownedMaterials.push(material);

    const alignment = new THREE.Group();
    alignment.name = `Kotor2VR.${hand}HandModelAlignment`;
    alignment.matrixAutoUpdate = false;
    alignment.matrix.copy(this.poser.getGripFromArmatureMatrix());
    alignment.add(armature);

    this.root = new THREE.Group();
    this.root.name = `Kotor2VR.${hand}HandModel`;
    this.root.add(alignment);
    this.applyCurl(VR_HAND_OPEN_CURL);
  }

  getCurl(): VRHandFingerCurl {
    return this.curl;
  }

  applyCurl(curl: VRHandFingerCurl): void {
    this.curl = curl;
    for (const [name, transform] of this.poser.pose(curl)) {
      const bone = this.bones.get(name);
      if (!bone) continue;
      bone.position.copy(transform.position);
      bone.quaternion.copy(transform.quaternion);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedGeometries.length = 0;
    this.ownedMaterials.length = 0;
  }
}

/**
 * A lit-looking glove material that needs no scene light. The engine lights
 * Odyssey materials its own way, so a MeshStandardMaterial hand would be black
 * in one module and blown out in the next. A matcap bakes the lighting into
 * a small generated texture instead: stable everywhere, and cheap on Quest.
 */
export function createVRGloveMaterial(): THREE.MeshMatcapMaterial {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  // Dark worn-leather glove: charcoal with a warm brown cast.
  const base = new THREE.Color(0x3b3029);
  const rim = new THREE.Color(0x8a7563);
  const key = new THREE.Vector3(-0.45, 0.6, 0.66).normalize();
  const color = new THREE.Color();
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x + 0.5) / size * 2 - 1;
      const ny = (y + 0.5) / size * 2 - 1;
      const rr = nx * nx + ny * ny;
      const nz = rr < 1 ? Math.sqrt(1 - rr) : 0;
      const diffuse = Math.max(0, nx * key.x + ny * key.y + nz * key.z);
      const fresnel = Math.pow(1 - nz, 3);
      const specular = Math.pow(Math.max(0, nx * key.x + ny * key.y + nz * key.z), 24) * 0.25;
      color.copy(base).multiplyScalar(0.35 + 0.9 * diffuse).lerp(rim, fresnel * 0.55);
      color.r = Math.min(1, color.r + specular);
      color.g = Math.min(1, color.g + specular);
      color.b = Math.min(1, color.b + specular);
      const offset = (y * size + x) * 4;
      data[offset] = Math.round(color.r * 255);
      data[offset + 1] = Math.round(color.g * 255);
      data[offset + 2] = Math.round(color.b * 255);
      data[offset + 3] = 255;
    }
  }
  const matcap = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  matcap.magFilter = THREE.LinearFilter;
  matcap.minFilter = THREE.LinearFilter;
  matcap.needsUpdate = true;
  const material = new THREE.MeshMatcapMaterial({ matcap });
  material.name = 'Kotor2VR.GloveMatcap';
  // Disposing the material alone leaks the texture.
  material.addEventListener('dispose', () => matcap.dispose());
  return material;
}
