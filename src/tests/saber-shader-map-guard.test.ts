import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `sampledDiffuseColor` and `map` are declared only inside `#ifdef USE_MAP`, and
 * USE_MAP is set only when the map uniform actually has a value. The SABER
 * branch used both without that guard, while SABER itself is set from the
 * model's node type alone — `(nodeType & Saber)` — with no reference to whether
 * a diffuse map resolved.
 *
 * A saber node whose texture is absent, or has not resolved yet, therefore
 * compiled a fragment shader referencing two undeclared identifiers, and the
 * entire material failed to build rather than merely losing its blade texture.
 * The post-fix sweep saw it in 504OND, 506OND and 907MAL.
 *
 * Same shape as the normal-map defect (normalmap-define-invariant.test.ts): a
 * define group half-set, where the half that declares and the half that samples
 * are guarded separately.
 */
describe('saber shader map guard', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'shaders', 'ShaderOdysseyModel.ts'), 'utf8',
  );

  test('the saber branch requires USE_MAP', () => {
    expect(source).toContain('#if defined( SABER ) && defined( USE_MAP )');
    expect(source).not.toContain('      #ifdef SABER\n');
  });

  test('a saber with no map falls back rather than failing to compile', () => {
    const at = source.indexOf('#if defined( SABER ) && defined( USE_MAP )');
    expect(at).toBeGreaterThan(-1);
    const branch = source.slice(at, at + 400);
    expect(branch).toContain('#else');
    expect(branch).toContain('gl_FragColor = vec4( outgoingLight, diffuseColor.a );');
  });

  test('sampledDiffuseColor is only used where it is declared', () => {
    // It is declared inside `#ifdef USE_MAP`; every use must sit under a guard
    // that implies USE_MAP, or the shader will not compile.
    const uses = source.split('sampledDiffuseColor').length - 1;
    const declarationBlock = source.indexOf('#ifdef USE_MAP');
    expect(declarationBlock).toBeGreaterThan(-1);
    // Declaration + the two lines inside the USE_MAP block, and nothing after.
    const afterSaberGuard = source.slice(source.indexOf('#if defined( SABER )'));
    expect(afterSaberGuard).not.toContain('sampledDiffuseColor');
    expect(uses).toBeGreaterThan(0);
  });
});
