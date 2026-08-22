import { describe, expect, test } from '@jest/globals';

const { createVisualManifest } = require('../../tools/material-audit/visual-manifest');

const SHA256 = 'a'.repeat(64);

function resolvedRecord(
  requestedResref: string,
  visualCategory: string,
  activeModule: string,
): Record<string, unknown> {
  return {
    requestedResref,
    resolvedResref: requestedResref,
    semantic: visualCategory === 'lightmaps' ? 'lightmap' : 'diffuse',
    visualCategory,
    activeModule,
    required: true,
    status: 'resolved',
    searchedSources: ['override-tga', 'override-tpc', 'active-module'],
    selectedSource: 'active-module',
    txiSource: 'active-module-txi',
    cacheGeneration: 2,
    width: 256,
    height: 256,
    sha256: SHA256,
  };
}

function coveredModules(): Record<string, Record<string, unknown>[]> {
  return {
    '001EBO': [
      resolvedRecord('ebon_door', 'doors', '001ebo'),
      resolvedRecord('gui_icon', 'ui-icons', '001ebo'),
      resolvedRecord('g_w_blstrpstl', 'held-models', '001ebo'),
    ],
    '101PER': [
      resolvedRecord('per_holo', 'holograms', '101per'),
      resolvedRecord('per_force', 'force-fields', '101per'),
      resolvedRecord('per_light', 'lightmaps', '101per'),
    ],
    '102PER': [resolvedRecord('per_door', 'doors', '102per')],
  };
}

describe('material visual manifest', () => {
  test('keeps only resolver metadata and hashes for the required visual coverage', () => {
    const modules = coveredModules();
    modules['001EBO'][0].forbiddenBytes = new Uint8Array([1, 2, 3]);
    const manifest = createVisualManifest({ runtime: 'electron', modules });

    expect(manifest.runtime).toBe('electron');
    expect(manifest.modules.map(({ module }: { module: string }) => module)).toEqual([
      '001ebo', '101per', '102per',
    ]);
    expect(manifest.modules[0].records[0]).toEqual({
      requestedResref: 'ebon_door',
      resolvedResref: 'ebon_door',
      semantic: 'diffuse',
      visualCategory: 'doors',
      activeModule: '001ebo',
      required: true,
      status: 'resolved',
      searchedSources: ['override-tga', 'override-tpc', 'active-module'],
      selectedSource: 'active-module',
      txiSource: 'active-module-txi',
      cacheGeneration: 2,
      width: 256,
      height: 256,
      sha256: SHA256,
    });
    expect(JSON.stringify(manifest)).not.toContain('forbiddenBytes');
  });

  test.each(['electron', 'chrome'])('accepts %s runtime evidence only', (runtime) => {
    expect(() => createVisualManifest({ runtime, modules: coveredModules() })).not.toThrow();
  });

  test('rejects an audit that does not cover each required Peragus and Ebon Hawk visual category', () => {
    const modules = coveredModules();
    modules['101PER'] = modules['101PER'].filter(({ visualCategory }) => visualCategory !== 'force-fields');

    expect(() => createVisualManifest({ runtime: 'chrome', modules })).toThrow(/101per:force-fields/i);
  });

  test('rejects a required material that did not resolve with local metadata', () => {
    const modules = coveredModules();
    modules['001EBO'][0] = {
      ...modules['001EBO'][0],
      status: 'missing',
      selectedSource: 'none',
      sha256: undefined,
      width: undefined,
      height: undefined,
    };

    expect(() => createVisualManifest({ runtime: 'electron', modules })).toThrow(/ebon_door.*required/i);
  });

  test('allows an optional map to be absent when its resolver diagnostic is explicit', () => {
    const modules = coveredModules();
    modules['102PER'].push({
      requestedResref: 'optional_envmap',
      semantic: 'environment',
      visualCategory: 'doors',
      activeModule: '102per',
      required: false,
      status: 'missing',
      searchedSources: ['override-tga', 'override-tpc', 'active-module', 'texture-pack', 'key-bif'],
      selectedSource: 'none',
      diagnosticCode: 'texture-not-found',
      cacheGeneration: 2,
    });

    expect(() => createVisualManifest({ runtime: 'electron', modules })).not.toThrow();
  });

  test('retains source provenance for an optional decode failure without claiming decoded metadata', () => {
    const modules = coveredModules();
    modules['102PER'].push({
      requestedResref: 'optional_bump',
      resolvedResref: 'optional_bump',
      semantic: 'bump',
      visualCategory: 'doors',
      activeModule: '102per',
      required: false,
      status: 'decode-error',
      searchedSources: ['override-tga', 'override-tpc', 'active-module'],
      selectedSource: 'active-module',
      diagnosticCode: 'decode-error',
      cacheGeneration: 2,
    });

    expect(() => createVisualManifest({ runtime: 'chrome', modules })).not.toThrow();
  });
});
