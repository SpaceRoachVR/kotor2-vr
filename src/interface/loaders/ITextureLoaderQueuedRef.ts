import type * as THREE from "three";
import type { TextureType } from "@/enums/loaders/TextureType";
import type { TextureSemantic } from "@/loaders/TextureResolution";

/**
 * ITextureLoaderQueuedRef interface.
 * 
 * KotOR JS - A remake of the Odyssey Game Engine that powered KotOR I & II
 * 
 * @file ITextureLoaderQueuedRef.ts
 * @author KobaltBlu <https://github.com/KobaltBlu>
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 * @interface
 */
export interface ITextureLoaderQueuedRef {
  name: string,
  type: TextureType,
  material?: THREE.Material,
  partGroup?: any,
  fallback?: string,
  semantic?: TextureSemantic,
  onLoad?: Function,
}
