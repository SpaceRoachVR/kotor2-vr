import { ApplicationEnvironment } from "@/enums/ApplicationEnvironment";
import { ApplicationMode } from "@/enums/ApplicationMode";
import { GameEngineType } from "@/enums/engine";
import { OSInfo } from "@/utility/OSInfo";

export interface HttpAssetUrlParseResult {
  assetBaseUrl: string;
  diagnostic?: string;
}

/**
 * Accept only the authenticated asset mount served by this page's origin.
 * The launch endpoint establishes an HttpOnly cookie, so a cross-origin URL
 * could never authenticate and must not put the game into HTTP mode.
 */
export function parseHttpAssetBaseUrl(search: string, pageOrigin: string): HttpAssetUrlParseResult {
  const rawValue = new URLSearchParams(search).get('assets');
  if (!rawValue) return { assetBaseUrl: '' };

  try {
    const pageUrl = new URL(pageOrigin);
    const assetUrl = new URL(rawValue, pageUrl);
    if (assetUrl.origin !== pageUrl.origin) {
      return { assetBaseUrl: '', diagnostic: 'assets URL must use the current page origin' };
    }
    if (assetUrl.pathname.replace(/\/+$/, '') !== '/assets' || assetUrl.search || assetUrl.hash) {
      return { assetBaseUrl: '', diagnostic: 'assets URL must be the same-origin /assets mount without query or fragment' };
    }
    return { assetBaseUrl: `${pageUrl.origin}/assets` };
  } catch {
    return { assetBaseUrl: '', diagnostic: 'assets URL is invalid' };
  }
}

/**
 * ApplicationProfile class.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ApplicationProfile.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */
export class ApplicationProfile {

  static MODE: ApplicationMode = ApplicationMode.GAME;
  static ENV: ApplicationEnvironment = ApplicationEnvironment.BROWSER;
  static directory: string;
  static directoryHandle: FileSystemDirectoryHandle;
  static key: string;
  static launch: any;
  static path_sep: string = '/';
  static GameKey: GameEngineType = GameEngineType.KOTOR;
  static profile: any = {};
  static isMac: boolean = false;

  /**
   * Base URL for game assets served over HTTP, or empty for none.
   *
   * Set from the `?assets=` query parameter. When present, GameFileSystem routes
   * through HTTP instead of the File System Access API. This exists because the
   * VR build must run in a browser -- Electron cannot open an immersive WebXR
   * session -- and File System Access is slow here and fails on large reads.
   */
  static assetBaseUrl: string = '';

  static get usesHttpAssets(): boolean {
    return !!ApplicationProfile.assetBaseUrl;
  }

  static SetProfile(profile: any){
    if(typeof profile === 'object'){
      ApplicationProfile.profile = profile;
      ApplicationProfile.InitEnvironment();
    }
    if(ApplicationProfile.profile){
      if(ApplicationProfile.ENV == ApplicationEnvironment.ELECTRON){
        ApplicationProfile.directory = ApplicationProfile.profile.directory;
      }else{
        ApplicationProfile.directoryHandle = ApplicationProfile.profile.directory_handle;
      }
    }
  }

  static InitEnvironment(){
    try{
      const parsed = parseHttpAssetBaseUrl(window.location.search, window.location.origin);
      ApplicationProfile.assetBaseUrl = parsed.assetBaseUrl;
      if(parsed.assetBaseUrl) console.log(`ApplicationProfile: serving game assets over HTTP from '${parsed.assetBaseUrl}'`);
      else if(parsed.diagnostic) console.warn(`ApplicationProfile: HTTP assets disabled: ${parsed.diagnostic}`);
    }catch(e){
      ApplicationProfile.assetBaseUrl = '';
      console.warn('ApplicationProfile: failed to read the assets query parameter', e);
    }

    if(window.location.origin === 'file://'){
      ApplicationProfile.ENV = ApplicationEnvironment.ELECTRON;
      if(typeof window.electron !== 'undefined'){
        ApplicationProfile.isMac = window.electron.isMac();
      }
      if(OSInfo.isWindows()){
        ApplicationProfile.path_sep = '/';
      }else{
        ApplicationProfile.path_sep = '/';
      }
    }else{
      ApplicationProfile.ENV = ApplicationEnvironment.BROWSER;
      if(OSInfo.isWindows()){
        ApplicationProfile.path_sep = '/';
      }else{
        ApplicationProfile.path_sep = '/';
      }
    }
  }

}
