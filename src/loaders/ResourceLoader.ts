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
  private static OverrideResources: Map<number, Map<string, string>> = new Map();
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
  }

  static setOverrideResource(resId: number, resRef: string, filepath: string): void {
    if (!Number.isInteger(resId) || resId <= 0) {
      throw new TypeError(`Invalid override resource type: ${resId}`);
    }
    if (typeof resRef !== 'string' || !resRef.trim()) {
      throw new TypeError('Override resource resref must be a non-empty string');
    }
    if (typeof filepath !== 'string' || !filepath.trim()) {
      throw new TypeError('Override resource path must be a non-empty string');
    }
    const pathSegments = filepath.trim().replace(/\\/g, '/').split('/');
    if (
      pathSegments[0].toLocaleLowerCase() !== 'override' ||
      pathSegments.some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw new TypeError(`Override resource path must stay beneath Override: ${filepath}`);
    }

    let resourcesForType = ResourceLoader.OverrideResources.get(resId);
    if (!resourcesForType) {
      resourcesForType = new Map();
      ResourceLoader.OverrideResources.set(resId, resourcesForType);
    }
    resourcesForType.set(resRef.toLocaleLowerCase(), filepath);
  }

  static getOverrideResourcePath(resId: number, resRef: string): string | undefined {
    if (!Number.isInteger(resId) || resId <= 0 || typeof resRef !== 'string' || !resRef) {
      return undefined;
    }
    return ResourceLoader.OverrideResources.get(resId)?.get(resRef.toLocaleLowerCase());
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
      scope.get(key.resType).set(
        key.resRef.toLocaleLowerCase(),
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
          // console.log('InitModuleCache: RIM', resource.resRef.toLocaleLowerCase(), buffer);
          scope.get(resource.resType).set(
            resource.resRef.toLocaleLowerCase(),
            buffer
          );
        }
      }else if(archive instanceof ERFObject){
        const keyList = archive.keyList;
        for(let i = 0; i < keyList.length; i++){
          const key = keyList[i];
          const buffer = await archive.getResourceBufferByResRef(key.resRef, key.resType);
          // console.log('InitModuleCache: ERF', resource.resRef.toLocaleLowerCase(), buffer);
          scope.get(key.resType).set(
            key.resRef.toLocaleLowerCase(),
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

    if(!resRef){
      throw new Error(`Invalid resRef ${resRef}`);
    }

    resRef = resRef.toLocaleLowerCase();

    //Resource Cache
    let data = ResourceLoader.getCache(resId, resRef);
    if(data){
      return data;
    }

    data = await this.searchOverride(resId, resRef);
    if(data){
      ResourceLoader.setCache(CacheScope.OVERRIDE, resId, resRef, data);
      return data;
    }

    data = await this.searchKeyTable(resId, resRef);
    if(data){
      ResourceLoader.setCache(null, resId, resRef, data);
      return data;
    }

    data = await this.searchModuleArchives(resId, resRef);
    if(data){
      ResourceLoader.setCache(null, resId, resRef, data);
      return data;
    }

    //Resource Not Found
    if(!data){
      throw new Error(`Resource not found: ResRef: ${resRef} ResId: ${resId}`);
    }

  }

  static loadCachedResource(resId: number, resRef: string): Uint8Array {
    return ResourceLoader.getCache(resId, resRef.toLocaleLowerCase());
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

  static getCache(resId: number, resRef: string): Uint8Array {
    const normalizedRef = resRef.toLocaleLowerCase();
    if(ResourceLoader.CacheScopes[CacheScope.OVERRIDE].get(resId)?.has(normalizedRef)){
      return ResourceLoader.CacheScopes[CacheScope.OVERRIDE].get(resId).get(normalizedRef);
    }

    if(ResourceLoader.CacheScopes[CacheScope.MODULE].get(resId)?.has(normalizedRef)){
      return ResourceLoader.CacheScopes[CacheScope.MODULE].get(resId).get(normalizedRef);
    }

    if(ResourceLoader.CacheScopes[CacheScope.GLOBAL].get(resId)?.has(normalizedRef)){
      return ResourceLoader.CacheScopes[CacheScope.GLOBAL].get(resId).get(normalizedRef);
    }

    if(typeof ResourceLoader.cache[resId] !== 'undefined'){
      if(typeof ResourceLoader.cache[resId][normalizedRef] !== 'undefined'){
        return ResourceLoader.cache[resId][normalizedRef];
      }
    }
    return null;
  }

  static setCache(type: CacheScope, resId: number, resRef: string, buffer: Uint8Array){
    const cache = ResourceLoader.CacheScopes[type];
    if(cache){
      let resourcesForType = ResourceLoader.CacheScopes[type].get(resId);
      if (!resourcesForType) {
        resourcesForType = new Map();
        ResourceLoader.CacheScopes[type].set(resId, resourcesForType);
      }
      resourcesForType.set(resRef.toLocaleLowerCase(), buffer);
      return;
    }

    if(typeof ResourceLoader.cache[resId] === 'undefined')
      ResourceLoader.cache[resId] = {};

    ResourceLoader.cache[resId][resRef.toLocaleLowerCase()] = buffer;
  }

  static async searchLocal(resId: number, resRef = ''): Promise<Uint8Array> {
    let data = await this.searchOverride(resId, resRef);
    if(data){
      return data;
    }
  }

  /** Search for a loose resource recorded by the startup Override scan. */
  static async searchOverride(resId: number, resRef = ''): Promise<Uint8Array> {
    if (!resRef) {
      return undefined;
    }
    const normalizedRef = resRef.toLocaleLowerCase();
    const filepath = ResourceLoader.getOverrideResourcePath(resId, normalizedRef);
    if (!filepath) {
      return undefined;
    }
    try {
      const buffer = await GameFileSystem.readFile(filepath);
      if (!buffer || !buffer.length) {
        return undefined;
      }
      return buffer;
    } catch {
      return undefined;
    }
  }

  static async searchModuleArchives(resId: number, resRef = ''): Promise<Uint8Array> {
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

  static async searchKeyTable(resId: number, resRef: string): Promise<Uint8Array> {
    const keyLookup = KEYManager.Key.getFileKey(resRef, resId);
    if(keyLookup){
      return await KEYManager.Key.getFileBuffer(keyLookup);
    }
  }

  static async searchModules(resId: number, resRef: string): Promise<Uint8Array> {
    const rims = Array.from(RIMManager.RIMs.values());
    const rimCount = rims.length;

    for(let i = 0; i < rimCount; i++){
      const rim = rims[i];
      if(!rim || !rim.hasResource(resRef, resId)){ continue; }

      return await rim.getResourceBufferByResRef(resRef, resId);
    }
  }

}
