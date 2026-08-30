import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ERFManager } from '@/managers/ERFManager';
import { TPCLoader } from '@/loaders/TPCLoader';
import { TextureLoaderState } from '@/loaders/TextureLoaderState';
import { ResourceTypes } from '@/resource/ResourceTypes';

type ResourceInfo = { resRef: string; resType: number };

function createArchive(resources: Record<string, Uint8Array>) {
  return {
    getResourceInfo: jest.fn((resRef: string, resType: number) => {
      if (resType !== ResourceTypes.tpc || !resources[resRef]) return undefined;
      return { resRef, resType } as ResourceInfo;
    }),
    getResourceBuffer: jest.fn(async (resource: ResourceInfo) => resources[resource.resRef]),
  };
}

describe('TPCLoader GUI aliases', () => {
  const originalArchives = ERFManager.ERFs;
  const originalTextureQuality = TextureLoaderState.TextureQuality;

  beforeEach(() => {
    ERFManager.ERFs = new Map();
    TextureLoaderState.TextureQuality = 2;
  });

  afterEach(() => {
    ERFManager.ERFs = originalArchives;
    TextureLoaderState.TextureQuality = originalTextureQuality;
    jest.restoreAllMocks();
  });

  test.each([
    ['border1', 'border1c'],
    ['border2', 'border2c'],
  ])('resolves verified retail alias %s through %s', async (requestedName, packedName) => {
    const expected = new Uint8Array([1, 2, 3]);
    const guiArchive = createArchive({ [packedName]: expected });
    const textureArchive = createArchive({});
    ERFManager.ERFs.set('swpc_tex_gui', guiArchive as never);
    ERFManager.ERFs.set('swpc_tex_tpa', textureArchive as never);

    await expect(new TPCLoader().findTPC(requestedName)).resolves.toEqual({
      pack: 0,
      buffer: expected,
    });
    expect(guiArchive.getResourceInfo).toHaveBeenNthCalledWith(1, requestedName, ResourceTypes.tpc);
    expect(guiArchive.getResourceInfo).toHaveBeenNthCalledWith(2, packedName, ResourceTypes.tpc);
  });

  test('does not treat an arbitrary c-suffixed GUI texture as an alias', async () => {
    const incorrectGuiTexture = new Uint8Array([9]);
    const expectedTexture = new Uint8Array([4, 5, 6]);
    const guiArchive = createArchive({ panelc: incorrectGuiTexture });
    const textureArchive = createArchive({ panel: expectedTexture });
    ERFManager.ERFs.set('swpc_tex_gui', guiArchive as never);
    ERFManager.ERFs.set('swpc_tex_tpa', textureArchive as never);

    await expect(new TPCLoader().findTPC('panel')).resolves.toEqual({
      pack: 2,
      buffer: expectedTexture,
    });
    expect(guiArchive.getResourceInfo).toHaveBeenCalledTimes(1);
  });
});
