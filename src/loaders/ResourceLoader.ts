import { ResourceTypes } from "@/resource/ResourceTypes";
import { ERFObject } from "@/resource/ERFObject";
import { RIMObject } from "@/resource/RIMObject";
import { CacheScope } from "@/enums/resource/CacheScope";
import { IResourceCacheScopes } from "@/interface/resource/IResourceCacheScopes";
import { KEYManager } from "@/managers/KEYManager";
import { RIMManager } from "@/managers/RIMManager";
import { IRIMResource } from "@/interface/resource/IRIMResource";
import { IERFResource } from "@/interface/resource/IERFResource";
import { GameFileSystem } from "@/utility/GameFileSystem";
import { isTextureResrefUsable, normalizeTextureResref } from "@/loaders/TextureResolution";

export interface OverrideResourceEntry {
  readonly resourceType: number;
  readonly filepath: string;
  readonly layerId: string;
  readonly layerOrder: number;
}

export type OverrideTextureCandidate = OverrideResourceEntry;

/**
 * One Override layer chosen as a unit.
 *
 * Some resources are only meaningful in pairs. A model's `.mdx` holds raw
 * vertex data addressed by byte offsets the `.mdl` declares, so an `.mdl` from
 * one layer and an `.mdx` from another is not a degraded model — it is garbage
 * geometry, or a read past the end of the buffer. `.tga`/`.txi` has the same
 * shape with a weaker failure mode.
 *
 * Resolving each half independently would pick the highest layer offering that
 * half, which is how the halves come apart. A selection is always drawn from a
 * single layer.
 */
export interface OverrideLayerSelection {
  readonly primary: OverrideResourceEntry;
  readonly companions: ReadonlyMap<number, OverrideResourceEntry>;
}

/**
 * ResourceLoader class.
 *
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 *
 * @file ResourceLoader.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ResourceLoader {

  static Resources: any = {};
  static cache: any = {};
  static CacheScopes: IResourceCacheScopes = {
    override: new Map(),
    global:   new Map(),
    module:   new Map(),
    project:  new Map(),
  };
  /**
   * Every Override layer that offers a given resource, highest layer first —
   * not just the winning one. A lower layer is still needed later: when the
   * winning layer cannot supply a complete pair, resolution falls through to
   * the next layer down, and it can only do that if the entry survived
   * registration. See {@link OverrideLayerSelection}.
   */
  private static OverrideResources: Map<number, Map<string, OverrideResourceEntry[]>> = new Map();
  /** `${layerId}:${resref}` already warned about, so each is reported once. */
  private static IncompleteOverrideLayersReported = new Set<string>();
  static ModuleArchives: (RIMObject | ERFObject)[] = [];

  static InitCache(){
    const resourceTypes = Object.values(ResourceTypes).filter( t => typeof t === 'number' && t < 0xFFFF ) as number[];
    for(let i = 0; i < resourceTypes.length; i++){
      const restype = resourceTypes[i];
      ResourceLoader.CacheScopes[CacheScope.OVERRIDE].set(restype, new Map());
      ResourceLoader.CacheScopes[CacheScope.GLOBAL].set(restype, new Map());
      ResourceLoader.CacheScopes[CacheScope.MODULE].set(restype, new Map());
      ResourceLoader.CacheScopes[CacheScope.PROJECT].set(restype, new Map());
    }
  }

  static async InitOverrideCache(){
    ResourceLoader.ClearCache(CacheScope.OVERRIDE);
    ResourceLoader.OverrideResources.clear();
    ResourceLoader.IncompleteOverrideLayersReported.clear();
  }

  static setOverrideResource(
    resId: number,
    resRef: string,
    filepath: string,
    layerId: string = 'retail',
    layerOrder: number = 0,
  ): void {
    if (!Number.isInteger(resId) || resId <= 0) {
      throw new TypeError(`Invalid override resource type: ${resId}`);
    }
    if (typeof resRef !== 'string' || !resRef.trim()) {
      throw new TypeError('Override resource resref must be a non-empty string');
    }
    if (typeof filepath !== 'string' || !filepath.trim()) {
      throw new TypeError('Override resource path must be a non-empty string');
    }
    if (typeof layerId !== 'string' || !/^(?:retail|mod-[1-9]\d*)$/.test(layerId)) {
      throw new TypeError(`Invalid Override resource layer '${layerId}'`);
    }
    if (!Number.isSafeInteger(layerOrder) || layerOrder < 0) {
      throw new RangeError(`Invalid Override resource layer order '${layerOrder}'`);
    }
    const pathSegments = filepath.trim().replace(/\\/g, '/').split('/');
    if (
      pathSegments[0].toLowerCase() !== 'override' ||
      pathSegments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new TypeError(`Override resource path must stay beneath Override: ${filepath}`);
    }

    let resourcesForType = ResourceLoader.OverrideResources.get(resId);
    if (!resourcesForType) {
      resourcesForType = new Map();
      ResourceLoader.OverrideResources.set(resId, resourcesForType);
    }
    const normalizedRef = resRef.toLowerCase();
    const entry = Object.freeze({
      resourceType: resId,
      filepath,
      layerId,
      layerOrder,
    });
    const entries = resourcesForType.get(normalizedRef) ?? [];
    // A layer registering the same resref twice replaces its own entry; it
    // does not stack. Layers below are kept so a fall-through can reach them.
    const sameLayerIndex = entries.findIndex((candidate) => candidate.layerOrder === layerOrder);
    if (sameLayerIndex >= 0) {
      entries[sameLayerIndex] = entry;
    } else {
      entries.push(entry);
      entries.sort((left, right) => right.layerOrder - left.layerOrder);
    }
    resourcesForType.set(normalizedRef, entries);
  }

  static getOverrideResourcePath(resId: number, resRef: string): string | undefined {
    if (!Number.isInteger(resId) || resId <= 0 || typeof resRef !== 'string' || !resRef) {
      return undefined;
    }
    return ResourceLoader.getOverrideResourceEntry(resId, resRef)?.filepath;
  }

  /** The winning entry — the one from the highest layer that offers it. */
  static getOverrideResourceEntry(resId: number, resRef: string): OverrideResourceEntry | undefined {
    return ResourceLoader.getOverrideResourceEntries(resId, resRef)[0];
  }

  /** Every layer offering this resource, highest layer first. */
  static getOverrideResourceEntries(resId: number, resRef: string): readonly OverrideResourceEntry[] {
    if (!Number.isInteger(resId) || resId <= 0 || typeof resRef !== 'string' || !resRef) {
      return [];
    }
    return ResourceLoader.OverrideResources.get(resId)?.get(resRef.toLowerCase()) ?? [];
  }

  /**
   * Chooses the highest Override layer that can supply a complete resource,
   * falling through to the next layer down when one cannot.
   *
   * `primaryTypes` is a priority order: the first type present in a layer wins
   * *within* that layer, which is how `.tpc` beats `.tga` without letting a
   * `.tpc` in a low layer beat a `.tga` in a high one. A layer missing any
   * `requiredCompanionTypes` is skipped entirely rather than half-applied —
   * a partly-installed mod falls back to the layer below it, and ultimately to
   * retail, instead of producing a mismatched pair.
   */
  static selectOverrideLayer(
    resRef: string,
    primaryTypes: readonly number[],
    requiredCompanionTypes: readonly number[] = [],
    optionalCompanionTypes: readonly number[] = [],
  ): OverrideLayerSelection | undefined {
    const normalizedRef = normalizeTextureResref(resRef);
    if (!isTextureResrefUsable(normalizedRef) || !primaryTypes.length) {
      return undefined;
    }

    const layerOrders = new Set<number>();
    for (const resourceType of primaryTypes) {
      for (const entry of ResourceLoader.getOverrideResourceEntries(resourceType, normalizedRef)) {
        layerOrders.add(entry.layerOrder);
      }
    }

    for (const layerOrder of [...layerOrders].sort((left, right) => right - left)) {
      const primary = ResourceLoader.getOverrideLayerEntry(primaryTypes, normalizedRef, layerOrder);
      if (!primary) continue;

      const companions = new Map<number, OverrideResourceEntry>();
      const missing = requiredCompanionTypes.filter((resourceType) => {
        const companion = ResourceLoader.getOverrideLayerEntry([resourceType], normalizedRef, layerOrder);
        if (companion) companions.set(resourceType, companion);
        return !companion;
      });
      if (missing.length) {
        ResourceLoader.reportIncompleteOverrideLayer(primary, normalizedRef, missing);
        continue;
      }

      for (const resourceType of optionalCompanionTypes) {
        const companion = ResourceLoader.getOverrideLayerEntry([resourceType], normalizedRef, layerOrder);
        if (companion) companions.set(resourceType, companion);
      }
      return { primary, companions };
    }
    return undefined;
  }

  /** The first of `resourceTypes`, in priority order, present in exactly this layer. */
  private static getOverrideLayerEntry(
    resourceTypes: readonly number[],
    normalizedRef: string,
    layerOrder: number,
  ): OverrideResourceEntry | undefined {
    for (const resourceType of resourceTypes) {
      const entry = ResourceLoader.getOverrideResourceEntries(resourceType, normalizedRef)
        .find((candidate) => candidate.layerOrder === layerOrder);
      if (entry) return entry;
    }
    return undefined;
  }

  /**
   * Falling back to a lower layer is correct, but silent fallback reads to a
   * player as "my mod did not install". Name the layer and what it was missing.
   */
  private static reportIncompleteOverrideLayer(
    primary: OverrideResourceEntry,
    normalizedRef: string,
    missingTypes: readonly number[],
  ): void {
    const key = `${primary.layerId}:${normalizedRef}`;
    if (ResourceLoader.IncompleteOverrideLayersReported.has(key)) return;
    ResourceLoader.IncompleteOverrideLayersReported.add(key);
    const missing = missingTypes.map((resourceType) => ResourceTypes[resourceType] ?? resourceType).join(', ');
    console.warn(
      `Override layer '${primary.layerId}' supplies '${normalizedRef}' (${primary.filepath}) but not its ` +
      `required companion resource(s): ${missing}. Skipping that layer for this resource and falling ` +
      `through to the layer below — the layer's version of '${normalizedRef}' will not be used.`
    );
  }

  /** The texture pair: `.tpc` before `.tga` within a layer, with its `.txi` if the same layer has one. */
  static selectOverrideTexture(resRef: string): OverrideLayerSelection | undefined {
    return ResourceLoader.selectOverrideLayer(
      resRef,
      [ResourceTypes.tpc, ResourceTypes.tga],
      [],
      [ResourceTypes.txi],
    );
  }

  static getOverrideTextureCandidate(resRef: string): OverrideTextureCandidate | undefined {
    return ResourceLoader.selectOverrideTexture(resRef)?.primary;
  }

  /**
   * Loads both halves of a model from a single Override layer, or from a
   * single archive if no layer can supply both.
   *
   * `loadResource` cannot be used for this. It resolves one type at a time, so
   * asking it for `.mdl` and `.mdx` separately lets the two halves come from
   * different layers — or lets a layer's `.mdl` pair with the retail archive's
   * `.mdx` — which `OdysseyModel.FromBuffers` cannot detect and does not
   * survive. See {@link OverrideLayerSelection}.
   */
  static async loadModelPair(resRef: string): Promise<{ mdl: Uint8Array, mdx: Uint8Array }> {
    const normalizedRef = normalizeTextureResref(resRef);
    if (!isTextureResrefUsable(normalizedRef)) {
      throw new Error(`Invalid resRef ${resRef}`);
    }
    const resMDL = ResourceTypes['mdl'];
    const resMDX = ResourceTypes['mdx'];

    // Both halves, or neither. A lone cached half is exactly the mismatch this
    // method exists to prevent, so it is not enough to proceed on.
    const cachedMdl = ResourceLoader.getCache(resMDL, normalizedRef);
    const cachedMdx = ResourceLoader.getCache(resMDX, normalizedRef);
    if (cachedMdl && cachedMdx) {
      return { mdl: cachedMdl, mdx: cachedMdx };
    }

    const selection = ResourceLoader.selectOverrideLayer(normalizedRef, [resMDL], [resMDX]);
    if (selection) {
      const [mdl, mdx] = await Promise.all([
        ResourceLoader.searchOverrideEntry(selection.primary),
        ResourceLoader.searchOverrideEntry(selection.companions.get(resMDX)),
      ]);
      if (mdl && mdx) {
        ResourceLoader.setCache(CacheScope.OVERRIDE, resMDL, normalizedRef, mdl);
        ResourceLoader.setCache(CacheScope.OVERRIDE, resMDX, normalizedRef, mdx);
        return { mdl, mdx };
      }
      // A file that indexed but will not read is the same hazard as one that
      // was never there: take the whole layer out rather than half of it.
      ResourceLoader.reportIncompleteOverrideLayer(
        selection.primary, normalizedRef, mdl ? [resMDX] : [resMDL],
      );
    }

    const [mdl, mdx] = await Promise.all([
      ResourceLoader.loadArchivedResource(resMDL, normalizedRef),
      ResourceLoader.loadArchivedResource(resMDX, normalizedRef),
    ]);
    if (!mdl || !mdx) {
      throw new Error(`Resource not found: ResRef: ${normalizedRef} ResId: ${mdl ? resMDX : resMDL}`);
    }
    return { mdl, mdx };
  }

  static async InitGlobalCache(){
    ResourceLoader.ClearCache(CacheScope.GLOBAL);
    const cacheableTemplates = [
      ResourceTypes['ncs'], ResourceTypes['utc'], ResourceTypes['uti'],
      ResourceTypes['utd'], ResourceTypes['utp'], ResourceTypes['uts'],
      ResourceTypes['ute'], ResourceTypes['utt'], ResourceTypes['utw'],
      ResourceTypes['utm'], ResourceTypes['dlg'], ResourceTypes['ssf'],
    ];

    console.log('Caching Types:', cacheableTemplates);

    const scope = ResourceLoader.CacheScopes[CacheScope.GLOBAL];
    const keys = KEYManager.Key.keys.filter( k => cacheableTemplates.includes(k.resType) );
    await Promise.all(keys.map(async (key) => {
      const buffer = await KEYManager.Key.getFileBuffer(key);
      // `InitCache` seeds a map per known resource type; a type it never saw
      // would make this a throw on undefined rather than a miss.
      ResourceLoader.cacheScopeFor(CacheScope.GLOBAL, key.resType).set(
        key.resRef.toLowerCase(),
        buffer
      );
    }));
  }

  static async InitModuleCache(archives: (RIMObject|ERFObject)[]){
    ResourceLoader.ClearCache(CacheScope.MODULE);
    this.ModuleArchives = archives;

    let start = Date.now();
    console.log(`InitModuleCache: Start`);

    const scope = ResourceLoader.CacheScopes[CacheScope.MODULE];
    await Promise.all(archives.map(async (archive) => {
      if(archive instanceof RIMObject){
        const resources = archive.resources;
        for(let i = 0; i < resources.length; i++){
          const resource = resources[i];
          const buffer = await archive.getResourceBuffer(resource);
          ResourceLoader.cacheScopeFor(CacheScope.MODULE, resource.resType).set(
            resource.resRef.toLowerCase(),
            buffer
          );
        }
      }else if(archive instanceof ERFObject){
        const keyList = archive.keyList;
        for(let i = 0; i < keyList.length; i++){
          const key = keyList[i];
          const buffer = await archive.getResourceBufferByResRef(key.resRef, key.resType);
          ResourceLoader.cacheScopeFor(CacheScope.MODULE, key.resType).set(
            key.resRef.toLowerCase(),
            buffer
          );
        }
      }
    }));

    let end = Date.now();
    console.log(`InitModuleCache: End - ${((end-start)/1000)}s`);

  }

  static ClearCache(scope: CacheScope){
    if(!!ResourceLoader.CacheScopes[scope])
      ResourceLoader.CacheScopes[scope].forEach( cacheType => {
        cacheType.clear();
      });
  }

  static async loadResource(resId: number, resRef: string): Promise<Uint8Array> {

    if(!resId){
      throw new Error(`Invalid resId ${resId}`);
    }

    if(!isTextureResrefUsable(normalizeTextureResref(resRef))){
      throw new Error(`Invalid resRef ${resRef}`);
    }

    resRef = normalizeTextureResref(resRef);

    //Resource Cache
    let data: Uint8Array | null | undefined = ResourceLoader.getCache(resId, resRef);
    if(data){
      return data;
    }

    data = await this.searchOverride(resId, resRef);
    if(data){
      ResourceLoader.setCache(CacheScope.OVERRIDE, resId, resRef, data);
      return data;
    }

    data = await this.loadArchivedResource(resId, resRef);
    if(data){
      return data;
    }

    //Resource Not Found
    throw new Error(`Resource not found: ResRef: ${resRef} ResId: ${resId}`);
  }

  /**
   * The per-type map for a cache scope, created on demand.
   *
   * `InitCache` seeds one map per resource type it knows about. Anything it
   * missed used to surface as a throw on `undefined.set(...)` from whichever
   * loader happened to touch it first.
   */
  private static cacheScopeFor(scope: CacheScope, resId: number): Map<string, Uint8Array> {
    const cache = ResourceLoader.CacheScopes[scope];
    let resourcesForType = cache.get(resId);
    if(!resourcesForType){
      resourcesForType = new Map();
      cache.set(resId, resourcesForType);
    }
    return resourcesForType;
  }

  /**
   * Everything `loadResource` does after the Override index, as its own step.
   *
   * `loadModelPair` needs this reachable on its own: when no Override layer can
   * supply a complete model pair, both halves must come from the archives, and
   * consulting Override again for either one would reintroduce the mismatch.
   */
  static async loadArchivedResource(resId: number, resRef: string): Promise<Uint8Array | undefined> {
    let data = await this.searchKeyTable(resId, resRef);
    if(data){
      ResourceLoader.setCache(null, resId, resRef, data);
      return data;
    }

    data = await this.searchModuleArchives(resId, resRef);
    if(data){
      ResourceLoader.setCache(null, resId, resRef, data);
      return data;
    }

    return undefined;
  }

  static loadCachedResource(resId: number, resRef: string): Uint8Array | null {
    // `getCache` lowercases too, so this delegates rather than repeating it —
    // and, importantly, inherits its tolerance of an absent resref.
    return ResourceLoader.getCache(resId, resRef);
  }

  static setResource(resId: number, resRef: string, opts = {}){
    resRef = resRef.toLowerCase();

    if(typeof ResourceLoader.Resources[resId] === 'undefined'){
      ResourceLoader.Resources[resId] = {};
    }
    ResourceLoader.Resources[resId][resRef] = opts;
  }

  static getResource(resId: number, resRef: string){
    if(typeof ResourceLoader.Resources[resId] !== 'undefined'){
      if(typeof ResourceLoader.Resources[resId][resRef] !== 'undefined'){
        return ResourceLoader.Resources[resId][resRef];
      }
    }
    return null;
  }

  static clearCache(){
    ResourceLoader.cache = {};
  }

  static getCache(resId: number, resRef: string): Uint8Array | null {
    // An absent resref is an ordinary "nothing to load", not an error: most
    // callers pass `getTemplateResRef()` or a 2DA cell, and an object with no
    // template legitimately has none. This threw
    // `Cannot read properties of null (reading 'toLowerCase')` out of
    // `loadCachedResource` during module load instead, which the sweep caught
    // on 202TEL. A miss already returns null; so does this.
    if (typeof resRef !== 'string' || !resRef) {
      return null;
    }
    const normalizedRef = resRef.toLowerCase();
    // Looked up once per scope rather than twice: the second `.get(resId)` was
    // a separate lookup that the `.has()` above did not actually prove.
    for(const scope of [CacheScope.OVERRIDE, CacheScope.MODULE, CacheScope.GLOBAL]){
      const cached = ResourceLoader.CacheScopes[scope].get(resId)?.get(normalizedRef);
      if(cached) return cached;
    }

    if(typeof ResourceLoader.cache[resId] !== 'undefined'){
      if(typeof ResourceLoader.cache[resId][normalizedRef] !== 'undefined'){
        return ResourceLoader.cache[resId][normalizedRef];
      }
    }
    return null;
  }

  static setCache(type: CacheScope | null, resId: number, resRef: string, buffer: Uint8Array){
    // A null scope means the loose, unscoped cache below — the archive paths
    // pass it deliberately so those buffers are not cleared with a module.
    const cache = type === null ? undefined : ResourceLoader.CacheScopes[type];
    if(cache){
      let resourcesForType = cache.get(resId);
      if (!resourcesForType) {
        resourcesForType = new Map();
        cache.set(resId, resourcesForType);
      }
      resourcesForType.set(resRef.toLowerCase(), buffer);
      return;
    }

    if(typeof ResourceLoader.cache[resId] === 'undefined')
      ResourceLoader.cache[resId] = {};

    ResourceLoader.cache[resId][resRef.toLowerCase()] = buffer;
  }

  static async searchLocal(resId: number, resRef = ''): Promise<Uint8Array | undefined> {
    let data = await this.searchOverride(resId, resRef);
    if(data){
      return data;
    }
  }

  /** Search for a loose resource recorded by the startup Override scan. */
  static async searchOverride(resId: number, resRef = ''): Promise<Uint8Array | undefined> {
    if (!resRef) {
      return undefined;
    }
    const normalizedRef = resRef.toLowerCase();
    const entry = ResourceLoader.getOverrideResourceEntry(resId, normalizedRef);
    if (!entry) {
      return undefined;
    }
    return ResourceLoader.searchOverrideEntry(entry);
  }

  static async searchOverrideEntry(entry: OverrideResourceEntry | undefined): Promise<Uint8Array | undefined> {
    if (!entry) {
      return undefined;
    }
    try {
      const buffer = await GameFileSystem.readFile(entry.filepath);
      if (!buffer || !buffer.length) {
        return undefined;
      }
      return buffer;
    } catch {
      return undefined;
    }
  }

  static async searchModuleArchives(resId: number, resRef = ''): Promise<Uint8Array | undefined> {
    const archiveCount = this.ModuleArchives.length;

    for(let i = 0; i < archiveCount; i++){
      const archive = this.ModuleArchives[i];
      if(archive instanceof RIMObject){
        if(!archive.hasResource(resRef, resId)){ continue; }
        const data = await archive.getResourceBufferByResRef(resRef, resId);
        if(data){
          return data;
        }
      }else if(archive instanceof ERFObject){
        if(!archive.hasResource(resRef, resId)){ continue; }
        const data = await archive.getResourceBufferByResRef(resRef, resId);
        if(data){
          return data;
        }
      }
    }

    return undefined;
  }

  static async searchKeyTable(resId: number, resRef: string): Promise<Uint8Array | undefined> {
    const keyLookup = KEYManager.Key.getFileKey(resRef, resId);
    if(keyLookup){
      return await KEYManager.Key.getFileBuffer(keyLookup);
    }
  }

  static async searchModules(resId: number, resRef: string): Promise<Uint8Array | undefined> {
    const rims = Array.from(RIMManager.RIMs.values());
    const rimCount = rims.length;

    for(let i = 0; i < rimCount; i++){
      const rim = rims[i];
      if(!rim || !rim.hasResource(resRef, resId)){ continue; }

      return await rim.getResourceBufferByResRef(resRef, resId);
    }
  }

}
