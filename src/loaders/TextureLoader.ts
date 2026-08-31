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
import { readLaunchOption } from "@/utility/RendererOptions";
import { ResourceTypes } from "@/resource/ResourceTypes";
import { TXI } from "@/resource/TXI";
import {
  ExplicitTextureAlias,
  ResolvedTextureSource,
  TextureLifetimeRegistry,
  TextureOwnership,
  TextureRequest,
  TextureResolution,
  TextureRequestOwner,
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
  readonly ownerModelName?: string;
  readonly ownerObjectTag?: string;
  readonly ownerObjectType?: number;
  readonly status: TextureResolution<OdysseyTexture>['status'];
  readonly searchedSources: readonly ResolvedTextureSource[];
  readonly selectedSource: TextureResolution<OdysseyTexture>['source'];
  readonly txiSource?: TextureResolution<OdysseyTexture>['txiSource'];
  readonly sourceLayerId?: TextureResolution<OdysseyTexture>['sourceLayerId'];
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
          // The selection names the winning layer; a `.tga` that lost to a
          // `.tpc` in that layer, or to a higher layer, is not this source.
          const selection = ResourceLoader.selectOverrideTexture(resref);
          if (!selection || selection.primary.resourceType !== ResourceTypes.tga) {
            return undefined;
          }
          const tgaBuffer = await ResourceLoader.searchOverrideEntry(selection.primary);
          if (!tgaBuffer?.length) {
            return undefined;
          }
          return this.loadTga(
            tgaBuffer,
            resref,
            // Only the same layer's TXI: a lower layer's TXI describes a
            // texture this one has replaced.
            await ResourceLoader.searchOverrideEntry(selection.companions.get(ResourceTypes.txi)),
            'override-txi',
            selection.primary.layerId,
          );
        }
      case 'override-tpc': {
        const selection = ResourceLoader.selectOverrideTexture(resref);
        if (!selection || selection.primary.resourceType !== ResourceTypes.tpc) {
          return undefined;
        }
        return this.loadTpc(
          await ResourceLoader.searchOverrideEntry(selection.primary),
          resref,
          undefined,
          selection.primary.layerId,
        );
      }
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
    sourceLayerId?: string,
  ): TextureSourceArtifact<OdysseyTexture> | undefined {
    if (!buffer?.length) {
      return undefined;
    }
    return {
      texture: this.tgaLoader.decode(buffer, resref, txiBuffer),
      ...(txiBuffer?.length ? { txiSource } : {}),
      ...(sourceLayerId ? { sourceLayerId } : {}),
    };
  }

  private loadTpc(
    buffer: Uint8Array | undefined,
    resref: string,
    pack: number | undefined,
    sourceLayerId?: string,
  ): TextureSourceArtifact<OdysseyTexture> | undefined {
    if (!buffer?.length) {
      return undefined;
    }
    return {
      texture: this.tpcLoader.decode(buffer, resref, pack),
      txiSource: 'embedded-tpc',
      ...(sourceLayerId ? { sourceLayerId } : {}),
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
    /**
     * A cache entry resolved while a module is active cannot survive that
     * module's lifetime, even when its winning texture is shared.  The module
     * can shadow the same resref on a later visit.
     */
    activeModule?: string;
    semantic: TextureSemantic;
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

  static async Load(resRef: string, noCache: boolean = false): Promise<OdysseyTexture | undefined> {
    return TextureLoader.unwrap(await TextureLoader.Resolve({
      resref: resRef,
      semantic: 'diffuse',
      allowAlias: false,
    }, noCache));
  }

  static async LoadGUI(resRef: string, noCache: boolean = false): Promise<OdysseyTexture | undefined> {
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
      const validatedResolution = validateTextureResolution(result);
      const resolution = noCache
        ? validatedResolution
        : TextureLoader.retainSharedResolution(normalizedRequest, validatedResolution);
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
    const closingModule = TextureLoader.activeModule;
    const generation = TextureLoader.lifetimeRegistry.currentGeneration;
    const result = TextureLoader.lifetimeRegistry.disposeModuleGeneration(generation);
    for (const [key, entry] of TextureLoader.resolutionCache) {
      const ownedByClosingGeneration = entry.ownership === 'module' && entry.generation === generation;
      const scopedToClosingModule = entry.activeModule === closingModule;
      if (ownedByClosingGeneration || scopedToClosingModule) {
        TextureLoader.resolutionCache.delete(key);
        if (ownedByClosingGeneration && entry.resolution.status === 'resolved') {
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
          TextureLoader.restoreSharedLegacyCache(resref, entry.semantic);
        }
      }
    }
    TextureLoader.activeModule = undefined;
    return result;
  }

  static getDiagnostics(): readonly TextureRoutingDiagnostic[] {
    return TextureLoader.routingDiagnostics.slice();
  }

  /**
   * Whether an unresolvable required texture is drawn as the magenta checker.
   *
   * Off by default, because some textures are simply not in the install and no
   * code change can conjure them. The chargen feats screen asked for
   * `lbl_indent` (68 times) and `lbl_skarr` (40) — K1 resrefs hard-coded in
   * `GUIFeatItem`, absent from every source in a TSL install — and every feat
   * row therefore rendered as a magenta/dark checker. Retail simply draws
   * nothing for a fill it cannot find, and with this off the material is left
   * unmapped, which is the same result.
   *
   * The checker is genuinely useful while hunting a routing bug, so it stays
   * available: `?texdiag=1` on the launch URL, or
   * `localStorage.setItem('kotor2vr.texdiag', '1')` for Electron.
   *
   * This changes only what is *drawn*. The routing diagnostics still record the
   * miss, so `vr:check`'s `texture-resolution-baseline` — which counts distinct
   * failures from the router rather than from pixels — is unaffected.
   */
  static DIAGNOSTIC_FALLBACK_ENABLED = readLaunchOption(
    typeof window !== 'undefined' ? window.location.search : '', 'texdiag',
  ) === '1';

  /**
   * Makes a material that has no texture stop drawing.
   *
   * Handles both material families the GUI uses: the Odyssey shader materials
   * carry an `opacity` uniform, while plain three materials use the property.
   */
  static hideUnresolvedFill(material: THREE.Material): void {
    const shader = material as THREE.ShaderMaterial;
    if (shader.uniforms?.opacity) {
      shader.uniforms.opacity.value = 0;
    }
    (material as any).opacity = 0;
    material.transparent = true;
    material.needsUpdate = true;
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
    if (TextureLoader.isResolverOwnedTexture(texture)) {
      return;
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

  static async LoadLocal(resRef: string, noCache: boolean = false): Promise<OdysseyTexture | undefined> {

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
      TextureLoader.enqueueTypedTextureRequest(name, material, type, onLoad, fallback, semantic);
    }else if(Array.isArray(name)){
      for(let i = 0, len = name.length; i < len; i++){
        TextureLoader.enqueueTypedTextureRequest(name[i], material, type, onLoad, fallback, semantic);
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
      const allSubs = subscriberMap.get(TextureLoader.getQueuedRequestKey(primaryTex));
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
        const owner = TextureLoader.getMaterialOwner(tex.material);
        const request: TextureRequest = {
          resref: tex.name,
          semantic,
          allowAlias: semantic === 'gui' || semantic === 'font',
          ...(tex.activeModule ? { activeModule: tex.activeModule } : {}),
          ...(owner ? { owner } : {}),
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
        if (!appliedTexture && !isOptionalTextureSemantic(semantic)
            && TextureLoader.DIAGNOSTIC_FALLBACK_ENABLED) {
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
            // A material with no map still draws — as opaque white — so simply
            // clearing the map turned the magenta checkers into white blocks.
            // A fill whose texture cannot be found is not meant to be drawn at
            // all; retail renders nothing.
            TextureLoader.hideUnresolvedFill(tex.material);
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
        let lightmap = TextureLoader.unwrap(await TextureLoader.Resolve({
          resref: tex.name,
          semantic: 'lightmap',
          allowAlias: false,
          ...(tex.activeModule ? { activeModule: tex.activeModule } : {}),
        }, TextureLoader.CACHE));
        // Bound once: `tex.material` is optional, and re-reading it after
        // the await above defeats narrowing on every line below.
        const lightmapMaterial = tex.material;
        if(!lightmapMaterial) break;
        if(!!lightmap){
          if(lightmapMaterial instanceof THREE.RawShaderMaterial || lightmapMaterial instanceof THREE.ShaderMaterial){
            lightmapMaterial.uniforms.lightMap.value = lightmap;
            (lightmapMaterial as any).lightMap = lightmap;
            lightmap.updateMatrix();
            if(lightmapMaterial.uniforms.map.value){
              lightmapMaterial.uniforms.map.value.updateMatrix();
            }
            lightmapMaterial.defines.USE_LIGHTMAP = '';
            lightmapMaterial.defines.USE_ENVMAP = '';
            lightmapMaterial.defines.ENVMAP_TYPE_CUBE = '';
            delete lightmapMaterial.defines.IGNORE_LIGHTING;
            lightmapMaterial.defines.AURORA = "";
            lightmapMaterial.uniformsNeedUpdate = true;
          }else{
            (lightmapMaterial as any).lightMap = lightmap;
            (lightmapMaterial as any).defines = (lightmapMaterial as any).defines || {};
            if((lightmapMaterial as any).defines.hasOwnProperty('IGNORE_LIGHTING')){
              delete (lightmapMaterial as any).defines.IGNORE_LIGHTING;
            }
          }

          lightmapMaterial.needsUpdate = true;
        }else{
          if(lightmapMaterial instanceof THREE.RawShaderMaterial || lightmapMaterial instanceof THREE.ShaderMaterial){
            if (lightmapMaterial.uniforms.lightMap) {
              lightmapMaterial.uniforms.lightMap.value = null;
            }
            delete lightmapMaterial.defines.USE_LIGHTMAP;
            delete lightmapMaterial.defines.IGNORE_LIGHTING;
            lightmapMaterial.uniformsNeedUpdate = true;
          } else {
            (lightmapMaterial as any).lightMap = null;
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
            ...(tex.activeModule ? { activeModule: tex.activeModule } : {}),
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
    const activeModule = normalizeTextureResref(request.activeModule) || undefined;
    const entry = { resolution, ownership, generation, activeModule, semantic: request.semantic };
    TextureLoader.resolutionCache.set(cacheKey, entry);
    if (ownership !== 'module') {
      const sharedCacheKey = TextureLoader.getCacheKey({
        ...request,
        activeModule: undefined,
      });
      TextureLoader.resolutionCache.set(sharedCacheKey, {
        ...entry,
        activeModule: undefined,
      });
    }
    if (request.semantic === 'gui' || request.semantic === 'font') {
      TextureLoader.guiTextures.set(resolution.requestedResref, resolution.texture);
    } else if (request.semantic === 'lightmap') {
      TextureLoader.lightmaps[resolution.requestedResref] = resolution.texture;
    } else {
      TextureLoader.textures.set(resolution.requestedResref, resolution.texture);
    }
  }

  /**
   * Reuses an already-live compatible shared source after every
   * module-specific lookup. Resolution-cache entries are semantic-scoped,
   * while shared lifetime ownership is resource-scoped; a diffuse and a
   * lightmap request for the same shared asset must therefore borrow the same
   * texture instead of replacing (and disposing) a material-bound texture.
   *
   * The lookup still runs, so an active module can shadow the asset. Only an
   * unscoped cached result with the same ownership, source provenance, and
   * resolved/requested resrefs is compatible with the candidate.
   */
  private static retainSharedResolution(
    request: TextureRequest,
    resolution: TextureResolution<OdysseyTexture>,
  ): TextureResolution<OdysseyTexture> {
    if (resolution.status !== 'resolved') {
      return resolution;
    }
    const ownership = TextureLoader.getOwnership(request.semantic, resolution.source);
    if (ownership === 'module') {
      return resolution;
    }
    const existing = [...TextureLoader.resolutionCache.values()].find((entry) => (
      entry.ownership === ownership
      && entry.activeModule === undefined
      && entry.resolution.status === 'resolved'
      && entry.resolution.source === resolution.source
      && entry.resolution.requestedResref === resolution.requestedResref
      && entry.resolution.resolvedResref === resolution.resolvedResref
    ));
    if (
      !existing
      || existing.resolution.status !== 'resolved'
    ) {
      return resolution;
    }
    if (resolution.texture !== existing.resolution.texture) {
      resolution.texture.dispose();
    }
    return {
      ...resolution,
      texture: existing.resolution.texture,
    };
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

  private static enqueueTypedTextureRequest(
    name: unknown,
    material: THREE.Material,
    type: TextureType,
    onLoad: Function | undefined,
    fallback: string | undefined,
    semantic: TextureSemantic,
  ): void {
    const normalizedName = normalizeTextureResref(name);
    if (!isTextureResrefUsable(normalizedName)) {
      console.warn('TextureLoader.enQueue rejected invalid texture resref', name);
      return;
    }
    const request: ITextureLoaderQueuedRef = {
      name: normalizedName,
      material,
      type,
      fallback,
      semantic,
      ...(TextureLoader.activeModule ? { activeModule: TextureLoader.activeModule } : {}),
      onLoad,
    };
    const requestKey = TextureLoader.getQueuedRequestKey(request);
    const subscribers = TextureLoader.pendingSubscribers.get(requestKey);
    if (subscribers) {
      subscribers.push(request);
      return;
    }
    TextureLoader.pendingSubscribers.set(requestKey, [request]);
    TextureLoader.queue.push(request);
  }

  private static getQueuedRequestKey(request: ITextureLoaderQueuedRef): string {
    return [
      request.type,
      request.semantic ?? (request.type === TextureType.LIGHTMAP ? 'lightmap' : 'gui'),
      normalizeTextureResref(request.activeModule),
      normalizeTextureResref(request.name),
      normalizeTextureResref(request.fallback),
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

  /** Restores a shared legacy cache entry after a module-local texture stopped shadowing it. */
  private static restoreSharedLegacyCache(resref: string, semantic: TextureSemantic): void {
    const normalizedResref = normalizeTextureResref(resref);
    if (!isTextureResrefUsable(normalizedResref)) {
      return;
    }
    const sharedEntry = [...TextureLoader.resolutionCache.values()].find((entry) => (
      entry.ownership !== 'module'
      && entry.activeModule === undefined
      && entry.semantic === semantic
      && entry.resolution.status === 'resolved'
      && entry.resolution.requestedResref === normalizedResref
    ));
    if (!sharedEntry || sharedEntry.resolution.status !== 'resolved') {
      return;
    }
    const { texture } = sharedEntry.resolution;
    if (semantic === 'gui' || semantic === 'font') {
      TextureLoader.guiTextures.set(normalizedResref, texture);
    } else if (semantic === 'lightmap') {
      TextureLoader.lightmaps[normalizedResref] = texture;
    } else {
      TextureLoader.textures.set(normalizedResref, texture);
    }
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
      ...(request.owner?.modelName ? { ownerModelName: request.owner.modelName } : {}),
      ...(request.owner?.objectTag ? { ownerObjectTag: request.owner.objectTag } : {}),
      ...(Number.isSafeInteger(request.owner?.objectType)
        ? { ownerObjectType: request.owner?.objectType }
        : {}),
      status: resolution.status,
      searchedSources: Object.freeze([...(resolution.searchedSources ?? [])]),
      selectedSource: resolution.source,
      ...(resolution.txiSource ? { txiSource: resolution.txiSource } : {}),
      ...(resolution.sourceLayerId ? { sourceLayerId: resolution.sourceLayerId } : {}),
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

  private static getMaterialOwner(material: THREE.Material | undefined): TextureRequestOwner | undefined {
    const ownerModel = material?.userData?.textureOwnerModel as {
      name?: unknown;
      userData?: { moduleObject?: unknown };
    } | undefined;
    if (!ownerModel) {
      return undefined;
    }

    const modelName = normalizeTextureResref(ownerModel.name);
    const moduleObject = ownerModel.userData?.moduleObject as {
      getTag?: () => unknown;
      objectType?: unknown;
    } | undefined;
    let tagValue: unknown;
    try {
      tagValue = moduleObject?.getTag?.();
    } catch {
      tagValue = undefined;
    }
    const objectTag = typeof tagValue === 'string' ? tagValue.trim() : '';
    const objectType = moduleObject?.objectType;
    const owner: TextureRequestOwner = {
      ...(modelName ? { modelName } : {}),
      ...(objectTag ? { objectTag } : {}),
      ...(typeof objectType === 'number' && Number.isSafeInteger(objectType)
        ? { objectType }
        : {}),
    };
    return Object.keys(owner).length ? owner : undefined;
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
