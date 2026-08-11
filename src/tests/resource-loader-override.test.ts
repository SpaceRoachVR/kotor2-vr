import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { CacheScope } from '@/enums/resource/CacheScope';
import { ResourceLoader } from '@/loaders/ResourceLoader';
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
});
