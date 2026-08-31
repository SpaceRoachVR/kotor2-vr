import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { CacheScope } from '@/enums/resource/CacheScope';
import { ResourceLoader } from '@/loaders/ResourceLoader';
import { ResourceTypes } from '@/resource/ResourceTypes';
import { GameFileSystem } from '@/utility/GameFileSystem';

const TEST_RESOURCE_TYPE = 3;

describe('ResourceLoader lazy override index', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    ResourceLoader.InitCache();
    await ResourceLoader.InitOverrideCache();
    ResourceLoader.clearCache();
  });

  test('loads an indexed override lazily and caches only the requested bytes', async () => {
    const overrideBytes = new Uint8Array([1, 2, 3, 4]);
    const readFile = jest.spyOn(GameFileSystem, 'readFile').mockResolvedValue(overrideBytes);

    ResourceLoader.setOverrideResource(
      TEST_RESOURCE_TYPE,
      'My_Texture',
      'Override/My_Texture.tga',
    );

    expect(ResourceLoader.getCache(TEST_RESOURCE_TYPE, 'my_texture')).toBeNull();
    await expect(ResourceLoader.loadResource(TEST_RESOURCE_TYPE, 'my_texture')).resolves.toBe(overrideBytes);
    await expect(ResourceLoader.loadResource(TEST_RESOURCE_TYPE, 'MY_TEXTURE')).resolves.toBe(overrideBytes);

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(readFile).toHaveBeenCalledWith('Override/My_Texture.tga');
    expect(ResourceLoader.CacheScopes[CacheScope.OVERRIDE].get(TEST_RESOURCE_TYPE).size).toBe(1);
  });

  test('clearing the override cache also removes stale indexed paths', async () => {
    const readFile = jest.spyOn(GameFileSystem, 'readFile').mockResolvedValue(new Uint8Array([9]));
    const exists = jest.spyOn(GameFileSystem, 'exists');
    ResourceLoader.setOverrideResource(TEST_RESOURCE_TYPE, 'stale', 'Override/stale.tga');

    await ResourceLoader.InitOverrideCache();

    expect(ResourceLoader.getOverrideResourcePath(TEST_RESOURCE_TYPE, 'stale')).toBeUndefined();
    await expect(ResourceLoader.loadResource(TEST_RESOURCE_TYPE, 'stale')).rejects.toThrow(
      'Resource not found',
    );
    expect(readFile).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  });

  test('rejects invalid index records', () => {
    expect(() => ResourceLoader.setOverrideResource(0, 'texture', 'Override/texture.tga')).toThrow();
    expect(() => ResourceLoader.setOverrideResource(TEST_RESOURCE_TYPE, '', 'Override/texture.tga')).toThrow();
    expect(() => ResourceLoader.setOverrideResource(TEST_RESOURCE_TYPE, 'texture', '')).toThrow();
    expect(() => ResourceLoader.setOverrideResource(TEST_RESOURCE_TYPE, 'texture', '../texture.tga')).toThrow();
    expect(() => ResourceLoader.setOverrideResource(TEST_RESOURCE_TYPE, 'texture', 'Override/../texture.tga')).toThrow();
  });

  test('selects the highest Override layer before preferring TPC within that layer', () => {
    ResourceLoader.setOverrideResource(ResourceTypes.tpc, 'character_skin', 'Override/character_skin.tpc', 'mod-1', 1);
    ResourceLoader.setOverrideResource(ResourceTypes.tga, 'character_skin', 'Override/character_skin.tga', 'mod-2', 2);
    ResourceLoader.setOverrideResource(ResourceTypes.tpc, 'equipment_skin', 'Override/equipment_skin.tpc', 'mod-2', 2);
    ResourceLoader.setOverrideResource(ResourceTypes.tga, 'equipment_skin', 'Override/equipment_skin.tga', 'mod-2', 2);

    expect(ResourceLoader.getOverrideTextureCandidate('character_skin')).toEqual({
      resourceType: ResourceTypes.tga,
      filepath: 'Override/character_skin.tga',
      layerId: 'mod-2',
      layerOrder: 2,
    });
    expect(ResourceLoader.getOverrideTextureCandidate('equipment_skin')).toEqual({
      resourceType: ResourceTypes.tpc,
      filepath: 'Override/equipment_skin.tpc',
      layerId: 'mod-2',
      layerOrder: 2,
    });
  });

  test('pairs a TXI only with a texture from its own layer', () => {
    ResourceLoader.setOverrideResource(ResourceTypes.tga, 'skin', 'Override/skin.tga', 'mod-1', 1);
    ResourceLoader.setOverrideResource(ResourceTypes.txi, 'skin', 'Override/skin.txi', 'mod-1', 1);
    ResourceLoader.setOverrideResource(ResourceTypes.tpc, 'skin', 'Override/skin.tpc', 'mod-2', 2);

    const selection = ResourceLoader.selectOverrideTexture('skin');

    expect(selection.primary.layerId).toBe('mod-2');
    // mod-1's TXI describes the texture mod-2 has replaced.
    expect(selection.companions.has(ResourceTypes.txi)).toBe(false);
  });
});

describe('an absent resref is a miss, not a crash', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
    ResourceLoader.InitCache();
    await ResourceLoader.InitOverrideCache();
    ResourceLoader.clearCache();
  });

  // Most callers pass `getTemplateResRef()` or a 2DA cell, and an object with
  // no template legitimately has none. `loadCachedResource` threw
  // "Cannot read properties of null (reading 'toLowerCase')" during module
  // load, which the sweep caught on 202TEL.
  test.each([null, undefined, ''])('getCache tolerates %p', (resRef) => {
    expect(ResourceLoader.getCache(TEST_RESOURCE_TYPE, resRef as any)).toBeNull();
  });

  test.each([null, undefined, ''])('loadCachedResource tolerates %p', (resRef) => {
    expect(ResourceLoader.loadCachedResource(TEST_RESOURCE_TYPE, resRef as any)).toBeNull();
  });

  test('a present resref still resolves through the cache', () => {
    const bytes = new Uint8Array([7, 7]);
    ResourceLoader.setCache(CacheScope.OVERRIDE, TEST_RESOURCE_TYPE, 'Present_Ref', bytes);
    expect(ResourceLoader.loadCachedResource(TEST_RESOURCE_TYPE, 'PRESENT_REF')).toBe(bytes);
  });
});

describe('ResourceLoader model pair resolution', () => {
  const resMDL = ResourceTypes['mdl'];
  const resMDX = ResourceTypes['mdx'];

  beforeEach(async () => {
    jest.restoreAllMocks();
    ResourceLoader.InitCache();
    await ResourceLoader.InitOverrideCache();
    ResourceLoader.clearCache();
    ResourceLoader.ModuleArchives = [];
  });

  const mockLayerFiles = (files: Record<string, Uint8Array>) =>
    jest.spyOn(GameFileSystem, 'readFile').mockImplementation(async (filepath: string) => {
      const buffer = files[filepath];
      if (!buffer) throw new Error(`missing ${filepath}`);
      return buffer;
    });

  test('takes both halves from the highest layer that supplies both', async () => {
    const readFile = mockLayerFiles({
      'Override/mod2/body.mdl': new Uint8Array([2]),
      'Override/mod2/body.mdx': new Uint8Array([22]),
      'Override/mod1/body.mdl': new Uint8Array([1]),
      'Override/mod1/body.mdx': new Uint8Array([11]),
    });
    ResourceLoader.setOverrideResource(resMDL, 'body', 'Override/mod1/body.mdl', 'mod-1', 1);
    ResourceLoader.setOverrideResource(resMDX, 'body', 'Override/mod1/body.mdx', 'mod-1', 1);
    ResourceLoader.setOverrideResource(resMDL, 'body', 'Override/mod2/body.mdl', 'mod-2', 2);
    ResourceLoader.setOverrideResource(resMDX, 'body', 'Override/mod2/body.mdx', 'mod-2', 2);

    await expect(ResourceLoader.loadModelPair('body')).resolves.toEqual({
      mdl: new Uint8Array([2]),
      mdx: new Uint8Array([22]),
    });
    expect(readFile).not.toHaveBeenCalledWith('Override/mod1/body.mdl');
  });

  test('falls through a layer that has only the MDL rather than mixing halves', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLayerFiles({
      'Override/mod2/body.mdl': new Uint8Array([2]),
      'Override/mod1/body.mdl': new Uint8Array([1]),
      'Override/mod1/body.mdx': new Uint8Array([11]),
    });
    // mod-2 ships an MDL with no MDX — the packaging mistake this guards.
    ResourceLoader.setOverrideResource(resMDL, 'body', 'Override/mod1/body.mdl', 'mod-1', 1);
    ResourceLoader.setOverrideResource(resMDX, 'body', 'Override/mod1/body.mdx', 'mod-1', 1);
    ResourceLoader.setOverrideResource(resMDL, 'body', 'Override/mod2/body.mdl', 'mod-2', 2);

    await expect(ResourceLoader.loadModelPair('body')).resolves.toEqual({
      mdl: new Uint8Array([1]),
      mdx: new Uint8Array([11]),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Override layer 'mod-2'"));
  });

  test('reports an incomplete layer once, not once per model load', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLayerFiles({ 'Override/mod1/body.mdl': new Uint8Array([1]) });
    ResourceLoader.setOverrideResource(resMDL, 'body', 'Override/mod1/body.mdl', 'mod-1', 1);
    jest.spyOn(ResourceLoader, 'loadArchivedResource')
      .mockResolvedValue(new Uint8Array([7]));

    await ResourceLoader.loadModelPair('body');
    await ResourceLoader.loadModelPair('body');

    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('ignores Override entirely when no layer supplies a complete pair', async () => {
    mockLayerFiles({ 'Override/mod1/body.mdl': new Uint8Array([1]) });
    ResourceLoader.setOverrideResource(resMDL, 'body', 'Override/mod1/body.mdl', 'mod-1', 1);
    const archived = jest.spyOn(ResourceLoader, 'loadArchivedResource')
      .mockImplementation(async (resId: number) => new Uint8Array([resId === resMDL ? 90 : 91]));

    await expect(ResourceLoader.loadModelPair('body')).resolves.toEqual({
      mdl: new Uint8Array([90]),
      mdx: new Uint8Array([91]),
    });
    // Not the layer's MDL paired with the archive's MDX.
    expect(archived).toHaveBeenCalledWith(resMDL, 'body');
    expect(archived).toHaveBeenCalledWith(resMDX, 'body');
  });

  test('a layer whose MDX indexes but will not read falls through too', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLayerFiles({ 'Override/mod1/body.mdl': new Uint8Array([1]) });
    ResourceLoader.setOverrideResource(resMDL, 'body', 'Override/mod1/body.mdl', 'mod-1', 1);
    ResourceLoader.setOverrideResource(resMDX, 'body', 'Override/mod1/body.mdx', 'mod-1', 1);
    jest.spyOn(ResourceLoader, 'loadArchivedResource')
      .mockImplementation(async (resId: number) => new Uint8Array([resId === resMDL ? 90 : 91]));

    await expect(ResourceLoader.loadModelPair('body')).resolves.toEqual({
      mdl: new Uint8Array([90]),
      mdx: new Uint8Array([91]),
    });
  });

  test('throws when neither Override nor the archives can supply the pair', async () => {
    jest.spyOn(ResourceLoader, 'loadArchivedResource').mockResolvedValue(undefined);
    await expect(ResourceLoader.loadModelPair('missing')).rejects.toThrow('Resource not found');
  });
});
