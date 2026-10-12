import * as THREE from 'three';

/** Use trilinear filtering only when a complete WebGL 1-compatible mip chain exists. */
export function resolveGrassMinFilter(mipmaps: readonly { width: number; height: number }[]): THREE.TextureFilter {
  const first = mipmaps[0];
  const powerOfTwo = (value: number) => Number.isSafeInteger(value) && value > 0 && Math.log2(value) % 1 === 0;
  if (!first || !powerOfTwo(first.width) || !powerOfTwo(first.height)) return THREE.LinearFilter;
  const levels = Math.log2(Math.max(first.width, first.height)) + 1;
  if (levels < 2 || mipmaps.length !== levels) return THREE.LinearFilter;
  for (let index = 0; index < levels; index++) {
    if (mipmaps[index]?.width !== Math.max(1, first.width / 2 ** index)
      || mipmaps[index]?.height !== Math.max(1, first.height / 2 ** index)) return THREE.LinearFilter;
  }
  return THREE.LinearMipmapLinearFilter;
}

/** Refresh cached GPU sampler state once when grass changes the texture's filtering. */
export function applyGrassTextureFiltering(texture: THREE.Texture): void {
  const minFilter = resolveGrassMinFilter(texture.mipmaps);
  if (texture.minFilter === minFilter && texture.magFilter === THREE.LinearFilter) return;
  texture.minFilter = minFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
}
