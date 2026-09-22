import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { TXI } from '@/resource/TXI';
import { TXIBlending } from '@/enums/graphics/txi/TXIBlending';

/**
 * The swoop track "did not render correctly": mid-course the road was an
 * irregular patchwork of black and green. Reproduced in the emulator — clean at
 * the start line, broken 15 seconds on — and traced to two faults.
 *
 * The road there is tel_stsf, a metal grating over the planet far below. Its
 * TXI is `blending 2`: punchthrough, written as a number.
 */
describe('TXI blending written as a number', () => {
  test.each([
    ['blending 2', TXIBlending.PUNCHTHROUGH],
    ['blending 1', TXIBlending.ADDITIVE],
    ['blending 0', TXIBlending.NONE],
  ])('%s is recognised', (txi, expected) => {
    expect(new TXI(txi).blending).toBe(expected);
  });

  test.each([
    ['blending punchthrough', TXIBlending.PUNCHTHROUGH],
    ['blending additive', TXIBlending.ADDITIVE],
  ])('the word form %s still works', (txi, expected) => {
    expect(new TXI(txi).blending).toBe(expected);
  });

  test('211TEL\u2019s grate, exactly as shipped', () => {
    expect(new TXI('blending 2\nxbox_downsample 1').blending).toBe(TXIBlending.PUNCHTHROUGH);
  });
});

/**
 * A punchthrough texture discards only what is fully transparent.
 *
 * The TPC header's float was being used as the cutout threshold. tel_stsf's
 * alpha is soft across 53.6% of its texels, so at its header value of 0.647 the
 * engine cut away 42.5% of the grate, against the 16.1% that is genuinely
 * transparent — 2.6 times too much, in the irregular shapes of the soft
 * regions rather than the grate's own holes. reone, a clean-room engine tested
 * against Steam TSL, renders punchthrough through its opaque path and discards
 * only alpha == 0; it never reads that header float as a threshold.
 *
 * tel_gr04 at the start line is 41.8% alpha 0 and 57.6% alpha 255, almost
 * nothing between, so either rule gives the same picture — which is why the
 * start of the course was never affected and toggling it there changed nothing.
 */
describe('punchthrough discards only fully transparent texels', () => {
  const loader = fs.readFileSync(path.join(__dirname, '..', 'loaders/TextureLoader.ts'), 'utf8');

  test('the threshold is half a step of 8-bit alpha', () => {
    expect(loader).toMatch(/PUNCHTHROUGH_ALPHA_THRESHOLD = 0\.5 \/ 255;/);
  });

  test('punchthrough uses it instead of the TPC header float', () => {
    expect(loader).toMatch(
      /texture\.txi\.blending === TXIBlending\.PUNCHTHROUGH\s*\?\s*TextureLoader\.PUNCHTHROUGH_ALPHA_THRESHOLD\s*:\s*texture\.header\.alphaTest/,
    );
  });

  test('the same threshold reaches the shader uniform, not only the material', () => {
    expect(loader).toMatch(/uniforms\.alphaTest\.value = threshold;/);
    expect(loader).toMatch(/material\.alphaTest = threshold;/);
  });

  test('a texture with no blending keeps its header threshold, which this did not change', () => {
    expect(loader).toMatch(/:\s*texture\.header\.alphaTest;/);
  });

  test('env-mapped textures are still left alone, their alpha being the reflection mask', () => {
    expect(loader).toMatch(/texture\.txi\.envMapTexture != null\) \{\s*return;/);
  });
});
