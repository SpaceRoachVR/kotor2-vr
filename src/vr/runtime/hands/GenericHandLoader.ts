import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { GENERIC_HAND_LEFT_GLB_BASE64, GENERIC_HAND_RIGHT_GLB_BASE64 } from './GenericHandGLB.generated';
import { createVRGloveMaterial, VRHandModel, type VRHandModelLoader } from './VRHandModel';

/**
 * Loads the embedded WebXR generic-hand GLB for one hand.
 *
 * Only GameState imports this module and hands it to VRSpike. three's example
 * loaders are ESM, which Jest cannot require from node_modules, so the VR
 * runtime itself must never import it — VRSpike and XRControllerAnchorHost
 * take the loader as an injected dependency instead. (A dynamic `import()`
 * would also avoid that, but would make webpack emit a separate chunk, and
 * chunk URLs are exactly the kind of path the `file://` Electron build breaks.)
 */
export const loadGenericHandModel: VRHandModelLoader = async (hand) => {
  const base64 = hand === 'left' ? GENERIC_HAND_LEFT_GLB_BASE64 : GENERIC_HAND_RIGHT_GLB_BASE64;
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    new GLTFLoader().parse(decodeBase64(base64), '', resolve as (gltf: unknown) => void, reject);
  });
  return new VRHandModel(gltf.scene, hand, createVRGloveMaterial());
};

function decodeBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}
