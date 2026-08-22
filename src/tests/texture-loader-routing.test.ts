import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as THREE from 'three';
import { OdysseyTextureSourceProvider, TextureLoader } from '@/loaders/TextureLoader';
import {
  TextureResolutionSource,
  TextureSourceArtifact,
  TextureSourceProvider,
} from '@/loaders/TextureResolution';
import { OdysseyTexture } from '@/three/odyssey/OdysseyTexture';
import { TXI } from '@/resource/TXI';
import { TextureType } from '@/enums/loaders/TextureType';
import { ITextureLoaderQueuedRef } from '@/interface/loaders/ITextureLoaderQueuedRef';
import { ResourceLoader } from '@/loaders/ResourceLoader';
import { ResourceTypes } from '@/resource/ResourceTypes';

class SyntheticTextureProvider implements TextureSourceProvider<OdysseyTexture> {
  readonly attempts: Array<{ source: TextureResolutionSource; resref: string; activeModule?: string }> = [];

  constructor(
    private readonly artifacts: ReadonlyMap<string, TextureSourceArtifact<OdysseyTexture>>,
  ) {}

  async load(source: TextureResolutionSource, resref: string, activeModule?: string) {
    this.attempts.push({ source, resref, activeModule });
    return this.artifacts.get(`${source}:${resref}`);
  }
}

function texture(name: string, txi = ''): OdysseyTexture {
  const result = new OdysseyTexture();
  result.name = name;
  result.txi = new TXI(txi);
  return result;
}

describe('production texture resolver routing', () => {
  beforeEach(() => {
    TextureLoader.resetRoutingForTests();
  });

  afterEach(() => {
    TextureLoader.resetRoutingForTests();
    jest.restoreAllMocks();
  });

  test('routes a real Load request through Override, module, pack, and base precedence', async () => {
    const moduleTexture = texture('module-wall');
    const provider = new SyntheticTextureProvider(new Map([
      ['active-module:wall', { texture: moduleTexture, txiSource: 'active-module-txi' }],
      ['texture-pack:wall', { texture: texture('packed-wall'), txiSource: 'embedded-tpc' }],
    ]));
    TextureLoader.setSourceProvider(provider);
    TextureLoader.beginModule('101PER');

    const resolution = await TextureLoader.Resolve({
      resref: 'WALL',
      semantic: 'diffuse',
      allowAlias: false,
    });

    expect(resolution).toMatchObject({
      status: 'resolved',
      requestedResref: 'wall',
      resolvedResref: 'wall',
      source: 'active-module',
      txiSource: 'active-module-txi',
      texture: moduleTexture,
      searchedSources: ['override-tga', 'override-tpc', 'active-module'],
    });
    expect(provider.attempts).toEqual([
      { source: 'override-tga', resref: 'wall', activeModule: '101per' },
      { source: 'override-tpc', resref: 'wall', activeModule: '101per' },
      { source: 'active-module', resref: 'wall', activeModule: '101per' },
    ]);
  });

  test('applies a winning TGA TXI sidecar and disables stale optional maps', async () => {
    const diffuse = texture('panel', 'envmaptexture env_old');
    const provider = new SyntheticTextureProvider(new Map([
      ['override-tga:panel', { texture: diffuse, txiSource: 'override-txi' }],
    ]));
    TextureLoader.setSourceProvider(provider);
    const material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: null },
        envMap: { value: texture('stale-env') },
        normalMap: { value: texture('stale-normal') },
        bumpMap: { value: texture('stale-bump') },
        animationVectorMap: { value: new THREE.Vector4() },
        animationVectorBump: { value: new THREE.Vector4() },
        waterAlpha: { value: 1 },
        uvTransform: { value: new THREE.Matrix3() },
      },
      defines: { USE_ENVMAP: '', USE_NORMALMAP: '', USE_BUMPMAP: '' },
    });

    await TextureLoader.UpdateMaterial({
      name: 'panel',
      material,
      type: TextureType.TEXTURE,
      semantic: 'diffuse',
    } as ITextureLoaderQueuedRef);

    expect(material.uniforms.map.value).toBe(diffuse);
    expect(material.uniforms.envMap.value).toBeNull();
    expect(material.uniforms.normalMap.value).toBeNull();
    expect(material.uniforms.bumpMap.value).toBeNull();
    expect(material.defines.USE_ENVMAP).toBeUndefined();
    expect(material.defines.USE_NORMALMAP).toBeUndefined();
    expect(material.defines.USE_BUMPMAP).toBeUndefined();
    expect(TextureLoader.getDiagnostics().find(({ requestedResref }) => requestedResref === 'panel')).toMatchObject({
      requestedResref: 'panel',
      semantic: 'diffuse',
      selectedSource: 'override-tga',
      txiSource: 'override-txi',
    });
  });

  test('uses the diagnostic GUI fallback without inventing an alias', async () => {
    const provider = new SyntheticTextureProvider(new Map());
    TextureLoader.setSourceProvider(provider);
    const material = new THREE.MeshBasicMaterial();

    await TextureLoader.UpdateMaterial({
      name: 'missing_icon',
      material,
      type: TextureType.TEXTURE,
      semantic: 'gui',
    } as ITextureLoaderQueuedRef);

    expect(material.map).toBe(TextureLoader.getDiagnosticFallbackTexture());
    expect(provider.attempts.map(({ resref }) => resref)).toEqual([
      'missing_icon', 'missing_icon', 'missing_icon', 'missing_icon', 'missing_icon',
    ]);
    expect(TextureLoader.getDiagnostics().at(-1)).toMatchObject({
      requestedResref: 'missing_icon',
      semantic: 'gui',
      searchedSources: ['override-tga', 'override-tpc', 'gui-pack', 'texture-pack', 'key-bif'],
      selectedSource: 'none',
      fallback: 'diagnostic-checker',
    });
  });

  test('disposes module-owned textures on unload while retaining shared GUI textures', async () => {
    const moduleTexture = texture('module-wall');
    const guiTexture = texture('gui-panel');
    const disposeModule = jest.spyOn(moduleTexture, 'dispose');
    const disposeGui = jest.spyOn(guiTexture, 'dispose');
    const provider = new SyntheticTextureProvider(new Map([
      ['active-module:wall', { texture: moduleTexture }],
      ['gui-pack:panel', { texture: guiTexture, txiSource: 'embedded-tpc' }],
    ]));
    TextureLoader.setSourceProvider(provider);
    TextureLoader.beginModule('102PER');

    await TextureLoader.Resolve({ resref: 'wall', semantic: 'diffuse', allowAlias: false });
    await TextureLoader.Resolve({ resref: 'panel', semantic: 'gui', allowAlias: false });
    const unload = TextureLoader.endModule();

    expect(unload.disposed).toBe(1);
    expect(disposeModule).toHaveBeenCalledTimes(1);
    expect(disposeGui).not.toHaveBeenCalled();
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(guiTexture);
  });

  test('reuses a GUI-pack texture after module unload without consulting a stale module cache key', async () => {
    const guiTexture = texture('shared-effect-icon');
    const provider = new SyntheticTextureProvider(new Map([
      ['gui-pack:effect_icon', { texture: guiTexture, txiSource: 'embedded-tpc' }],
    ]));
    TextureLoader.setSourceProvider(provider);
    TextureLoader.beginModule('101PER');

    await expect(TextureLoader.LoadGUI('effect_icon')).resolves.toBe(guiTexture);
    TextureLoader.endModule();
    await expect(TextureLoader.LoadGUI('effect_icon')).resolves.toBe(guiTexture);

    expect(provider.attempts).toEqual([
      { source: 'override-tga', resref: 'effect_icon', activeModule: '101per' },
      { source: 'override-tpc', resref: 'effect_icon', activeModule: '101per' },
      { source: 'active-module', resref: 'effect_icon', activeModule: '101per' },
      { source: 'gui-pack', resref: 'effect_icon', activeModule: '101per' },
    ]);
  });

  test('keeps resolver-owned model textures alive until each module generation unloads', async () => {
    const firstGenerationTextures = [
      texture('first-wall'),
      texture('first-environment'),
      texture('first-lightmap'),
      texture('first-bump'),
    ];
    const secondGenerationWall = texture('second-wall');
    const disposeFirstGeneration = firstGenerationTextures.map((value) => jest.spyOn(value, 'dispose'));
    const disposeSecondWall = jest.spyOn(secondGenerationWall, 'dispose');
    const provider: TextureSourceProvider<OdysseyTexture> = {
      async load(source, resref, activeModule) {
        if (source !== 'active-module') {
          return undefined;
        }
        if (activeModule === '101per') {
          const index = ['wall', 'environment', 'lightmap', 'bump'].indexOf(resref);
          return index >= 0 ? { texture: firstGenerationTextures[index] } : undefined;
        }
        if (activeModule === '102per' && resref === 'wall') {
          return { texture: secondGenerationWall };
        }
        return undefined;
      },
    };
    TextureLoader.setSourceProvider(provider);
    TextureLoader.beginModule('101PER');

    const [map, envMap, lightMap, bumpMap] = await Promise.all([
      TextureLoader.Load('wall'),
      TextureLoader.Resolve({ resref: 'environment', semantic: 'environment', allowAlias: false }),
      TextureLoader.LoadLightmap('lightmap'),
      TextureLoader.Resolve({ resref: 'bump', semantic: 'bump', allowAlias: false }),
    ]);
    TextureLoader.disposeModelOwnedTexture(map);
    TextureLoader.disposeModelOwnedTexture(envMap.status === 'resolved' ? envMap.texture : undefined);
    TextureLoader.disposeModelOwnedTexture(lightMap);
    TextureLoader.disposeModelOwnedTexture(bumpMap.status === 'resolved' ? bumpMap.texture : undefined);

    for (const dispose of disposeFirstGeneration) {
      expect(dispose).not.toHaveBeenCalled();
    }
    expect(TextureLoader.endModule()).toMatchObject({ disposed: 4 });
    for (const dispose of disposeFirstGeneration) {
      expect(dispose).toHaveBeenCalledTimes(1);
    }

    TextureLoader.beginModule('102PER');
    await expect(TextureLoader.Load('wall')).resolves.toBe(secondGenerationWall);
    TextureLoader.disposeModelOwnedTexture(secondGenerationWall);
    expect(disposeSecondWall).not.toHaveBeenCalled();
    expect(TextureLoader.endModule()).toMatchObject({ disposed: 1 });
    expect(disposeSecondWall).toHaveBeenCalledTimes(1);
  });

  test('does not hand a disposed module GUI texture to queued consumers after module unload', async () => {
    const moduleGuiTexture = texture('module-panel');
    const sharedGuiTexture = texture('shared-panel');
    const disposeModuleGui = jest.spyOn(moduleGuiTexture, 'dispose');
    const provider = new SyntheticTextureProvider(new Map([
      ['active-module:panel', { texture: moduleGuiTexture }],
      ['gui-pack:panel', { texture: sharedGuiTexture, txiSource: 'embedded-tpc' }],
    ]));
    TextureLoader.setSourceProvider(provider);
    TextureLoader.beginModule('101PER');

    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(moduleGuiTexture);
    TextureLoader.endModule();

    const material = new THREE.MeshBasicMaterial();
    const delivered = jest.fn();
    TextureLoader.enQueue('panel', material, TextureType.TEXTURE, delivered, undefined, 'gui');
    await TextureLoader.LoadQueue();

    expect(disposeModuleGui).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledWith(sharedGuiTexture, expect.any(Object));
    expect(material.map).toBe(sharedGuiTexture);
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(sharedGuiTexture);
  });

  test('keeps a borrowed GUI texture live when a consumer releases it and reloads it', async () => {
    const guiTexture = texture('effect-icon');
    const disposeGui = jest.spyOn(guiTexture, 'dispose');
    const provider = new SyntheticTextureProvider(new Map([
      ['gui-pack:effect_icon', { texture: guiTexture, txiSource: 'embedded-tpc' }],
    ]));
    TextureLoader.setSourceProvider(provider);

    const consumerTexture = await TextureLoader.LoadGUI('effect_icon');
    TextureLoader.releaseGUITexture(consumerTexture);

    await expect(TextureLoader.LoadGUI('effect_icon')).resolves.toBe(guiTexture);
    expect(disposeGui).not.toHaveBeenCalled();
  });

  test('keeps a resolver-owned GUI texture alive after a module-local texture shadows it', async () => {
    const sharedGuiTexture = texture('shared-panel');
    const moduleGuiTexture = texture('module-panel');
    const disposeSharedGui = jest.spyOn(sharedGuiTexture, 'dispose');
    const disposeModuleGui = jest.spyOn(moduleGuiTexture, 'dispose');
    const provider = new SyntheticTextureProvider(new Map([
      ['gui-pack:panel', { texture: sharedGuiTexture, txiSource: 'embedded-tpc' }],
      ['active-module:panel', { texture: moduleGuiTexture }],
    ]));
    TextureLoader.setSourceProvider(provider);

    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(sharedGuiTexture);
    TextureLoader.beginModule('101PER');
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(moduleGuiTexture);
    TextureLoader.endModule();

    TextureLoader.releaseGUITexture(sharedGuiTexture);

    expect(disposeModuleGui).toHaveBeenCalledTimes(1);
    expect(disposeSharedGui).not.toHaveBeenCalled();
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(sharedGuiTexture);
  });

  test('does not reuse a disposed shared GUI texture through a previous module cache key', async () => {
    const firstModuleTexture = texture('101-first-panel');
    const secondModuleTexture = texture('102-panel');
    const returningModuleTexture = texture('101-returning-panel');
    const disposeFirst = jest.spyOn(firstModuleTexture, 'dispose');
    let firstModuleLoads = 0;
    const provider: TextureSourceProvider<OdysseyTexture> = {
      async load(source, resref, activeModule) {
        if (source !== 'gui-pack' || resref !== 'panel') {
          return undefined;
        }
        if (activeModule === '101per') {
          firstModuleLoads += 1;
          return {
            texture: firstModuleLoads === 1 ? firstModuleTexture : returningModuleTexture,
            txiSource: 'embedded-tpc',
          };
        }
        if (activeModule === '102per') {
          return { texture: secondModuleTexture, txiSource: 'embedded-tpc' };
        }
        return undefined;
      },
    };
    TextureLoader.setSourceProvider(provider);

    TextureLoader.beginModule('101PER');
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(firstModuleTexture);
    TextureLoader.endModule();

    TextureLoader.beginModule('102PER');
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(secondModuleTexture);
    TextureLoader.endModule();

    TextureLoader.beginModule('101PER');
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(returningModuleTexture);

    expect(firstModuleLoads).toBe(2);
    expect(disposeFirst).toHaveBeenCalledTimes(1);
  });

});

describe('Odyssey texture source provider', () => {
  afterEach(() => jest.restoreAllMocks());

  test('reads and attributes an Override TXI only when its TGA exists', async () => {
    const tgaBuffer = new Uint8Array([1]);
    const txiBuffer = new Uint8Array([2]);
    const decoded = texture('override-panel');
    const searchOverride = jest.spyOn(ResourceLoader, 'searchOverride')
      .mockImplementation(async (resourceType) => {
        if (resourceType === ResourceTypes.tga) return tgaBuffer;
        if (resourceType === ResourceTypes.txi) return txiBuffer;
        return undefined;
      });
    const decode = jest.fn((_buffer: Uint8Array, _resref: string, _txi?: Uint8Array) => decoded);
    const provider = new OdysseyTextureSourceProvider(
      { decode } as never,
      {} as never,
    );

    await expect(provider.load('override-tga', 'panel')).resolves.toEqual({
      texture: decoded,
      txiSource: 'override-txi',
    });
    expect(decode).toHaveBeenCalledWith(tgaBuffer, 'panel', txiBuffer);

    searchOverride.mockClear();
    searchOverride.mockResolvedValue(undefined);
    await expect(provider.load('override-tga', 'missing')).resolves.toBeUndefined();
    expect(searchOverride).toHaveBeenCalledTimes(1);
    expect(searchOverride).toHaveBeenCalledWith(ResourceTypes.tga, 'missing');
  });
});
