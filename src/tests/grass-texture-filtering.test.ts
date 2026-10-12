import * as THREE from 'three';
import { expect, test } from '@jest/globals';
import { resolveGrassMinFilter, applyGrassTextureFiltering } from '@/utility/GrassTextureFiltering';

test('uses existing complete square and rectangular mip chains', () => {
  for (const [width, height] of [[1024, 1024], [512, 128]]) {
    const levels = Math.log2(Math.max(width, height)) + 1;
    const mipmaps = Array.from({ length: levels }, (_, index) => ({
      width: Math.max(1, width / 2 ** index), height: Math.max(1, height / 2 ** index),
    }));
    expect(resolveGrassMinFilter(mipmaps)).toBe(THREE.LinearMipmapLinearFilter);
  }
});

test('keeps single-level, incomplete, malformed and non-power-of-two textures renderable', () => {
  for (const mipmaps of [[], [{ width: 1, height: 1 }], [{ width: 1024, height: 1024 }],
    [{ width: 2, height: 2 }, { width: 2, height: 1 }],
    [{ width: 3, height: 3 }, { width: 1, height: 1 }],
    [{ width: NaN, height: 2 }], [{ width: Infinity, height: 2 }]]) {
    expect(resolveGrassMinFilter(mipmaps)).toBe(THREE.LinearFilter);
  }
});

test('refreshes a cached GPU sampler once, and avoids repeat uploads for rooms sharing that texture', () => {
  const texture = new THREE.Texture();
  texture.mipmaps = [{width:2,height:2}, {width:1,height:1}] as any;
  texture.minFilter = THREE.LinearFilter;
  const version = texture.version;
  applyGrassTextureFiltering(texture);
  expect(texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
  expect(texture.version).toBe(version + 1);
  applyGrassTextureFiltering(texture);
  expect(texture.version).toBe(version + 1);
  texture.mipmaps = [];
  applyGrassTextureFiltering(texture);
  expect(texture.minFilter).toBe(THREE.LinearFilter);
  expect(texture.version).toBe(version + 2);
});