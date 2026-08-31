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
      searchedSources: ['override-tpc', 'override-tga', 'active-module'],
    });
    expect(provider.attempts).toEqual([
      { source: 'override-tpc', resref: 'wall', activeModule: '101per' },
      { source: 'override-tga', resref: 'wall', activeModule: '101per' },
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

  test('uses the highest Override layer before TPC-versus-TGA format preference', async () => {
    await ResourceLoader.InitOverrideCache();
    ResourceLoader.setOverrideResource(ResourceTypes.tpc, 'character_skin', 'Override/character_skin.tpc', 'mod-1', 1);
    ResourceLoader.setOverrideResource(ResourceTypes.tga, 'character_skin', 'Override/character_skin.tga', 'mod-2', 2);
    const tgaTexture = texture('high-layer-tga');
    const tgaDecode = jest.fn(() => tgaTexture);
    const tpcDecode = jest.fn(() => texture('lower-layer-tpc'));
    const provider = new OdysseyTextureSourceProvider(
      { decode: tgaDecode } as any,
      { decode: tpcDecode } as any,
    );
    jest.spyOn(ResourceLoader, 'searchOverrideEntry').mockResolvedValue(new Uint8Array([1]));

    const tpc = await provider.load('override-tpc', 'character_skin');
    const tga = await provider.load('override-tga', 'character_skin');

    expect(tpc).toBeUndefined();
    expect(tga).toMatchObject({
      texture: tgaTexture,
      sourceLayerId: 'mod-2',
    });
    expect(tgaDecode).toHaveBeenCalledTimes(1);
    expect(tpcDecode).not.toHaveBeenCalled();
  });

  /**
   * Some GUI textures are simply absent from a given install — the chargen
   * feats screen asks for `lbl_indent` and `lbl_skarr`, which are K1 resrefs
   * that TSL does not ship. Retail draws nothing for a fill it cannot find, so
   * the magenta checker is now opt-in. What must NOT change either way is the
   * routing diagnostic: `vr:check` counts distinct failures from the router,
   * not from pixels.
   */
  const searchedAllGuiSources = [
    'override-tpc', 'override-tga', 'gui-pack', 'texture-pack', 'key-bif',
  ];

  test('leaves an unresolvable GUI texture undrawn by default', async () => {
    const provider = new SyntheticTextureProvider(new Map());
    TextureLoader.setSourceProvider(provider);
    const material = new THREE.MeshBasicMaterial();

    await TextureLoader.UpdateMaterial({
      name: 'missing_icon',
      material,
      type: TextureType.TEXTURE,
      semantic: 'gui',
    } as ITextureLoaderQueuedRef);

    expect(TextureLoader.DIAGNOSTIC_FALLBACK_ENABLED).toBe(false);
    expect(material.map).toBeNull();
    expect(provider.attempts.map(({ resref }) => resref)).toEqual([
      'missing_icon', 'missing_icon', 'missing_icon', 'missing_icon', 'missing_icon',
    ]);
    // The miss is still reported, so the gate's baseline is unaffected.
    expect(TextureLoader.getDiagnostics().at(-1)).toMatchObject({
      requestedResref: 'missing_icon',
      semantic: 'gui',
      searchedSources: searchedAllGuiSources,
      selectedSource: 'none',
      status: 'missing',
    });
  });

  test('uses the diagnostic GUI fallback when explicitly enabled', async () => {
    const previous = TextureLoader.DIAGNOSTIC_FALLBACK_ENABLED;
    TextureLoader.DIAGNOSTIC_FALLBACK_ENABLED = true;
    try {
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
      expect(TextureLoader.getDiagnostics().at(-1)).toMatchObject({
        requestedResref: 'missing_icon',
        semantic: 'gui',
        searchedSources: searchedAllGuiSources,
        selectedSource: 'none',
        fallback: 'diagnostic-checker',
      });
    } finally {
      TextureLoader.DIAGNOSTIC_FALLBACK_ENABLED = previous;
    }
  });

  test('records the owning placeable with a texture resolution diagnostic', async () => {
    const provider = new SyntheticTextureProvider(new Map([
      ['texture-pack:plc_box01', { texture: texture('plc-box01') }],
    ]));
    TextureLoader.setSourceProvider(provider);
    TextureLoader.beginModule('101PER');
    const material = new THREE.MeshBasicMaterial();
    material.userData.textureOwnerModel = {
      name: 'plc_box01',
      userData: {
        moduleObject: {
          getTag: () => 'peragus_supply_box',
          objectType: 8192,
        },
      },
    };

    await TextureLoader.UpdateMaterial({
      name: 'plc_box01',
      material,
      type: TextureType.TEXTURE,
      semantic: 'diffuse',
      activeModule: '101per',
    } as ITextureLoaderQueuedRef);

    expect(TextureLoader.getDiagnostics().at(-1)).toMatchObject({
      requestedResref: 'plc_box01',
      activeModule: '101per',
      ownerModelName: 'plc_box01',
      ownerObjectTag: 'peragus_supply_box',
      ownerObjectType: 8192,
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

  test('reuses a shared global texture across diffuse and lightmap semantics through a module transition', async () => {
    const diffuseTexture = texture('shared-surface-diffuse');
    const lightmapCandidate = texture('shared-surface-lightmap-candidate');
    const returningDiffuseCandidate = texture('shared-surface-returning-diffuse');
    const returningLightmapCandidate = texture('shared-surface-returning-lightmap');
    const disposeDiffuse = jest.spyOn(diffuseTexture, 'dispose');
    const disposeLightmapCandidate = jest.spyOn(lightmapCandidate, 'dispose');
    const disposeReturningDiffuseCandidate = jest.spyOn(returningDiffuseCandidate, 'dispose');
    const disposeReturningLightmapCandidate = jest.spyOn(returningLightmapCandidate, 'dispose');
    const candidates = [
      diffuseTexture,
      lightmapCandidate,
      returningDiffuseCandidate,
      returningLightmapCandidate,
    ];
    const provider: TextureSourceProvider<OdysseyTexture> = {
      async load(source, resref) {
        if (source !== 'texture-pack' || resref !== 'shared_surface') {
          return undefined;
        }
        const candidate = candidates.shift();
        if (!candidate) {
          throw new Error('Unexpected shared texture decode');
        }
        return { texture: candidate, txiSource: 'embedded-tpc' };
      },
    };
    TextureLoader.setSourceProvider(provider);

    TextureLoader.beginModule('101PER');
    const firstMaterial = new THREE.MeshBasicMaterial();
    firstMaterial.map = await TextureLoader.Load('shared_surface');
    const firstLightmap = await TextureLoader.LoadLightmap('shared_surface');

    expect(firstLightmap).toBe(firstMaterial.map);
    expect(disposeDiffuse).not.toHaveBeenCalled();
    expect(disposeLightmapCandidate).toHaveBeenCalledTimes(1);
    TextureLoader.endModule();

    TextureLoader.beginModule('102PER');
    await expect(TextureLoader.Load('shared_surface')).resolves.toBe(firstMaterial.map);
    await expect(TextureLoader.LoadLightmap('shared_surface')).resolves.toBe(firstMaterial.map);

    expect(firstMaterial.map).toBe(diffuseTexture);
    expect(disposeDiffuse).not.toHaveBeenCalled();
    expect(disposeReturningDiffuseCandidate).toHaveBeenCalledTimes(1);
    expect(disposeReturningLightmapCandidate).toHaveBeenCalledTimes(1);
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
      { source: 'override-tpc', resref: 'effect_icon', activeModule: '101per' },
      { source: 'override-tga', resref: 'effect_icon', activeModule: '101per' },
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

  test('revalidates module shadows without replacing a shared GUI texture still used by the previous module', async () => {
    const firstSharedGuiTexture = texture('101-shared-panel');
    const returningSharedCandidate = texture('101-returning-panel');
    const moduleGuiTexture = texture('102-panel');
    const disposeFirstSharedGui = jest.spyOn(firstSharedGuiTexture, 'dispose');
    const disposeReturningCandidate = jest.spyOn(returningSharedCandidate, 'dispose');
    let sharedCandidateLoads = 0;
    const provider: TextureSourceProvider<OdysseyTexture> = {
      async load(source, resref, activeModule) {
        if (resref !== 'panel') {
          return undefined;
        }
        if (source === 'active-module' && activeModule === '102per') {
          return { texture: moduleGuiTexture };
        }
        if (source === 'gui-pack') {
          // A real decode path may construct a new candidate on every lookup.
          // The resolver must retain the original shared instance for 101PER.
          sharedCandidateLoads += 1;
          return {
            texture: sharedCandidateLoads === 1 ? firstSharedGuiTexture : returningSharedCandidate,
            txiSource: 'embedded-tpc',
          };
        }
        return undefined;
      },
    };
    TextureLoader.setSourceProvider(provider);

    TextureLoader.beginModule('101PER');
    const firstModuleMaterial = new THREE.MeshBasicMaterial();
    const firstSharedTexture = await TextureLoader.LoadGUI('panel');
    firstModuleMaterial.map = firstSharedTexture;
    TextureLoader.endModule();

    TextureLoader.beginModule('102PER');
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(moduleGuiTexture);
    TextureLoader.endModule();

    TextureLoader.beginModule('101PER');
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(firstSharedTexture);

    expect(firstModuleMaterial.map).toBe(firstSharedTexture);
    expect(disposeFirstSharedGui).not.toHaveBeenCalled();
    expect(disposeReturningCandidate).toHaveBeenCalledTimes(1);
  });

  test.each([
    { label: 'a scalar request', names: 'panel' as string | string[] },
    { label: 'an array request', names: ['panel'] as string | string[] },
  ])('routes $label through the active-module resolver and not a raw legacy cache', async ({ names }) => {
    const sharedGuiTexture = texture('shared-panel');
    const moduleGuiTexture = texture('102-panel');
    const provider: TextureSourceProvider<OdysseyTexture> = {
      async load(source, resref, activeModule) {
        if (resref !== 'panel') {
          return undefined;
        }
        if (source === 'active-module' && activeModule === '102per') {
          return { texture: moduleGuiTexture };
        }
        return source === 'gui-pack'
          ? { texture: sharedGuiTexture, txiSource: 'embedded-tpc' }
          : undefined;
      },
    };
    TextureLoader.setSourceProvider(provider);

    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(sharedGuiTexture);
    TextureLoader.beginModule('102PER');

    const material = new THREE.MeshBasicMaterial();
    const delivered = jest.fn();
    TextureLoader.enQueue(names, material, TextureType.TEXTURE, delivered, undefined, 'gui');
    await TextureLoader.LoadQueue();

    expect(material.map).toBe(moduleGuiTexture);
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(delivered).toHaveBeenCalledWith(moduleGuiTexture, expect.any(Object));
  });

  test('retains a shared GUI identity when no module shadows it across transitions', async () => {
    const firstModuleTexture = texture('101-first-panel');
    const secondModuleTexture = texture('102-panel');
    const returningModuleTexture = texture('101-returning-panel');
    const disposeSecondCandidate = jest.spyOn(secondModuleTexture, 'dispose');
    const disposeReturningCandidate = jest.spyOn(returningModuleTexture, 'dispose');
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
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(firstModuleTexture);
    TextureLoader.endModule();

    TextureLoader.beginModule('101PER');
    await expect(TextureLoader.LoadGUI('panel')).resolves.toBe(firstModuleTexture);

    expect(firstModuleLoads).toBe(2);
    expect(disposeSecondCandidate).toHaveBeenCalledTimes(1);
    expect(disposeReturningCandidate).toHaveBeenCalledTimes(1);
  });

});

describe('Odyssey texture source provider', () => {
  afterEach(() => jest.restoreAllMocks());

  test('reads and attributes an Override TXI only from the selected TGA layer', async () => {
    const tgaBuffer = new Uint8Array([1]);
    const txiBuffer = new Uint8Array([2]);
    const decoded = texture('override-panel');
    await ResourceLoader.InitOverrideCache();
    ResourceLoader.setOverrideResource(ResourceTypes.tga, 'panel', 'Override/panel.tga', 'mod-2', 2);
    ResourceLoader.setOverrideResource(ResourceTypes.txi, 'panel', 'Override/panel.txi', 'mod-2', 2);
    const searchOverrideEntry = jest.spyOn(ResourceLoader, 'searchOverrideEntry')
      .mockImplementation(async (entry) => entry.resourceType === ResourceTypes.tga ? tgaBuffer : txiBuffer);
    const decode = jest.fn((_buffer: Uint8Array, _resref: string, _txi?: Uint8Array) => decoded);
    const provider = new OdysseyTextureSourceProvider(
      { decode } as never,
      {} as never,
    );

    await expect(provider.load('override-tga', 'panel')).resolves.toEqual({
      texture: decoded,
      txiSource: 'override-txi',
      sourceLayerId: 'mod-2',
    });
    expect(decode).toHaveBeenCalledWith(tgaBuffer, 'panel', txiBuffer);

    searchOverrideEntry.mockClear();
    await expect(provider.load('override-tga', 'missing')).resolves.toBeUndefined();
    expect(searchOverrideEntry).not.toHaveBeenCalled();
  });
});
