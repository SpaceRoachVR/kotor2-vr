import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  ExplicitTextureAlias,
  TextureResolution,
  TextureResolutionSource,
  TextureResolver,
  TextureSourceArtifact,
  TextureSourceProvider,
} from '@/loaders/TextureResolution';
import { TPCObject } from '@/resource/TPCObject';
import { TextureLoader } from '@/loaders/TextureLoader';
import { ResourceLoader } from '@/loaders/ResourceLoader';
import { GameFileSystem } from '@/utility/GameFileSystem';
import { ERFManager } from '@/managers/ERFManager';
import { createMaterialAuditRecord } from '../../tools/material-audit';

type FakeTexture = { readonly name: string };

class RecordingTextureProvider implements TextureSourceProvider<FakeTexture> {
  readonly attempts: Array<{ source: TextureResolutionSource; resref: string; activeModule?: string }> = [];

  constructor(
    private readonly available: ReadonlyMap<string, FakeTexture>,
  ) {}

  async load(
    source: TextureResolutionSource,
    resref: string,
    activeModule?: string,
  ): Promise<TextureSourceArtifact<FakeTexture> | undefined> {
    this.attempts.push({ source, resref, activeModule });
    const texture = this.available.get(`${source}:${resref}`);
    return texture ? { texture } : undefined;
  }
}

function createUncompressedTpc(): TPCObject {
  const file = new Uint8Array(132);
  const view = new DataView(file.buffer);
  view.setUint32(0, 0, true);
  view.setFloat32(4, 1, true);
  view.setUint16(8, 1, true);
  view.setUint16(10, 1, true);
  view.setUint8(12, 4);
  view.setUint8(13, 1);
  file.set([10, 20, 30, 255], 128);
  return new TPCObject({ file, filename: 'fixture', pack: 2 });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TextureResolver', () => {
  test('stops at the active module before GUI, texture pack, and KEY/BIF sources', async () => {
    const expected = { name: 'module-panel' };
    const provider = new RecordingTextureProvider(new Map([
      ['active-module:panel', expected],
      ['texture-pack:panel', { name: 'packed-panel' }],
    ]));
    const resolver = new TextureResolver(provider);

    const result = await resolver.resolve({
      resref: 'PANEL',
      semantic: 'diffuse',
      activeModule: '101PER',
      allowAlias: false,
    });

    expect(result).toMatchObject({
      status: 'resolved',
      requestedResref: 'panel',
      resolvedResref: 'panel',
      source: 'active-module',
      texture: expected,
    });
    expect(provider.attempts).toEqual([
      { source: 'override-tga', resref: 'panel', activeModule: '101per' },
      { source: 'override-tpc', resref: 'panel', activeModule: '101per' },
      { source: 'active-module', resref: 'panel', activeModule: '101per' },
    ]);
  });

  test('finds a GUI-pack texture requested under any semantic', async () => {
    // TSL ships non-GUI assets in swpc_tex_gui.erf and asks for them under
    // other semantics: `loadscreen3` and `innermenu` arrive as 'diffuse', and
    // the galaxy map's `gui_galxy_1..3` / `gui_sun_1` arrive as 'particle'.
    // Skipping the pack for those made textures that are present on disk
    // resolve as missing-required-texture.
    const guiTexture = { name: 'gui-panel' };

    for (const semantic of ['diffuse', 'particle', 'gui', 'font'] as const) {
      const provider = new RecordingTextureProvider(new Map([['gui-pack:panel', guiTexture]]));

      const resolution = await new TextureResolver(provider).resolve({
        resref: 'panel',
        semantic,
        allowAlias: false,
      });

      expect(resolution).toMatchObject({
        status: 'resolved', source: 'gui-pack', texture: guiTexture,
      });
    }
  });

  test('keeps the world pack ahead of the GUI pack for non-GUI semantics', async () => {
    // A world texture sharing a name with a GUI one must still resolve to the
    // world pack; the GUI pack is a late fallback outside gui/font.
    const worldTexture = { name: 'world-panel' };
    const guiTexture = { name: 'gui-panel' };
    const provider = new RecordingTextureProvider(new Map([
      ['texture-pack:panel', worldTexture],
      ['gui-pack:panel', guiTexture],
    ]));

    const resolution = await new TextureResolver(provider).resolve({
      resref: 'panel',
      semantic: 'diffuse',
      allowAlias: false,
    });

    expect(resolution).toMatchObject({ status: 'resolved', source: 'texture-pack' });
  });

  test('keeps the GUI pack ahead of the world pack for GUI and font semantics', async () => {
    const worldTexture = { name: 'world-panel' };
    const guiTexture = { name: 'gui-panel' };

    for (const semantic of ['gui', 'font'] as const) {
      const provider = new RecordingTextureProvider(new Map([
        ['texture-pack:panel', worldTexture],
        ['gui-pack:panel', guiTexture],
      ]));

      const resolution = await new TextureResolver(provider).resolve({
        resref: 'panel',
        semantic,
        allowAlias: false,
      });

      expect(resolution).toMatchObject({ status: 'resolved', source: 'gui-pack' });
    }
  });

  test.each(['', '0', '****'])('rejects invalid sentinel %j before any source I/O', async (resref) => {
    const provider = new RecordingTextureProvider(new Map());
    const result = await new TextureResolver(provider).resolve({
      resref,
      semantic: 'diffuse',
      allowAlias: true,
    });

    expect(result).toMatchObject({
      status: 'invalid',
      source: 'none',
      diagnostic: { code: 'invalid-resref' },
    });
    expect(provider.attempts).toEqual([]);
  });

  test('uses only an explicitly evidenced alias when alias permission is granted', async () => {
    const alias: ExplicitTextureAlias = {
      requestedResref: 'legacy_panel',
      resolvedResref: 'installed_panel',
      evidence: 'installed-content-manifest:fixture',
    };
    const expected = { name: 'aliased-panel' };
    const provider = new RecordingTextureProvider(new Map([
      ['texture-pack:installed_panel', expected],
      ['texture-pack:unknownc', { name: 'must-not-be-used' }],
    ]));
    const resolver = new TextureResolver(provider, { aliases: [alias] });

    const denied = await resolver.resolve({
      resref: 'legacy_panel', semantic: 'gui', allowAlias: false,
    });
    const allowed = await resolver.resolve({
      resref: 'legacy_panel', semantic: 'gui', allowAlias: true,
    });
    const arbitrary = await resolver.resolve({
      resref: 'unknown', semantic: 'gui', allowAlias: true,
    });

    expect(denied.status).toBe('missing');
    expect(allowed).toMatchObject({
      status: 'resolved',
      requestedResref: 'legacy_panel',
      resolvedResref: 'installed_panel',
      source: 'texture-pack',
      aliasEvidence: 'installed-content-manifest:fixture',
      texture: expected,
    });
    expect(arbitrary.status).toBe('missing');
    expect(provider.attempts).not.toContainEqual(expect.objectContaining({ resref: 'unknownc' }));
  });

  test('returns an attributable decode-error instead of falling through precedence', async () => {
    const provider: TextureSourceProvider<FakeTexture> = {
      load: jest.fn(async (source) => {
        if (source === 'override-tga') {
          throw new Error('invalid TGA header');
        }
        return { texture: { name: 'must-not-fall-through' } };
      }),
    };

    const result = await new TextureResolver(provider).resolve({
      resref: 'panel',
      semantic: 'diffuse',
      allowAlias: false,
    });

    expect(result).toEqual({
      status: 'decode-error',
      requestedResref: 'panel',
      resolvedResref: 'panel',
      source: 'override-tga',
      cacheGeneration: 1,
      searchedSources: ['override-tga'],
      diagnostic: {
        code: 'decode-error',
        message: "Failed to decode diffuse texture 'panel' from override-tga: invalid TGA header",
      },
    });
    expect(provider.load).toHaveBeenCalledTimes(1);
  });

  test('preserves Override TXI sidecar provenance on the winning texture source', async () => {
    const expected = { name: 'override-panel' };
    const provider: TextureSourceProvider<FakeTexture> = {
      load: jest.fn(async (source) => source === 'override-tga'
        ? { texture: expected, txiSource: 'override-txi' as const }
        : { texture: { name: 'lower-precedence-panel' } }),
    };

    const result = await new TextureResolver(provider).resolve({
      resref: 'panel',
      semantic: 'diffuse',
      allowAlias: false,
    });

    expect(result).toMatchObject({
      status: 'resolved',
      source: 'override-tga',
      txiSource: 'override-txi',
      texture: expected,
    });
    expect(provider.load).toHaveBeenCalledTimes(1);
  });
});

describe('TPC texture cloning', () => {
  test('returns an independent texture whose mutable metadata is not shared', () => {
    const original = createUncompressedTpc().toCompressedTexture();
    const clone = original.clone() as typeof original;

    clone.header.alphaTest = 0.25;
    clone.txi.numx = 8;

    expect(clone).not.toBe(original);
    expect(clone.header).not.toBe(original.header);
    expect(clone.txi).not.toBe(original.txi);
    expect(original.header.alphaTest).toBe(1);
    expect(original.txi.numx).toBe(0);
  });
});

describe('legacy texture entry point', () => {
  test.each(['', '0', '****'])('rejects sentinel %j before either decoder performs I/O', async (resref) => {
    const tgaFetch = jest.spyOn(TextureLoader.tgaLoader, 'fetch');
    const tpcFetch = jest.spyOn(TextureLoader.tpcLoader, 'fetch');

    await expect(TextureLoader.Load(resref)).resolves.toBeUndefined();

    expect(tgaFetch).not.toHaveBeenCalled();
    expect(tpcFetch).not.toHaveBeenCalled();
    tgaFetch.mockRestore();
    tpcFetch.mockRestore();
  });

  test.each(['', '0', '****'])('rejects lightmap sentinel %j before either decoder performs I/O', async (resref) => {
    const tgaFetch = jest.spyOn(TextureLoader.tgaLoader, 'fetch');
    const tpcFetch = jest.spyOn(TextureLoader.tpcLoader, 'fetch');

    await expect(TextureLoader.LoadLightmap(resref)).resolves.toBeUndefined();

    expect(tgaFetch).not.toHaveBeenCalled();
    expect(tpcFetch).not.toHaveBeenCalled();
    tgaFetch.mockRestore();
    tpcFetch.mockRestore();
  });

  test.each(['', '0', '****'])('rejects local sentinel %j before filesystem or decoder I/O', async (resref) => {
    const exists = jest.spyOn(GameFileSystem, 'exists');
    const tgaFetchLocal = jest.spyOn(TextureLoader.tgaLoader, 'fetchLocal');

    await expect(TextureLoader.LoadLocal(resref)).resolves.toBeUndefined();

    expect(exists).not.toHaveBeenCalled();
    expect(tgaFetchLocal).not.toHaveBeenCalled();
    exists.mockRestore();
    tgaFetchLocal.mockRestore();
  });
});

describe('direct texture resource entry points', () => {
  test('rejects a TGA sentinel before resource lookup', async () => {
    const loadResource = jest.spyOn(ResourceLoader, 'loadResource');

    await expect(TextureLoader.tgaLoader.fetch('****')).resolves.toBeUndefined();

    expect(loadResource).not.toHaveBeenCalled();
  });

  test('rejects an Override TGA sentinel before filesystem I/O', async () => {
    const readFile = jest.spyOn(GameFileSystem, 'readFile');

    await expect(TextureLoader.tgaLoader.fetchOverride('****')).resolves.toBeUndefined();

    expect(readFile).not.toHaveBeenCalled();
  });

  test('rejects a local TGA sentinel before filesystem I/O', async () => {
    const readFile = jest.spyOn(GameFileSystem, 'readFile');

    await expect(TextureLoader.tgaLoader.fetchLocal('****')).resolves.toBeUndefined();

    expect(readFile).not.toHaveBeenCalled();
  });

  test('rejects a TPC sentinel before archive lookup', async () => {
    const getArchive = jest.spyOn(ERFManager.ERFs, 'get');

    await expect(TextureLoader.tpcLoader.fetch('****')).resolves.toBeUndefined();

    expect(getArchive).not.toHaveBeenCalled();
  });

  test('rejects an Override TPC sentinel before filesystem I/O', async () => {
    const readFile = jest.spyOn(GameFileSystem, 'readFile');

    await expect(TextureLoader.tpcLoader.fetchOverride('****')).resolves.toBeUndefined();

    expect(readFile).not.toHaveBeenCalled();
  });

  test('rejects a generic resource sentinel before source I/O', async () => {
    const searchOverride = jest.spyOn(ResourceLoader, 'searchOverride');
    const searchKeyTable = jest.spyOn(ResourceLoader, 'searchKeyTable');
    const searchModuleArchives = jest.spyOn(ResourceLoader, 'searchModuleArchives');

    await expect(ResourceLoader.loadResource(1, '****')).rejects.toThrow('Invalid resRef ****');

    expect(searchOverride).not.toHaveBeenCalled();
    expect(searchKeyTable).not.toHaveBeenCalled();
    expect(searchModuleArchives).not.toHaveBeenCalled();
  });
});

describe('material audit records', () => {
  test('emits only approved metadata and never carries source bytes', () => {
    const record = createMaterialAuditRecord({
      request: {
        resref: 'Panel',
        semantic: 'gui',
        activeModule: '101PER',
        allowAlias: false,
      },
      resolution: {
        status: 'resolved',
        requestedResref: 'panel',
        resolvedResref: 'panel',
        source: 'gui-pack',
        cacheGeneration: 4,
        texture: { forbiddenBytes: new Uint8Array([1, 2, 3]) },
      },
      width: 64,
      height: 32,
      sha256: 'a'.repeat(64),
    });

    expect(record).toEqual({
      requestedResref: 'panel',
      resolvedResref: 'panel',
      semantic: 'gui',
      activeModule: '101per',
      status: 'resolved',
      source: 'gui-pack',
      selectedSource: 'gui-pack',
      searchedSources: [],
      cacheGeneration: 4,
      width: 64,
      height: 32,
      sha256: 'a'.repeat(64),
    });
    expect(JSON.stringify(record)).not.toContain('forbiddenBytes');
  });

  test('serializes Override TXI sidecar provenance', () => {
    const record = createMaterialAuditRecord({
      request: {
        resref: 'Panel',
        semantic: 'diffuse',
        allowAlias: false,
      },
      resolution: {
        status: 'resolved',
        requestedResref: 'panel',
        resolvedResref: 'panel',
        source: 'override-tga',
        txiSource: 'override-txi',
        cacheGeneration: 2,
        texture: { name: 'panel' },
      },
    });

    expect(record).toEqual({
      requestedResref: 'panel',
      resolvedResref: 'panel',
      semantic: 'diffuse',
      status: 'resolved',
      source: 'override-tga',
      selectedSource: 'override-tga',
      searchedSources: [],
      txiSource: 'override-txi',
      cacheGeneration: 2,
    });
  });

  test.each([
    {
      name: 'request and result resrefs differ',
      request: { resref: 'panel', semantic: 'gui' as const, allowAlias: false },
      resolution: {
        status: 'missing', requestedResref: 'other', source: 'none', cacheGeneration: 1,
        diagnostic: { code: 'missing-required-texture' as const, message: 'missing' },
      },
    },
    {
      name: 'resolved result has no texture',
      request: { resref: 'panel', semantic: 'gui' as const, allowAlias: false },
      resolution: {
        status: 'resolved', requestedResref: 'panel', resolvedResref: 'panel',
        source: 'gui-pack', cacheGeneration: 1,
      },
    },
    {
      name: 'missing result names a concrete source',
      request: { resref: 'panel', semantic: 'gui' as const, allowAlias: false },
      resolution: {
        status: 'missing', requestedResref: 'panel', source: 'gui-pack', cacheGeneration: 1,
        diagnostic: { code: 'missing-required-texture' as const, message: 'missing' },
      },
    },
    {
      name: 'invalid result contains a usable resref',
      request: { resref: 'panel', semantic: 'gui' as const, allowAlias: false },
      resolution: {
        status: 'invalid', requestedResref: 'panel', source: 'none', cacheGeneration: 1,
        diagnostic: { code: 'invalid-resref' as const, message: 'invalid' },
      },
    },
  ])('rejects a contradictory audit input when $name', ({ request, resolution }) => {
    expect(() => createMaterialAuditRecord({
      request,
      resolution: resolution as unknown as TextureResolution<FakeTexture>,
    })).toThrow();
  });
});
