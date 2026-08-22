import * as THREE from 'three';
import * as path from "path";
import { PixelFormat } from "@/enums/graphics/tpc/PixelFormat";
import { TextureType } from "@/enums/loaders/TextureType";
import { ITextureLoaderQueuedRef } from "@/interface/loaders/ITextureLoaderQueuedRef";
import { TXIBlending } from "@/enums/graphics/txi/TXIBlending";
import { TPCLoader } from "@/loaders/TPCLoader";
import { TGALoader } from "@/loaders/TGALoader";
import { OdysseyTexture } from "@/three/odyssey/OdysseyTexture";
import { OdysseyMaterialBuilder } from "@/three/odyssey/OdysseyMaterialBuilder";
import { GameFileSystem } from "@/utility/GameFileSystem";
import { GameEngineType } from "@/enums/engine";
import { ResourceLoader } from "@/loaders/ResourceLoader";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { TXI } from "@/resource/TXI";
import {
  ExplicitTextureAlias,
  ResolvedTextureSource,
  TextureLifetimeRegistry,
  TextureOwnership,
  TextureRequest,
  TextureResolution,
  TextureResolver,
  TextureSemantic,
  TextureSourceArtifact,
  TextureSourceProvider,
  isOptionalTextureSemantic,
  isTextureResrefUsable,
  normalizeTextureResref,
  validateTextureResolution,
} from "@/loaders/TextureResolution";

type onProgressCallback = (ref: ITextureLoaderQueuedRef, index: number, total: number) => void;

const PRODUCTION_TEXTURE_ALIASES: readonly ExplicitTextureAlias[] = Object.freeze([
  {
    requestedResref: 'border1',
    resolvedResref: 'border1c',
    evidence: 'retail-tsl-gui-pack:swpc_tex_gui.erf',
  },
  {
    requestedResref: 'border2',
    resolvedResref: 'border2c',
    evidence: 'retail-tsl-gui-pack:swpc_tex_gui.erf',
  },
]);

export interface TextureRoutingDiagnostic {
  readonly requestedResref: string;
  readonly resolvedResref?: string;
  readonly semantic: TextureSemantic;
  readonly activeModule?: string;
  readonly status: TextureResolution<OdysseyTexture>['status'];
  readonly searchedSources: readonly ResolvedTextureSource[];
  readonly selectedSource: TextureResolution<OdysseyTexture>['source'];
  readonly txiSource?: TextureResolution<OdysseyTexture>['txiSource'];
  readonly fallback?: string;
  readonly diagnosticCode?: string;
  readonly cacheGeneration: number;
}

export class OdysseyTextureSourceProvider implements TextureSourceProvider<OdysseyTexture> {
  constructor(
    private readonly tgaLoader: TGALoader,
    private readonly tpcLoader: TPCLoader,
  ) {}

  async load(
    source: ResolvedTextureSource,
    resref: string,
    activeModule?: string,
  ): Promise<TextureSourceArtifact<OdysseyTexture> | undefined> {
    switch (source) {
      case 'override-tga':
        {
          const tgaBuffer = await ResourceLoader.searchOverride(ResourceTypes.tga, resref);
          if (!tgaBuffer?.length) {
            return undefined;
          }
          return this.loadTga(
            tgaBuffer,
            resref,
            await ResourceLoader.searchOverride(ResourceTypes.txi, resref),
            'override-txi',
          );
        }
      case 'override-tpc':
        return this.loadTpc(
          await ResourceLoader.searchOverride(ResourceTypes.tpc, resref),
          resref,
          undefined,
        );
      case 'active-module': {
        if (!activeModule) {
          return undefined;
        }
        const tgaBuffer = await ResourceLoader.searchModuleArchives(ResourceTypes.tga, resref);
        if (tgaBuffer) {
          return this.loadTga(
            tgaBuffer,
            resref,
            await ResourceLoader.searchModuleArchives(ResourceTypes.txi, resref),
            'active-module-txi',
          );
        }
        return this.loadTpc(
          await ResourceLoader.searchModuleArchives(ResourceTypes.tpc, resref),
          resref,
          undefined,
        );
      }
      case 'gui-pack': {
        const result = await this.tpcLoader.findInGuiPack(resref);
        return result ? this.loadTpc(result.buffer, resref, result.pack) : undefined;
      }
      case 'texture-pack': {
        const result = await this.tpcLoader.findInTexturePack(resref);
        return result ? this.loadTpc(result.buffer, resref, result.pack) : undefined;
      }
      case 'key-bif': {
        const result = await this.tpcLoader.findInKeyTable(resref);
        return result ? this.loadTpc(result.buffer, resref, result.pack) : undefined;
      }
    }
  }

  private loadTga(
    buffer: Uint8Array | undefined,
    resref: string,
    txiBuffer: Uint8Array | undefined,
    txiSource: 'override-txi' | 'active-module-txi',
  ): TextureSourceArtifact<OdysseyTexture> | undefined {
    if (!buffer?.length) {
      return undefined;
    }
    return {
      texture: this.tgaLoader.decode(buffer, resref, txiBuffer),
      ...(txiBuffer?.length ? { txiSource } : {}),
    };
  }

  private loadTpc(
    buffer: Uint8Array | undefined,
    resref: string,
    pack: number | undefined,
  ): TextureSourceArtifact<OdysseyTexture> | undefined {
    if (!buffer?.length) {
      return undefined;
    }
    return {
      texture: this.tpcLoader.decode(buffer, resref, pack),
      txiSource: 'embedded-tpc',
    };
  }
}

/**
 * TextureLoader class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file TextureLoader.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class TextureLoader {

  static tpcLoader = new TPCLoader();
  static tgaLoader = new TGALoader();
  static textures = new Map();
  static guiTextures = new Map();
  static lightmaps: any = {};
  static particles: any = {};
  static queue: ITextureLoaderQueuedRef[] = [];

  /** Names already reported as unresolvable, so each is warned about only once. */
  static MISSING_REPORTED = new Set<string>();
  static Anisotropy = 8;
  static loadInflight: Map<string, Promise<TextureResolution<OdysseyTexture>>> = new Map();
  static pendingSubscribers: Map<string, ITextureLoaderQueuedRef[]> = new Map();
  private static sourceProvider: TextureSourceProvider<OdysseyTexture> = TextureLoader.createDefaultSourceProvider();
  private static resolver = TextureLoader.createResolver(TextureLoader.sourceProvider);
  private static lifetimeRegistry = new TextureLifetimeRegistry<OdysseyTexture>();
  private static resolutionCache = new Map<string, {
    resolution: TextureResolution<OdysseyTexture>;
    ownership: TextureOwnership;
    generation: number;
  }>();
  private static routingDiagnostics: TextureRoutingDiagnostic[] = [];
  private static activeModule?: string;
  private static diagnosticFallbackTexture?: OdysseyTexture;

  static GameKey: GameEngineType;
  
  static onAnisotropyChanged = () => {
    TextureLoader.textures.forEach( tex => {
      tex.anisotropy = TextureLoader.Anisotropy;
      tex.needsUpdate = true;
    });
  };
  
  static CACHE = false; //Should be false but it's causing isses if textures are cached
  static NOCACHE = true;

  static async Load(resRef: string, noCache: boolean = false): Promise<OdysseyTexture> {
    return TextureLoader.unwrap(await TextureLoader.Resolve({
      resref: resRef,
      semantic: 'diffuse',
      allowAlias: false,
    }, noCache));
  }

  static async LoadGUI(resRef: string, noCache: boolean = false): Promise<OdysseyTexture> {
    return TextureLoader.unwrap(await TextureLoader.Resolve({
      resref: resRef,
      semantic: 'gui',
      allowAlias: true,
    }, noCache));
  }

  static async Resolve(
    request: TextureRequest,
    noCache: boolean = false,
  ): Promise<TextureResolution<OdysseyTexture>> {
    const normalizedRequest: TextureRequest = {
      ...request,
      resref: normalizeTextureResref(request.resref),
      ...(request.activeModule === undefined && TextureLoader.activeModule
        ? { activeModule: TextureLoader.activeModule }
        : {}),
    };
    const cacheKey = TextureLoader.getCacheKey(normalizedRequest);
    const cached = noCache ? undefined : TextureLoader.resolutionCache.get(cacheKey);
    if (cached) {
      TextureLoader.recordDiagnostic(normalizedRequest, cached.resolution);
      return validateTextureResolution(cached.resolution);
    }
    const inflight = noCache ? undefined : TextureLoader.loadInflight.get(cacheKey);
    if (inflight) {
      return inflight;
    }
    const resolutionPromise = TextureLoader.resolver.resolve(normalizedRequest).then((result) => {
      const resolution = validateTextureResolution(result);
      if (resolution.status === 'resolved') {
        TextureLoader.prepareTexture(resolution.texture);
        if (!noCache) {
          TextureLoader.cacheResolution(cacheKey, normalizedRequest, resolution);
        }
      }
      TextureLoader.recordDiagnostic(normalizedRequest, resolution);
      return resolution;
    }).finally(() => {
      TextureLoader.loadInflight.delete(cacheKey);
    });
    if (!noCache) {
      TextureLoader.loadInflight.set(cacheKey, resolutionPromise);
    }
    return resolutionPromise;
  }

  static setSourceProvider(provider: TextureSourceProvider<OdysseyTexture>): void {
    if (!provider || typeof provider.load !== 'function') {
      throw new TypeError('Texture source provider must implement load');
    }
    TextureLoader.sourceProvider = provider;
    TextureLoader.resolver = TextureLoader.createResolver(provider);
    TextureLoader.clearRoutingCaches();
  }

  static beginModule(moduleName: string): void {
    const normalizedModule = normalizeTextureResref(moduleName);
    if (!isTextureResrefUsable(normalizedModule)) {
      throw new TypeError(`Invalid active module '${moduleName}'`);
    }
    if (TextureLoader.activeModule && TextureLoader.activeModule !== normalizedModule) {
      throw new Error(`Texture module '${TextureLoader.activeModule}' must unload before '${normalizedModule}' begins`);
    }
    TextureLoader.activeModule = normalizedModule;
  }

  static endModule(): { disposed: number; nextGeneration: number } {
    if (!TextureLoader.activeModule) {
      return {
        disposed: 0,
        nextGeneration: TextureLoader.lifetimeRegistry.currentGeneration,
      };
    }
    const generation = TextureLoader.lifetimeRegistry.currentGeneration;
    const result = TextureLoader.lifetimeRegistry.disposeModuleGeneration(generation);
    for (const [key, entry] of TextureLoader.resolutionCache) {
      if (entry.ownership === 'module' && entry.generation === generation) {
        TextureLoader.resolutionCache.delete(key);
        if (entry.resolution.status === 'resolved') {
          const resref = entry.resolution.requestedResref;
          if (TextureLoader.textures.get(resref) === entry.resolution.texture) {
            TextureLoader.textures.delete(resref);
          }
          if (TextureLoader.lightmaps[resref] === entry.resolution.texture) {
            delete TextureLoader.lightmaps[resref];
          }
          if (TextureLoader.guiTextures.get(resref) === entry.resolution.texture) {
            TextureLoader.guiTextures.delete(resref);
          }
        }
      }
    }
    TextureLoader.activeModule = undefined;
    return result;
  }

  static getDiagnostics(): readonly TextureRoutingDiagnostic[] {
    return TextureLoader.routingDiagnostics.slice();
  }

  static getDiagnosticFallbackTexture(): OdysseyTexture {
    if (!TextureLoader.diagnosticFallbackTexture) {
      const pixels = new Uint8Array([
        255, 0, 255, 255, 32, 32, 32, 255,
        32, 32, 32, 255, 255, 0, 255, 255,
      ]);
      const fallback = new THREE.DataTexture(pixels, 2, 2, THREE.RGBAFormat) as unknown as OdysseyTexture;
      fallback.name = 'diagnostic-checker';
      fallback.txi = new TXI('');
      fallback.needsUpdate = true;
      TextureLoader.diagnosticFallbackTexture = fallback;
    }
    return TextureLoader.diagnosticFallbackTexture;
  }

  /**
   * Releases a GUI texture acquired by a short-lived UI consumer.
   *
   * Normal LoadGUI calls return a borrowed shared-cache texture.  Individual
   * effects and screens therefore must not dispose it, because another UI
   * consumer may still be using the same GPU resource.  A no-cache caller
   * receives an uncached texture and remains responsible for its disposal.
   */
  static releaseGUITexture(texture: OdysseyTexture | undefined): void {
    if (!texture || texture === TextureLoader.diagnosticFallbackTexture) {
      return;
    }
    for (const sharedTexture of TextureLoader.guiTextures.values()) {
      if (sharedTexture === texture) {
        return;
      }
    }
    texture.dispose();
  }

  /**
   * Disposes a texture created by a model while preserving resolver-owned
   * textures until their cache ownership releases them. Model materials borrow
   * TGA/TPC, GUI, lightmap, envmap, and bump textures from the loader; direct
   * material teardown must not poison those cache entries.
   */
  static disposeModelOwnedTexture(texture: THREE.Texture | null | undefined): boolean {
    if (!texture || texture === TextureLoader.diagnosticFallbackTexture) {
      return false;
    }
    if (TextureLoader.isResolverOwnedTexture(texture)) {
      return false;
    }
    texture.dispose();
    return true;
  }

  static resetRoutingForTests(): void {
    TextureLoader.sourceProvider = TextureLoader.createDefaultSourceProvider();
    TextureLoader.resolver = TextureLoader.createResolver(TextureLoader.sourceProvider);
    TextureLoader.lifetimeRegistry = new TextureLifetimeRegistry<OdysseyTexture>();
    TextureLoader.activeModule = undefined;
    TextureLoader.routingDiagnostics = [];
    TextureLoader.diagnosticFallbackTexture = undefined;
    TextureLoader.clearRoutingCaches();
  }

  static async LoadLocal(resRef: string, noCache: boolean = false): Promise<OdysseyTexture> {

    if (!isTextureResrefUsable(normalizeTextureResref(resRef))) {
      return undefined;
    }

    let dir = resRef;
    const tga_exists = await GameFileSystem.exists(path.join(dir, resRef));
    if(!tga_exists){ return undefined; }

    const tga = await TextureLoader.tgaLoader.fetchLocal(resRef);
    if(!tga){ return undefined; }

    tga.anisotropy = TextureLoader.Anisotropy;
    tga.wrapS = tga.wrapT = THREE.RepeatWrapping;

    if(!noCache)
      TextureLoader.textures.set(resRef, tga);

    return tga;
  }

  static async LoadLightmap(resRef: string, noCache: boolean = false){
    return TextureLoader.unwrap(await TextureLoader.Resolve({
      resref: resRef,
      semantic: 'lightmap',
      allowAlias: false,
    }, noCache));
  }

  static enQueue(
    name: string|string[],
    material: THREE.Material,
    type = TextureType.TEXTURE,
    onLoad?: Function,
    fallback?: string,
    semantic: TextureSemantic = type === TextureType.LIGHTMAP ? 'lightmap' : 'gui',
  ){
    if(typeof name == 'string' && name.length){
      name = name.toLowerCase();
      const obj = { name: name, material: material, type: type, fallback: fallback, semantic, onLoad: onLoad } as ITextureLoaderQueuedRef;
      const cached = TextureLoader.textures.get(name) ?? TextureLoader.guiTextures.get(name);
      if(cached){
        TextureLoader.UpdateMaterial(obj);
        if(typeof onLoad == 'function')
          onLoad(cached, obj);
      }else if(type === TextureType.TEXTURE && TextureLoader.pendingSubscribers.has(name)){
        TextureLoader.pendingSubscribers.get(name).push(obj);
      }else{
        if(type === TextureType.TEXTURE)
          TextureLoader.pendingSubscribers.set(name, [obj]);
        TextureLoader.queue.push(obj);
      }
    }else if(Array.isArray(name)){
      for(let i = 0, len = name.length; i < len; i++){
        const texName = name[i].toLowerCase();
        const obj = { name: texName, material: material, type: type, fallback: fallback, semantic, onLoad: onLoad } as ITextureLoaderQueuedRef;
        const cached = TextureLoader.textures.get(texName) ?? TextureLoader.guiTextures.get(texName);
        if(cached){
          TextureLoader.UpdateMaterial(obj);
          if(typeof onLoad == 'function')
            onLoad(cached, obj);
        }else if(type === TextureType.TEXTURE && TextureLoader.pendingSubscribers.has(texName)){
          TextureLoader.pendingSubscribers.get(texName).push(obj);
        }else{
          if(type === TextureType.TEXTURE)
            TextureLoader.pendingSubscribers.set(texName, [obj]);
          TextureLoader.queue.push(obj);
        }
      }
    }else{
      console.warn('unhandled enQueue', name);
      console.log('enQueue', name, material, type);
    }
  }

  static enQueueParticle(name: string, partGroup: any, onLoad?: Function){
    name = name.toLowerCase();
    TextureLoader.queue.push({ name: name, partGroup: partGroup, type: TextureType.PARTICLE, onLoad: onLoad });
  }

  static async LoadQueue(onProgress?: onProgressCallback){
    const queue = TextureLoader.queue.slice(0);
    const subscriberMap = TextureLoader.pendingSubscribers;
    TextureLoader.queue = [];
    TextureLoader.pendingSubscribers = new Map();

    const promises = queue.map(async (primaryTex) => {
      await TextureLoader.UpdateMaterial(primaryTex);
      const allSubs = subscriberMap.get(primaryTex.name);
      if(allSubs && allSubs.length > 1){
        await Promise.all(allSubs.slice(1).map(sub => TextureLoader.UpdateMaterial(sub)));
      }
    });
    await Promise.all(promises);
    for(let i = 0; i < queue.length; i++){
      if(typeof onProgress == 'function'){
        onProgress(queue[i], i, promises.length);
      }
    }
  }

  static async UpdateMaterial(tex: ITextureLoaderQueuedRef){
    switch(tex.type){
      case TextureType.TEXTURE: {
        const semantic = tex.semantic ?? 'gui';
        const request: TextureRequest = {
          resref: tex.name,
          semantic,
          allowAlias: semantic === 'gui' || semantic === 'font',
        };
        const primaryResolution = await TextureLoader.Resolve(request, TextureLoader.CACHE);
        let appliedTexture = TextureLoader.unwrap(primaryResolution);
        let fallbackName: string | undefined;

        if (!appliedTexture && tex.fallback) {
          const fallbackResolution = await TextureLoader.Resolve({
            ...request,
            resref: tex.fallback,
          }, TextureLoader.CACHE);
          appliedTexture = TextureLoader.unwrap(fallbackResolution);
          fallbackName = fallbackResolution.status === 'resolved'
            ? fallbackResolution.resolvedResref
            : undefined;
        }
        if (!appliedTexture && !isOptionalTextureSemantic(semantic)) {
          appliedTexture = TextureLoader.getDiagnosticFallbackTexture();
          fallbackName = appliedTexture.name;
        }

        if (tex.material instanceof THREE.Material) {
          OdysseyMaterialBuilder.resetMaterialTXIState(tex.material);
          if (appliedTexture) {
            TextureLoader.assignMaterialTexture(tex.material, appliedTexture, 'map');
            if (appliedTexture !== TextureLoader.diagnosticFallbackTexture) {
              await TextureLoader.ParseTXI(appliedTexture, tex);
              TextureLoader.applyHeaderMaterialProfile(appliedTexture, tex.material);
            }
          } else {
            TextureLoader.assignMaterialTexture(tex.material, null, 'map');
          }
        }
        if (fallbackName) {
          TextureLoader.recordDiagnostic(request, primaryResolution, fallbackName);
        }
        if (!appliedTexture && !TextureLoader.MISSING_REPORTED.has(tex.name)) {
          TextureLoader.MISSING_REPORTED.add(tex.name);
          console.warn(`TextureLoader: optional ${semantic} texture '${tex.name}' was disabled`);
        }
        if (typeof tex.onLoad === 'function') {
          tex.onLoad(appliedTexture, tex);
        }
        break;
      }
      case TextureType.LIGHTMAP:
        let lightmap: OdysseyTexture = await TextureLoader.LoadLightmap(tex.name, TextureLoader.CACHE);
        if(!!lightmap){
          if(tex.material instanceof THREE.RawShaderMaterial || tex.material instanceof THREE.ShaderMaterial){
            tex.material.uniforms.lightMap.value = lightmap;
            (tex.material as any).lightMap = lightmap;
            lightmap.updateMatrix();
            if(tex.material.uniforms.map.value){
              tex.material.uniforms.map.value.updateMatrix();
            }
            tex.material.defines.USE_LIGHTMAP = '';
            tex.material.defines.USE_ENVMAP = '';
            tex.material.defines.ENVMAP_TYPE_CUBE = '';
            delete tex.material.defines.IGNORE_LIGHTING;
            tex.material.defines.AURORA = "";
            tex.material.uniformsNeedUpdate = true;
          }else{
            (tex.material as any).lightMap = lightmap;
            (tex.material as any).defines = (tex.material as any).defines || {};
            if((tex.material as any).defines.hasOwnProperty('IGNORE_LIGHTING')){
              delete (tex.material as any).defines.IGNORE_LIGHTING;
            }
          }
          
          tex.material.needsUpdate = true;
        }else{
          if(tex.material instanceof THREE.RawShaderMaterial || tex.material instanceof THREE.ShaderMaterial){
            if (tex.material.uniforms.lightMap) {
              tex.material.uniforms.lightMap.value = null;
            }
            delete tex.material.defines.USE_LIGHTMAP;
            delete tex.material.defines.IGNORE_LIGHTING;
            tex.material.uniformsNeedUpdate = true;
          } else if (tex.material) {
            (tex.material as any).lightMap = null;
          }
        }

        if(typeof tex.onLoad == 'function')
          tex.onLoad(lightmap, tex)
      break;
      case TextureType.PARTICLE:
        let particle_texture = TextureLoader.unwrap(await TextureLoader.Resolve({
          resref: tex.name,
          semantic: 'particle',
          allowAlias: false,
        }, TextureLoader.CACHE));
        if(!!particle_texture){
          if(tex.partGroup?.type == 'OdysseyEmitter'){
            tex.partGroup.material.uniforms.map.value = particle_texture;
            (tex.partGroup.material as any).map = particle_texture;
            tex.partGroup.material.depthWrite = false;
            tex.partGroup.material.needsUpdate = true;
          }else{
            tex.partGroup.material.uniforms.texture.value = particle_texture;
            tex.partGroup.material.map = particle_texture;
            tex.partGroup.material.depthWrite = false;
            tex.partGroup.material.needsUpdate = true;
          }
        }

        if(typeof tex.onLoad == 'function')
          tex.onLoad(particle_texture, tex)
      break;
      default:
        console.warn('TextureLoader.UpdateMaterial: Unhandled Texture Type', tex);
      break;
    }
  }

  static ParseTXI(texture: OdysseyTexture, tex: ITextureLoaderQueuedRef){
    if(!texture.txi || !tex.material) return Promise.resolve();

    return OdysseyMaterialBuilder.applyTXIToMaterial(
      texture,
      tex.material,
      {
        resolveTexture: async (resRef: string, noCache?: boolean) => {
          const semantic: TextureSemantic = texture.txi?.envMapTexture === resRef
            ? 'environment'
            : texture.txi?.bumpMapTexture === resRef
              ? 'bump'
              : 'other';
          return TextureLoader.unwrap(await TextureLoader.Resolve({
            resref: resRef,
            semantic,
            allowAlias: false,
          }, !!noCache));
        },
      },
    ).catch((e) => {
      console.error("TextureLoader.parseTXI", e);
    });
  }

  private static createDefaultSourceProvider(): TextureSourceProvider<OdysseyTexture> {
    return new OdysseyTextureSourceProvider(TextureLoader.tgaLoader, TextureLoader.tpcLoader);
  }

  private static createResolver(provider: TextureSourceProvider<OdysseyTexture>): TextureResolver<OdysseyTexture> {
    return new TextureResolver(provider, {
      aliases: PRODUCTION_TEXTURE_ALIASES,
      cacheGeneration: () => TextureLoader.lifetimeRegistry?.currentGeneration ?? 1,
    });
  }

  private static unwrap(resolution: TextureResolution<OdysseyTexture>): OdysseyTexture | undefined {
    return resolution.status === 'resolved' ? resolution.texture : undefined;
  }

  private static prepareTexture(texture: OdysseyTexture): void {
    texture.anisotropy = TextureLoader.Anisotropy;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  }

  private static cacheResolution(
    cacheKey: string,
    request: TextureRequest,
    resolution: Extract<TextureResolution<OdysseyTexture>, { status: 'resolved' }>,
  ): void {
    const ownership = TextureLoader.getOwnership(request.semantic, resolution.source);
    const generation = TextureLoader.lifetimeRegistry.currentGeneration;
    TextureLoader.lifetimeRegistry.set(resolution.requestedResref, resolution.texture, ownership, generation);
    const entry = { resolution, ownership, generation };
    TextureLoader.resolutionCache.set(cacheKey, entry);
    if (ownership !== 'module') {
      const sharedCacheKey = TextureLoader.getCacheKey({
        ...request,
        activeModule: undefined,
      });
      TextureLoader.resolutionCache.set(sharedCacheKey, entry);
    }
    if (request.semantic === 'gui' || request.semantic === 'font') {
      TextureLoader.guiTextures.set(resolution.requestedResref, resolution.texture);
    } else if (request.semantic === 'lightmap') {
      TextureLoader.lightmaps[resolution.requestedResref] = resolution.texture;
    } else {
      TextureLoader.textures.set(resolution.requestedResref, resolution.texture);
    }
  }

  private static getOwnership(
    semantic: TextureSemantic,
    source: ResolvedTextureSource,
  ): TextureOwnership {
    if (source === 'active-module') {
      return 'module';
    }
    return semantic === 'gui' || semantic === 'font' ? 'shared-gui' : 'shared-global';
  }

  private static getCacheKey(request: TextureRequest): string {
    return [
      request.semantic,
      normalizeTextureResref(request.activeModule),
      request.allowAlias ? 'alias' : 'exact',
      normalizeTextureResref(request.resref),
    ].join(':');
  }

  private static isResolverOwnedTexture(texture: THREE.Texture): boolean {
    if (TextureLoader.lifetimeRegistry.hasTexture(texture as OdysseyTexture)) {
      return true;
    }
    for (const cached of TextureLoader.resolutionCache.values()) {
      if (cached.resolution.status === 'resolved' && cached.resolution.texture === texture) {
        return true;
      }
    }
    return (
      (TextureLoader.textures.has(texture.name)
        && TextureLoader.textures.get(texture.name) === texture)
      || (TextureLoader.guiTextures.has(texture.name)
        && TextureLoader.guiTextures.get(texture.name) === texture)
      || TextureLoader.lightmaps[texture.name] === texture
    );
  }

  private static recordDiagnostic(
    request: TextureRequest,
    resolution: TextureResolution<OdysseyTexture>,
    fallback?: string,
  ): void {
    const diagnostic: TextureRoutingDiagnostic = Object.freeze({
      requestedResref: resolution.requestedResref,
      ...(resolution.resolvedResref ? { resolvedResref: resolution.resolvedResref } : {}),
      semantic: request.semantic,
      ...(normalizeTextureResref(request.activeModule)
        ? { activeModule: normalizeTextureResref(request.activeModule) }
        : {}),
      status: resolution.status,
      searchedSources: Object.freeze([...(resolution.searchedSources ?? [])]),
      selectedSource: resolution.source,
      ...(resolution.txiSource ? { txiSource: resolution.txiSource } : {}),
      ...(fallback ? { fallback } : {}),
      ...(resolution.diagnostic?.code ? { diagnosticCode: resolution.diagnostic.code } : {}),
      cacheGeneration: resolution.cacheGeneration,
    });
    TextureLoader.routingDiagnostics.push(diagnostic);
    if (TextureLoader.routingDiagnostics.length > 10000) {
      TextureLoader.routingDiagnostics.shift();
    }
  }

  private static assignMaterialTexture(
    material: THREE.Material,
    texture: OdysseyTexture | null,
    slot: 'map' | 'lightMap',
  ): void {
    if (material instanceof THREE.RawShaderMaterial || material instanceof THREE.ShaderMaterial) {
      if (material.uniforms[slot]) {
        material.uniforms[slot].value = texture;
      }
      (material as any)[slot] = texture;
      material.uniformsNeedUpdate = true;
    } else {
      (material as any)[slot] = texture;
    }
    material.needsUpdate = true;
  }

  private static applyHeaderMaterialProfile(texture: OdysseyTexture, material: THREE.Material): void {
    if (typeof texture.header !== 'object' || texture.header.alphaTest === 1 || texture.txi.envMapTexture != null) {
      return;
    }
    if (texture.txi.blending !== TXIBlending.PUNCHTHROUGH) {
      material.transparent = true;
    }
    if (
      (texture.header.alphaTest && texture.header.format !== PixelFormat.DXT5) ||
      texture.txi.blending === TXIBlending.PUNCHTHROUGH
    ) {
      material.alphaTest = texture.header.alphaTest;
      if ((material as THREE.ShaderMaterial).uniforms?.alphaTest) {
        (material as THREE.ShaderMaterial).uniforms.alphaTest.value = texture.header.alphaTest;
      }
      material.transparent = false;
    }
  }

  private static clearRoutingCaches(): void {
    TextureLoader.resolutionCache.clear();
    TextureLoader.loadInflight.clear();
    TextureLoader.textures.clear();
    TextureLoader.guiTextures.clear();
    TextureLoader.lightmaps = {};
    TextureLoader.particles = {};
    TextureLoader.queue = [];
    TextureLoader.pendingSubscribers = new Map();
    TextureLoader.MISSING_REPORTED.clear();
  }


}

TGALoader.TextureLoader = TextureLoader;
