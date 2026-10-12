import { describe, expect, test } from '@jest/globals';
import { CacheScope } from '@/enums/resource/CacheScope';
import { ResourceLoader } from '@/loaders/ResourceLoader';
import { ERFObject } from '@/resource/ERFObject';
import { ResourceTypes } from '@/resource/ResourceTypes';

/**
 * Module archives arrive in priority order: the saved module, then the .mod,
 * then the stock .rim. With TSLRCM installed, 103PER has both a saved state and
 * a .mod, and the cache used to keep whichever archive finished loading last —
 * the .mod's module.ifo, which has no Mod_PlayerList, so the player respawned
 * at pc.utc's stale position off the walkmesh and the saved GIT was dropped.
 */
const fakeErf = (entries: Record<string, number>, delayMs: number): ERFObject => {
  const erf = Object.create(ERFObject.prototype) as ERFObject;
  (erf as any).keyList = Object.keys(entries).map((key) => {
    const [resRef, ext] = key.split('.');
    return { resRef, resType: ResourceTypes[ext] };
  });
  (erf as any).getResourceBufferByResRef = async (resRef: string, resType: number) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const key = Object.keys(entries).find((k) => k.split('.')[0] === resRef && ResourceTypes[k.split('.')[1]] === resType);
    const marker = key ? entries[key] : undefined;
    return marker === undefined ? undefined : new Uint8Array([marker]);
  };
  return erf;
};

describe('InitModuleCache archive priority', () => {
  test('the first archive wins even when a lower one finishes loading last', async () => {
    ResourceLoader.InitCache();
    const saved = fakeErf({ 'module.ifo': 1, '103per.git': 1 }, 0);
    const mod = fakeErf({ 'module.ifo': 2, '103per.git': 2, '103per.are': 2 }, 30);

    await ResourceLoader.InitModuleCache([saved, mod]);

    const scope = CacheScope.MODULE;
    expect(ResourceLoader.CacheScopes[scope].get(ResourceTypes.ifo).get('module')).toEqual(new Uint8Array([1]));
    expect(ResourceLoader.CacheScopes[scope].get(ResourceTypes.git).get('103per')).toEqual(new Uint8Array([1]));
    // Resources only the lower archive has still come through.
    expect(ResourceLoader.CacheScopes[scope].get(ResourceTypes.are).get('103per')).toEqual(new Uint8Array([2]));
  });

  test('an entry that will not read does not block a lower archive', async () => {
    ResourceLoader.InitCache();
    const broken = fakeErf({ 'module.ifo': undefined as unknown as number }, 30);
    const mod = fakeErf({ 'module.ifo': 2 }, 0);

    await ResourceLoader.InitModuleCache([broken, mod]);

    expect(ResourceLoader.CacheScopes[CacheScope.MODULE].get(ResourceTypes.ifo).get('module')).toEqual(new Uint8Array([2]));
  });
});
