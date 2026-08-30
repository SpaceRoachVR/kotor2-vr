import * as THREE from 'three';
import { TextureLoader } from '@/loaders/TextureLoader';

export type VRActionIconFallbackCategory =
  | 'attack'
  | 'force'
  | 'item'
  | 'inventory'
  | 'map'
  | 'party'
  | 'previous'
  | 'next'
  | 'generic';

export interface VRActionIconSource {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly kind?: string;
}

export interface VRResolvedActionIcon {
  readonly resref: string | null;
  readonly fallbackCategory: VRActionIconFallbackCategory;
}

export interface VRActionIconTextureLoader {
  /** Returns a texture whose ownership transfers to the cache. */
  load(resref: string): Promise<THREE.Texture | null>;
}

export interface VRActionIconFallbackFactory {
  /** Returns a newly owned deterministic fallback texture. */
  create(category: VRActionIconFallbackCategory): THREE.Texture;
}

export interface VROwnedActionIconTextureCacheOptions {
  readonly capacity?: number;
  readonly logger?: Pick<Console, 'warn'>;
  readonly ownerLabel?: string;
}

const DEFAULT_CAPACITY = 64;

export const DEFAULT_VR_ACTION_ICON_TEXTURE_LOADER: VRActionIconTextureLoader = {
  async load(resref: string): Promise<THREE.Texture | null> {
    const sharedTexture = await TextureLoader.LoadGUI(resref);
    if (!sharedTexture) return null;
    const ownedTexture = sharedTexture.clone();
    ownedTexture.needsUpdate = true;
    return ownedTexture;
  },
};

export const DEFAULT_VR_ACTION_ICON_FALLBACK_FACTORY: VRActionIconFallbackFactory = {
  create: createFallbackTexture,
};

/** Resolves a normalized KOTOR texture resref plus a stable fallback category. */
export function resolveVRActionIcon(source: VRActionIconSource): VRResolvedActionIcon {
  if (!source || typeof source !== 'object' ||
    typeof source.id !== 'string' || source.id.trim().length === 0 ||
    typeof source.label !== 'string' || source.label.trim().length === 0) {
    throw new TypeError('action icon source requires non-empty id and label strings');
  }
  if (source.icon !== undefined &&
    (typeof source.icon !== 'string' || source.icon.trim().length === 0)) {
    throw new TypeError('action icon resref must be a non-empty string when present');
  }
  const resref = source.icon?.trim().toLowerCase() ?? null;
  const identity = `${source.kind ?? ''} ${source.id} ${source.label} ${resref ?? ''}`.toLowerCase();
  return {
    resref,
    fallbackCategory: resolveFallbackCategory(identity),
  };
}

/**
 * Bounded LRU cache for host-owned textures. Active presentation keys are
 * pinned so eviction never disposes a texture still referenced by a material.
 */
export class VROwnedActionIconTextureCache {
  private readonly capacity: number;
  private readonly logger: Pick<Console, 'warn'>;
  private readonly ownerLabel: string;
  private readonly entries = new Map<string, THREE.Texture | null>();
  private readonly inFlight = new Map<string, Promise<THREE.Texture | null>>();
  private readonly activeKeys = new Set<string>();
  private readonly warnedResrefs = new Set<string>();
  private readonly disposedTextures = new WeakSet<THREE.Texture>();
  private disposed = false;

  constructor(
    private readonly loader: VRActionIconTextureLoader,
    private readonly fallbackFactory: VRActionIconFallbackFactory,
    options: VROwnedActionIconTextureCacheOptions = {},
  ) {
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (!loader || typeof loader.load !== 'function') {
      throw new TypeError('action icon texture loader must provide load(resref)');
    }
    if (!fallbackFactory || typeof fallbackFactory.create !== 'function') {
      throw new TypeError('action icon fallback factory must provide create(category)');
    }
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('action icon cache capacity must be a positive integer');
    }
    if (options.logger && typeof options.logger.warn !== 'function') {
      throw new TypeError('action icon cache logger must provide warn(message, error)');
    }
    this.capacity = capacity;
    this.logger = options.logger ?? console;
    this.ownerLabel = options.ownerLabel?.trim() || 'VRActionIconTextureCache';
  }

  setActiveDescriptors(descriptors: readonly VRResolvedActionIcon[]): void {
    this.assertNotDisposed();
    if (!Array.isArray(descriptors)) throw new TypeError('active icon descriptors must be an array');
    const keys = new Set<string>();
    for (const descriptor of descriptors) {
      validateDescriptor(descriptor);
      if (descriptor.resref) keys.add(resrefKey(descriptor.resref));
      keys.add(fallbackKey(descriptor.fallbackCategory));
    }
    if (keys.size > this.capacity) {
      throw new RangeError('active icon descriptors exceed the owned cache capacity');
    }
    this.activeKeys.clear();
    keys.forEach((key) => this.activeKeys.add(key));
    this.trim();
  }

  getFallback(descriptor: VRResolvedActionIcon): THREE.Texture {
    this.assertNotDisposed();
    validateDescriptor(descriptor);
    const key = fallbackKey(descriptor.fallbackCategory);
    const cached = this.readEntry(key);
    if (cached) return cached;
    const texture = this.fallbackFactory.create(descriptor.fallbackCategory);
    if (!isTexture(texture)) {
      throw new TypeError(`fallback factory returned an invalid ${descriptor.fallbackCategory} texture`);
    }
    return this.storeTexture(key, texture);
  }

  async load(descriptor: VRResolvedActionIcon): Promise<THREE.Texture> {
    this.assertNotDisposed();
    validateDescriptor(descriptor);
    if (!descriptor.resref) return this.getFallback(descriptor);
    const texture = await this.loadResref(descriptor.resref);
    this.assertNotDisposed();
    return texture ?? this.getFallback(descriptor);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activeKeys.clear();
    for (const texture of this.entries.values()) {
      if (texture) this.disposeTexture(texture);
    }
    this.entries.clear();
    this.inFlight.clear();
    this.warnedResrefs.clear();
  }

  private loadResref(resref: string): Promise<THREE.Texture | null> {
    const key = resrefKey(resref);
    if (this.entries.has(key)) return Promise.resolve(this.readEntry(key));
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const load = Promise.resolve()
      .then(() => this.loader.load(resref))
      .then((texture) => {
        if (texture !== null && !isTexture(texture)) {
          throw new TypeError(`icon loader returned an invalid texture for '${resref}'`);
        }
        if (this.disposed) {
          if (texture) this.disposeTexture(texture);
          throw new Error('action icon texture cache is disposed');
        }
        if (!texture) this.warnMissingOnce(resref);
        this.entries.set(key, texture);
        this.touch(key);
        this.trim();
        return texture;
      })
      .catch((error): THREE.Texture | null => {
        if (this.disposed) throw error;
        this.warnMissingOnce(resref, error);
        this.entries.set(key, null);
        this.touch(key);
        this.trim();
        return null;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, load);
    return load;
  }

  private readEntry(key: string): THREE.Texture | null {
    const value = this.entries.get(key) ?? null;
    if (this.entries.has(key)) this.touch(key);
    return value;
  }

  private storeTexture(key: string, texture: THREE.Texture): THREE.Texture {
    const existing = this.entries.get(key);
    if (existing) {
      if (existing !== texture) this.disposeTexture(texture);
      this.touch(key);
      return existing;
    }
    this.entries.set(key, texture);
    this.touch(key);
    this.trim();
    return texture;
  }

  private touch(key: string): void {
    if (!this.entries.has(key)) return;
    const value = this.entries.get(key) ?? null;
    this.entries.delete(key);
    this.entries.set(key, value);
  }

  private trim(): void {
    while (this.entries.size > this.capacity) {
      const evictionKey = [...this.entries.keys()].find((key) => !this.activeKeys.has(key));
      if (!evictionKey) {
        throw new RangeError('active icon textures exceed the owned cache capacity');
      }
      const texture = this.entries.get(evictionKey) ?? null;
      this.entries.delete(evictionKey);
      if (texture && !this.containsTexture(texture)) this.disposeTexture(texture);
    }
  }

  private containsTexture(texture: THREE.Texture): boolean {
    return [...this.entries.values()].some((candidate) => candidate === texture);
  }

  private disposeTexture(texture: THREE.Texture): void {
    if (this.disposedTextures.has(texture)) return;
    this.disposedTextures.add(texture);
    texture.dispose();
  }

  private warnMissingOnce(resref: string, error?: unknown): void {
    if (this.warnedResrefs.has(resref)) return;
    this.warnedResrefs.add(resref);
    try {
      this.logger.warn(
        `[${this.ownerLabel}] Icon '${resref}' could not be loaded; using a category fallback.`,
        error,
      );
    } catch {
      // Optional diagnostics must not break presentation.
    }
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('action icon texture cache is disposed');
  }
}

function resolveFallbackCategory(identity: string): VRActionIconFallbackCategory {
  if (/previous|prev|nav:previous/.test(identity)) return 'previous';
  if (/next|nav:next/.test(identity)) return 'next';
  if (/attack|bash|blaster|weapon|saber/.test(identity)) return 'attack';
  if (/force|power/.test(identity)) return 'force';
  if (/medpac|item|stim|grenade|mine|recover|disarm/.test(identity)) return 'item';
  if (/inventory/.test(identity)) return 'inventory';
  if (/map/.test(identity)) return 'map';
  if (/party|companion|leader/.test(identity)) return 'party';
  return 'generic';
}

function validateDescriptor(descriptor: VRResolvedActionIcon): void {
  if (!descriptor || typeof descriptor !== 'object' ||
    (descriptor.resref !== null &&
      (typeof descriptor.resref !== 'string' || descriptor.resref.trim().length === 0)) ||
    !isFallbackCategory(descriptor.fallbackCategory)) {
    throw new TypeError('resolved action icon descriptor is malformed');
  }
}

function isFallbackCategory(value: unknown): value is VRActionIconFallbackCategory {
  return value === 'attack' || value === 'force' || value === 'item' ||
    value === 'inventory' || value === 'map' || value === 'party' ||
    value === 'previous' || value === 'next' || value === 'generic';
}

function resrefKey(resref: string): string {
  return `resref:${resref.trim().toLowerCase()}`;
}

function fallbackKey(category: VRActionIconFallbackCategory): string {
  return `fallback:${category}`;
}

function isTexture(texture: unknown): texture is THREE.Texture {
  return texture instanceof THREE.Texture || Boolean(
    texture && typeof texture === 'object' && (texture as { readonly isTexture?: unknown }).isTexture === true,
  );
}

function createFallbackTexture(category: VRActionIconFallbackCategory): THREE.CanvasTexture {
  if (typeof document === 'undefined') throw new Error('action icon fallback requires a browser document');
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('action icon fallback canvas context unavailable');
  drawFallbackIcon(context, canvas.width, category);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  texture.needsUpdate = true;
  texture.name = `Kotor2VR.action-icon-fallback.${category}`;
  return texture;
}

function drawFallbackIcon(
  context: CanvasRenderingContext2D,
  size: number,
  category: VRActionIconFallbackCategory,
): void {
  const center = size / 2;
  context.clearRect(0, 0, size, size);
  context.strokeStyle = '#ffffff';
  context.fillStyle = '#ffffff';
  context.lineWidth = size * 0.055;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (category === 'attack') {
    context.beginPath();
    context.moveTo(size * 0.28, size * 0.22); context.lineTo(size * 0.72, size * 0.78);
    context.moveTo(size * 0.72, size * 0.22); context.lineTo(size * 0.28, size * 0.78);
    context.moveTo(size * 0.22, size * 0.68); context.lineTo(size * 0.38, size * 0.84);
    context.moveTo(size * 0.78, size * 0.68); context.lineTo(size * 0.62, size * 0.84);
    context.stroke();
  } else if (category === 'force') {
    context.beginPath();
    for (let ray = 0; ray < 8; ray += 1) {
      const angle = (ray / 8) * Math.PI * 2;
      context.moveTo(center + Math.cos(angle) * size * 0.15, center + Math.sin(angle) * size * 0.15);
      context.lineTo(center + Math.cos(angle) * size * 0.36, center + Math.sin(angle) * size * 0.36);
    }
    context.stroke();
    context.beginPath(); context.arc(center, center, size * 0.11, 0, Math.PI * 2); context.fill();
  } else if (category === 'item') {
    context.strokeRect(size * 0.25, size * 0.22, size * 0.5, size * 0.58);
    context.fillRect(size * 0.44, size * 0.32, size * 0.12, size * 0.38);
    context.fillRect(size * 0.31, size * 0.45, size * 0.38, size * 0.12);
  } else if (category === 'inventory') {
    context.strokeRect(size * 0.22, size * 0.31, size * 0.56, size * 0.48);
    context.beginPath();
    context.moveTo(size * 0.36, size * 0.31); context.quadraticCurveTo(center, size * 0.08, size * 0.64, size * 0.31);
    context.stroke();
    context.fillRect(size * 0.46, size * 0.5, size * 0.08, size * 0.14);
  } else if (category === 'map') {
    context.beginPath();
    context.moveTo(size * 0.2, size * 0.28); context.lineTo(size * 0.4, size * 0.2);
    context.lineTo(size * 0.6, size * 0.3); context.lineTo(size * 0.8, size * 0.22);
    context.lineTo(size * 0.8, size * 0.72); context.lineTo(size * 0.6, size * 0.8);
    context.lineTo(size * 0.4, size * 0.7); context.lineTo(size * 0.2, size * 0.78);
    context.closePath(); context.stroke();
    context.beginPath(); context.moveTo(size * 0.4, size * 0.2); context.lineTo(size * 0.4, size * 0.7);
    context.moveTo(size * 0.6, size * 0.3); context.lineTo(size * 0.6, size * 0.8); context.stroke();
  } else if (category === 'party') {
    context.beginPath();
    context.arc(center, size * 0.36, size * 0.13, 0, Math.PI * 2);
    context.arc(size * 0.29, size * 0.47, size * 0.1, 0, Math.PI * 2);
    context.arc(size * 0.71, size * 0.47, size * 0.1, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(center, size * 0.78, size * 0.27, Math.PI, Math.PI * 2);
    context.arc(size * 0.24, size * 0.76, size * 0.18, Math.PI, Math.PI * 2);
    context.arc(size * 0.76, size * 0.76, size * 0.18, Math.PI, Math.PI * 2);
    context.stroke();
  } else if (category === 'previous' || category === 'next') {
    const direction = category === 'previous' ? -1 : 1;
    context.beginPath();
    context.moveTo(center - direction * size * 0.25, center);
    context.lineTo(center + direction * size * 0.18, center);
    context.moveTo(center + direction * size * 0.02, center - size * 0.18);
    context.lineTo(center + direction * size * 0.2, center);
    context.lineTo(center + direction * size * 0.02, center + size * 0.18);
    context.stroke();
  } else {
    context.beginPath();
    context.moveTo(center, size * 0.19); context.lineTo(size * 0.81, center);
    context.lineTo(center, size * 0.81); context.lineTo(size * 0.19, center);
    context.closePath(); context.stroke();
    context.beginPath(); context.arc(center, center, size * 0.07, 0, Math.PI * 2); context.fill();
  }
}
