import { describe, expect, test } from '@jest/globals';
import { isMeshTextureNull, shouldDrawMeshNode } from '@/three/odyssey/MeshRenderRules';

/**
 * The Ebon Hawk lounge (001ebo15) has an untextured, render-flagged mesh,
 * `Line01`, behind its cockpit monitors. Drawn as plain diffuse geometry it
 * showed as flat grey-white panes. Retail and reone draw no mesh without a
 * diffuse texture; creature body parts that take their texture from
 * appearance.2da are the exception.
 */
describe('shouldDrawMeshNode', () => {
  test('a NULL or empty bitmap is not a surface', () => {
    expect(isMeshTextureNull('NULL')).toBe(true);
    expect(isMeshTextureNull('null')).toBe(true);
    expect(isMeshTextureNull(' Null ')).toBe(true);
    expect(isMeshTextureNull('')).toBe(true);
    expect(isMeshTextureNull(undefined)).toBe(true);
    expect(isMeshTextureNull('LEH_wall01')).toBe(false);
  });

  test('the Ebon Hawk occluder is hidden', () => {
    expect(shouldDrawMeshNode({ flagRender: true, textureMap1: 'NULL' }, false)).toBe(false);
  });

  test('textured meshes draw, and the render flag still hides', () => {
    expect(shouldDrawMeshNode({ flagRender: true, textureMap1: 'LEH_scre01' }, false)).toBe(true);
    expect(shouldDrawMeshNode({ flagRender: false, textureMap1: 'LEH_scre01' }, false)).toBe(false);
  });

  test('a NULL body part with an appearance texture override draws', () => {
    // n_duros:head, n_mandalorian:Torso and friends.
    expect(shouldDrawMeshNode({ flagRender: true, textureMap1: 'NULL' }, false, 'N_DurosH01')).toBe(true);
    expect(shouldDrawMeshNode({ flagRender: true, textureMap1: '' }, false, 'NULL')).toBe(false);
  });

  test('AABB walkmesh geometry keeps its own visibility', () => {
    expect(shouldDrawMeshNode({ flagRender: false, textureMap1: 'NULL' }, true)).toBe(true);
  });
});
