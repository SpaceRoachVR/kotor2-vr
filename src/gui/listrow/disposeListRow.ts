import type * as THREE from "three";

/**
 * Frees the GPU resources a list row built for itself. Every row control makes
 * its own border, fill, highlight and text geometries and ShaderMaterials, and
 * clearing or removing rows only detached them, so each inventory, container or
 * store refresh leaked ~15 geometries per row (headset round 17: 13,500
 * geometries resident after 50 minutes, frame rate halving).
 *
 * Textures are not disposed: rows reference cached GUI textures through
 * uniforms, shared with every other control.
 */
export function disposeListRow(root: THREE.Object3D | undefined | null): void {
  if (!root) return;
  root.traverse((object: any) => {
    object.geometry?.dispose?.();
    const material = object.material;
    if (Array.isArray(material)) {
      for (const entry of material) entry?.dispose?.();
    } else {
      material?.dispose?.();
    }
  });
}
