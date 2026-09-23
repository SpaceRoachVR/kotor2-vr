import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * The HOLOGRAM branch sampled `map`, which exists only under USE_MAP. A
 * hologram material without a resolved texture failed to compile at all —
 * captured in the round-6 headset console as "'map' : undeclared identifier"
 * followed by "useProgram: program not valid" when the Peragus Security
 * Officer's hologram appeared in 'secoff'. Same shape as the saber guard.
 */
describe('hologram shader map guard', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'shaders', 'ShaderOdysseyModel.ts'), 'utf8',
  );

  test('every map sample in the hologram branch is guarded by USE_MAP', () => {
    const start = source.indexOf('#ifdef HOLOGRAM');
    expect(start).toBeGreaterThan(-1);
    const branch = source.slice(start, source.indexOf('#endif\n      #include <premultiplied_alpha_fragment>', start));
    const sample = branch.indexOf('texture2D(map, vUv)');
    expect(sample).toBeGreaterThan(-1);
    const guard = branch.lastIndexOf('#ifdef USE_MAP', sample);
    expect(guard).toBeGreaterThan(-1);
    expect(branch.slice(guard, sample)).not.toContain('#endif');
    expect(branch.slice(sample)).toContain('#else');
  });
});
