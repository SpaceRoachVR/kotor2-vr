import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { OdysseyMaterialBuilder } from '@/three/odyssey/OdysseyMaterialBuilder';

/**
 * Three's normal-mapping defines guard opposite halves of the same code.
 * `USE_NORMALMAP` declares `uniform sampler2D normalMap` in
 * normalmap_pars_fragment; `TANGENTSPACE_NORMALMAP` and `OBJECTSPACE_NORMALMAP`
 * sample that uniform in normal_fragment_maps. Any subset of the three is a
 * fragment shader that references an undeclared sampler and does not compile.
 *
 * The water branch of `applyTXIToMaterial` deleted `USE_NORMALMAP` on its own,
 * leaving `TANGENTSPACE_NORMALMAP` set from the NORMAL-bumpmap branch above it.
 * Any texture that is both a NORMAL-type bumpmap and carries `waterAlpha` then
 * failed outright with "'normalMap' : undeclared identifier" — the material does
 * not degrade, it fails to build. The 82-module sweep saw it in 6 of 82 modules,
 * Telos-heavy, in all five noise-floor runs.
 */
describe('normal-map define group', () => {
  test('clears all three defines together', () => {
    const material: any = {
      defines: {
        USE_NORMALMAP: '',
        TANGENTSPACE_NORMALMAP: '',
        OBJECTSPACE_NORMALMAP: '',
        WATER: '',
      },
    };
    OdysseyMaterialBuilder.clearNormalMapDefines(material);
    expect(material.defines.USE_NORMALMAP).toBeUndefined();
    expect(material.defines.TANGENTSPACE_NORMALMAP).toBeUndefined();
    expect(material.defines.OBJECTSPACE_NORMALMAP).toBeUndefined();
    // Only the normal-map group; it is not a general reset.
    expect(material.defines.WATER).toBe('');
  });

  test('tolerates a material with no defines', () => {
    expect(() => OdysseyMaterialBuilder.clearNormalMapDefines({})).not.toThrow();
    expect(() => OdysseyMaterialBuilder.clearNormalMapDefines(undefined)).not.toThrow();
  });

  /**
   * The unit test above cannot catch a future edit that half-clears the group
   * somewhere else, which is exactly how this defect arrived. Assert the shape
   * of the source instead: every site that drops USE_NORMALMAP must drop the
   * samplers with it.
   */
  test('no site deletes USE_NORMALMAP without the samplers', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'three', 'odyssey', 'OdysseyMaterialBuilder.ts'),
      'utf8',
    );
    const lines = source.split(/\r?\n/);
    const offenders: string[] = [];
    lines.forEach((line, index) => {
      if (!/delete\s+.*defines\.USE_NORMALMAP\s*;/.test(line)) return;
      // The reset block clears the whole group inline; the helper is the other
      // sanctioned form. Anything else is a half-clear.
      const window = lines.slice(Math.max(0, index - 4), index + 5).join('\n');
      const clearsTangent = /delete\s+.*defines\.TANGENTSPACE_NORMALMAP\s*;/.test(window);
      const clearsObject = /delete\s+.*defines\.OBJECTSPACE_NORMALMAP\s*;/.test(window);
      if (!(clearsTangent && clearsObject)) offenders.push(`${index + 1}: ${line.trim()}`);
    });
    expect(offenders).toEqual([]);
  });

  test('the water branch uses the grouped clear', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'three', 'odyssey', 'OdysseyMaterialBuilder.ts'),
      'utf8',
    );
    // The grouped clear replaced a bare `delete ... USE_NORMALMAP` that sat
    // directly above the ENVMAP_BLENDING_ADD delete; pin that pairing.
    const marker = 'OdysseyMaterialBuilder.clearNormalMapDefines(material);';
    const at = source.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 200)).toContain('delete material.defines.ENVMAP_BLENDING_ADD;');
  });
});
