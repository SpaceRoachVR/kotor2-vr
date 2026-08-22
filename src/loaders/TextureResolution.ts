export type TextureSemantic =
  | 'diffuse'
  | 'lightmap'
  | 'normal'
  | 'bump'
  | 'environment'
  | 'gui'
  | 'font'
  | 'particle'
  | 'other';

export type TextureResolutionSource =
  | 'none'
  | 'override-tga'
  | 'override-tpc'
  | 'active-module'
  | 'gui-pack'
  | 'texture-pack'
  | 'key-bif';

export interface TextureRequest {
  resref: string;
  semantic: TextureSemantic;
  activeModule?: string;
  allowAlias: boolean;
}

export interface ExplicitTextureAlias {
  requestedResref: string;
  resolvedResref: string;
  evidence: string;
}

export interface TextureDiagnostic {
  code: 'invalid-resref' | 'missing-required-texture' | 'missing-optional-texture';
  message: string;
}

export interface TextureResolution<TTexture> {
  status: 'resolved' | 'missing' | 'invalid';
  requestedResref: string;
  resolvedResref?: string;
  source: TextureResolutionSource;
  diagnostic?: TextureDiagnostic;
  cacheGeneration: number;
  aliasEvidence?: string;
  texture?: TTexture;
}

export interface TextureSourceProvider<TTexture> {
  load(
    source: TextureResolutionSource,
    resref: string,
    activeModule?: string,
  ): Promise<TTexture | undefined>;
}

export interface TextureResolverOptions {
  aliases?: readonly ExplicitTextureAlias[];
  cacheGeneration?: () => number;
}

export class TextureResolver<TTexture> {
  private readonly aliases = new Map<string, ExplicitTextureAlias>();
  private readonly getCacheGeneration: () => number;

  constructor(
    private readonly provider: TextureSourceProvider<TTexture>,
    options: TextureResolverOptions = {},
  ) {
    if (!provider || typeof provider.load !== 'function') {
      throw new TypeError('TextureResolver requires a source provider');
    }
    this.getCacheGeneration = options.cacheGeneration ?? (() => 1);
    for (const alias of options.aliases ?? []) {
      const requestedResref = normalizeTextureResref(alias.requestedResref);
      const resolvedResref = normalizeTextureResref(alias.resolvedResref);
      if (!isTextureResrefUsable(requestedResref) || !isTextureResrefUsable(resolvedResref)) {
        throw new TypeError('Texture aliases require usable requested and resolved resrefs');
      }
      if (typeof alias.evidence !== 'string' || !alias.evidence.trim()) {
        throw new TypeError(`Texture alias '${requestedResref}' requires installed-content evidence`);
      }
      if (this.aliases.has(requestedResref)) {
        throw new TypeError(`Duplicate texture alias '${requestedResref}'`);
      }
      this.aliases.set(requestedResref, {
        requestedResref,
        resolvedResref,
        evidence: alias.evidence.trim(),
      });
    }
  }

  async resolve(request: TextureRequest): Promise<TextureResolution<TTexture>> {
    if (!request || typeof request !== 'object') {
      throw new TypeError('TextureResolver.resolve requires a texture request');
    }
    const requestedResref = normalizeTextureResref(request.resref);
    const activeModule = normalizeOptionalResref(request.activeModule);
    const cacheGeneration = this.readCacheGeneration();
    if (!isTextureResrefUsable(requestedResref)) {
      return {
        status: 'invalid',
        requestedResref,
        source: 'none',
        cacheGeneration,
        diagnostic: {
          code: 'invalid-resref',
          message: `Rejected texture sentinel '${requestedResref || '<empty>'}' before resource lookup`,
        },
      };
    }

    const direct = await this.resolveExact(requestedResref, request.semantic, activeModule);
    if (direct) {
      return {
        status: 'resolved',
        requestedResref,
        resolvedResref: requestedResref,
        source: direct.source,
        cacheGeneration,
        texture: direct.texture,
      };
    }

    const alias = request.allowAlias ? this.aliases.get(requestedResref) : undefined;
    if (alias) {
      const aliased = await this.resolveExact(alias.resolvedResref, request.semantic, activeModule);
      if (aliased) {
        return {
          status: 'resolved',
          requestedResref,
          resolvedResref: alias.resolvedResref,
          source: aliased.source,
          cacheGeneration,
          aliasEvidence: alias.evidence,
          texture: aliased.texture,
        };
      }
    }

    const isOptional = isOptionalSemantic(request.semantic);
    return {
      status: 'missing',
      requestedResref,
      source: 'none',
      cacheGeneration,
      diagnostic: {
        code: isOptional ? 'missing-optional-texture' : 'missing-required-texture',
        message: isOptional
          ? `Optional ${request.semantic} texture '${requestedResref}' was not found; its material feature is disabled`
          : `Required ${request.semantic} texture '${requestedResref}' was not found in any permitted source`,
      },
    };
  }

  private async resolveExact(
    resref: string,
    semantic: TextureSemantic,
    activeModule?: string,
  ): Promise<{ source: TextureResolutionSource; texture: TTexture } | undefined> {
    const sources: TextureResolutionSource[] = ['override-tga', 'override-tpc'];
    if (activeModule) {
      sources.push('active-module');
    }
    if (semantic === 'gui' || semantic === 'font') {
      sources.push('gui-pack');
    }
    sources.push('texture-pack', 'key-bif');

    for (const source of sources) {
      const texture = await this.provider.load(source, resref, activeModule);
      if (texture !== undefined && texture !== null) {
        return { source, texture };
      }
    }
    return undefined;
  }

  private readCacheGeneration(): number {
    const generation = this.getCacheGeneration();
    if (!Number.isSafeInteger(generation) || generation < 1) {
      throw new RangeError(`Invalid texture cache generation '${generation}'`);
    }
    return generation;
  }
}

export type TextureOwnership = 'module' | 'shared-gui' | 'shared-global';

interface TextureLifetimeEntry<TTexture> {
  texture: TTexture;
  ownership: TextureOwnership;
  generation: number;
}

export class TextureLifetimeRegistry<TTexture extends { dispose(): void }> {
  private readonly entries = new Map<string, TextureLifetimeEntry<TTexture>>();
  private generation = 1;

  get currentGeneration(): number {
    return this.generation;
  }

  set(
    resref: string,
    texture: TTexture,
    ownership: TextureOwnership,
    generation: number = this.currentGeneration,
  ): void {
    const normalizedResref = normalizeTextureResref(resref);
    if (!isTextureResrefUsable(normalizedResref)) {
      throw new TypeError(`Cannot cache invalid texture resref '${normalizedResref || '<empty>'}'`);
    }
    if (!texture || typeof texture.dispose !== 'function') {
      throw new TypeError(`Texture '${normalizedResref}' is not disposable`);
    }
    if (!['module', 'shared-gui', 'shared-global'].includes(ownership)) {
      throw new TypeError(`Invalid texture ownership '${ownership}'`);
    }
    if (generation !== this.currentGeneration) {
      throw new RangeError(`Texture generation ${generation} is not active`);
    }
    this.entries.set(normalizedResref, { texture, ownership, generation });
  }

  get(resref: string): TTexture | undefined {
    return this.entries.get(normalizeTextureResref(resref))?.texture;
  }

  disposeModuleGeneration(generation: number): { disposed: number; nextGeneration: number } {
    if (generation !== this.currentGeneration) {
      throw new RangeError(`Texture generation ${generation} is not active`);
    }

    const removedTextures = new Set<TTexture>();
    for (const [resref, entry] of this.entries) {
      if (entry.ownership === 'module' && entry.generation === generation) {
        removedTextures.add(entry.texture);
        this.entries.delete(resref);
      }
    }

    const retainedTextures = new Set(
      Array.from(this.entries.values(), ({ texture }) => texture),
    );
    let disposed = 0;
    for (const texture of removedTextures) {
      if (!retainedTextures.has(texture)) {
        texture.dispose();
        disposed += 1;
      }
    }

    this.generation += 1;
    return { disposed, nextGeneration: this.generation };
  }
}

const INVALID_RESREFS = new Set(['', '0', '****']);

export function normalizeTextureResref(resref: unknown): string {
  return typeof resref === 'string' ? resref.trim().toLocaleLowerCase() : '';
}

function normalizeOptionalResref(resref: unknown): string | undefined {
  const normalized = normalizeTextureResref(resref);
  return isTextureResrefUsable(normalized) ? normalized : undefined;
}

export function isTextureResrefUsable(resref: string): boolean {
  return !INVALID_RESREFS.has(resref);
}

function isOptionalSemantic(semantic: TextureSemantic): boolean {
  return semantic === 'lightmap' || semantic === 'normal' || semantic === 'bump' || semantic === 'environment';
}
