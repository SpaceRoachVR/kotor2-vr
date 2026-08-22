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
