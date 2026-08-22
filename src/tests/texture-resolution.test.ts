import { describe, expect, jest, test } from '@jest/globals';
import {
  ExplicitTextureAlias,
  TextureResolutionSource,
  TextureResolver,
  TextureSourceProvider,
} from '@/loaders/TextureResolution';
import { TPCObject } from '@/resource/TPCObject';
import { TextureLoader } from '@/loaders/TextureLoader';
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
  ): Promise<FakeTexture | undefined> {
    this.attempts.push({ source, resref, activeModule });
    return this.available.get(`${source}:${resref}`);
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

  test('consults the GUI pack only for GUI and font semantics', async () => {
    const guiTexture = { name: 'gui-panel' };
    const diffuseProvider = new RecordingTextureProvider(new Map([
      ['gui-pack:panel', guiTexture],
    ]));
    const guiProvider = new RecordingTextureProvider(new Map([
      ['gui-pack:panel', guiTexture],
    ]));

    const diffuse = await new TextureResolver(diffuseProvider).resolve({
      resref: 'panel',
      semantic: 'diffuse',
      allowAlias: false,
    });
    const gui = await new TextureResolver(guiProvider).resolve({
      resref: 'panel',
      semantic: 'gui',
      allowAlias: false,
    });

    expect(diffuse.status).toBe('missing');
    expect(diffuseProvider.attempts.map(({ source }) => source)).not.toContain('gui-pack');
    expect(gui).toMatchObject({ status: 'resolved', source: 'gui-pack', texture: guiTexture });
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
      cacheGeneration: 4,
      width: 64,
      height: 32,
      sha256: 'a'.repeat(64),
    });
    expect(JSON.stringify(record)).not.toContain('forbiddenBytes');
  });
});
