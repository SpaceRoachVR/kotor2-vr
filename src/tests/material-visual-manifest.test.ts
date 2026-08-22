import { describe, expect, test } from '@jest/globals';

const { createVisualManifest } = require('../../tools/material-audit/visual-manifest');

describe('material visual manifest', () => {
  test('keeps only routing metadata for the required audit modules', () => {
    const manifest = createVisualManifest({
      runtime: 'electron',
      modules: {
        '001EBO': [{
          requestedResref: 'wall',
          resolvedResref: 'wall',
          semantic: 'diffuse',
          activeModule: '001ebo',
          status: 'resolved',
          searchedSources: ['override-tga', 'override-tpc', 'active-module'],
          selectedSource: 'active-module',
          cacheGeneration: 2,
          forbiddenBytes: new Uint8Array([1, 2, 3]),
        }],
        '101PER': [],
        '102PER': [],
      },
    });

    expect(manifest.runtime).toBe('electron');
    expect(manifest.modules.map(({ module }: { module: string }) => module)).toEqual([
      '001ebo', '101per', '102per',
    ]);
    expect(manifest.modules[0].records[0]).toEqual({
      requestedResref: 'wall',
      resolvedResref: 'wall',
      semantic: 'diffuse',
      activeModule: '001ebo',
      status: 'resolved',
      searchedSources: ['override-tga', 'override-tpc', 'active-module'],
      selectedSource: 'active-module',
      cacheGeneration: 2,
    });
    expect(JSON.stringify(manifest)).not.toContain('forbiddenBytes');
  });

  test.each(['electron', 'chrome'])('accepts %s runtime evidence only', (runtime) => {
    expect(() => createVisualManifest({
      runtime,
      modules: { '001EBO': [], '101PER': [], '102PER': [] },
    })).not.toThrow();
  });

  test('rejects an incomplete module set', () => {
    expect(() => createVisualManifest({
      runtime: 'chrome',
      modules: { '101PER': [] },
    })).toThrow(/001ebo.*102per/i);
  });
});
