import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const {
  createVisualManifest,
  writeVisualManifest,
} = require('../../tools/material-audit/visual-manifest');

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
    source: 'active-module',
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
      source: 'active-module',
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
      source: 'none',
      selectedSource: 'none',
      searchedSources: ['override-tga', 'override-tpc', 'active-module', 'texture-pack', 'key-bif'],
      diagnosticCode: 'missing-required-texture',
      resolvedResref: undefined,
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
      source: 'none',
      searchedSources: ['override-tga', 'override-tpc', 'active-module', 'texture-pack', 'key-bif'],
      selectedSource: 'none',
      diagnosticCode: 'missing-optional-texture',
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
      source: 'active-module',
      searchedSources: ['override-tga', 'override-tpc', 'active-module'],
      selectedSource: 'active-module',
      diagnosticCode: 'decode-error',
      cacheGeneration: 2,
    });

    expect(() => createVisualManifest({ runtime: 'chrome', modules })).not.toThrow();
  });

  test('accepts a documented GUI alias after the canonical route exhausts its precedence search', () => {
    const modules = coveredModules();
    modules['001EBO'][1] = {
      ...modules['001EBO'][1],
      requestedResref: 'border1',
      resolvedResref: 'border1c',
      semantic: 'gui',
      source: 'gui-pack',
      selectedSource: 'gui-pack',
      searchedSources: [
        'override-tga', 'override-tpc', 'active-module', 'gui-pack', 'texture-pack', 'key-bif',
        'override-tga', 'override-tpc', 'active-module', 'gui-pack',
      ],
      txiSource: 'embedded-tpc',
      aliasEvidence: 'retail-tsl-gui-pack:swpc_tex_gui.erf',
    };

    expect(() => createVisualManifest({ runtime: 'chrome', modules })).not.toThrow();
  });

  test.each([
    {
      name: 'an unreviewed resref mapping',
      patch: { resolvedResref: 'border_fake', aliasEvidence: 'retail-tsl-gui-pack:swpc_tex_gui.erf' },
    },
    {
      name: 'fabricated installed-content evidence',
      patch: { resolvedResref: 'border1c', aliasEvidence: 'retail-tsl-gui-pack:invented.erf' },
    },
  ])('rejects $name for a claimed GUI alias', ({ patch }) => {
    const modules = coveredModules();
    modules['001EBO'][1] = {
      ...modules['001EBO'][1],
      requestedResref: 'border1',
      semantic: 'gui',
      source: 'gui-pack',
      selectedSource: 'gui-pack',
      searchedSources: [
        'override-tga', 'override-tpc', 'active-module', 'gui-pack', 'texture-pack', 'key-bif',
        'override-tga', 'override-tpc', 'active-module', 'gui-pack',
      ],
      txiSource: 'embedded-tpc',
      ...patch,
    };

    expect(() => createVisualManifest({ runtime: 'chrome', modules })).toThrow(/reviewed alias/i);
  });

  test('writes material manifests only under approved local evidence or user-data roots', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-vr-material-manifest-'));
    const evidenceRoot = path.join(temporaryDirectory, 'evidence');
    const userDataRoot = path.join(temporaryDirectory, 'user-data');
    const retailRoot = path.join(temporaryDirectory, 'retail-install');
    const json = JSON.stringify(createVisualManifest({ runtime: 'electron', modules: coveredModules() }));

    try {
      const writtenPath = writeVisualManifest(path.join(evidenceRoot, 'peragus.json'), json, {
        evidenceRoots: [evidenceRoot],
        userDataRoots: [userDataRoot],
        retailRoots: [retailRoot],
      });
      expect(fs.existsSync(writtenPath)).toBe(true);

      expect(() => writeVisualManifest(path.join(retailRoot, 'material-audit.json'), json, {
        evidenceRoots: [evidenceRoot],
        userDataRoots: [userDataRoot],
        retailRoots: [retailRoot],
      })).toThrow(/retail installation/i);
      expect(() => writeVisualManifest(path.join(temporaryDirectory, 'outside.json'), json, {
        evidenceRoots: [evidenceRoot],
        userDataRoots: [userDataRoot],
        retailRoots: [retailRoot],
      })).toThrow(/approved local evidence or user-data/i);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test.each([
    {
      name: 'the typed resolution source contradicts the selected source',
      patch: { source: 'override-tpc' },
      error: /source.*selected/i,
    },
    {
      name: 'the selected source was not reached through the eligible precedence path',
      patch: { searchedSources: ['override-tga', 'active-module'] },
      error: /searched sources.*precedence/i,
    },
    {
      name: 'a missing diagnostic contradicts an optional environment request',
      patch: {
        requestedResref: 'optional_envmap',
        resolvedResref: undefined,
        semantic: 'environment',
        required: false,
        status: 'missing',
        source: 'none',
        selectedSource: 'none',
        searchedSources: ['override-tga', 'override-tpc', 'active-module', 'texture-pack', 'key-bif'],
        diagnosticCode: 'missing-required-texture',
        width: undefined,
        height: undefined,
        sha256: undefined,
      },
      error: /missing-optional-texture/i,
    },
    {
      name: 'an invalid result claims a resolver search',
      patch: {
        requestedResref: '0',
        resolvedResref: undefined,
        required: false,
        status: 'invalid',
        source: 'none',
        selectedSource: 'none',
        searchedSources: ['override-tga'],
        diagnosticCode: 'invalid-resref',
        width: undefined,
        height: undefined,
        sha256: undefined,
      },
      error: /invalid.*searched sources/i,
    },
  ])('rejects an impossible resolver provenance claim when $name', ({ patch, error }) => {
    const modules = coveredModules();
    modules['102PER'].push({
      ...resolvedRecord('optional_manifest_record', 'doors', '102per'),
      required: false,
      ...patch,
    });

    expect(() => createVisualManifest({ runtime: 'chrome', modules })).toThrow(error);
  });
});
