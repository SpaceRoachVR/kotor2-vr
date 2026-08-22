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

export type ResolvedTextureSource = Exclude<TextureResolutionSource, 'none'>;

export type TextureTxiSource =
  | 'override-txi'
  | 'embedded-tpc'
  | 'active-module-txi'
  | 'gui-pack-txi'
  | 'texture-pack-txi'
  | 'key-bif-txi';

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
  code:
    | 'invalid-resref'
    | 'missing-required-texture'
    | 'missing-optional-texture'
    | 'decode-error';
  message: string;
}

interface TextureResolutionBase {
  requestedResref: string;
  cacheGeneration: number;
  /** Ordered sources actually consulted for this resolution. */
  searchedSources?: readonly ResolvedTextureSource[];
}

export interface ResolvedTextureResolution<TTexture> extends TextureResolutionBase {
  status: 'resolved';
  resolvedResref: string;
  source: ResolvedTextureSource;
  txiSource?: TextureTxiSource;
  aliasEvidence?: string;
  texture: TTexture;
  diagnostic?: never;
}

export interface MissingTextureResolution extends TextureResolutionBase {
  status: 'missing';
  source: 'none';
  diagnostic: TextureDiagnostic & {
    code: 'missing-required-texture' | 'missing-optional-texture';
  };
  resolvedResref?: never;
  txiSource?: never;
  aliasEvidence?: never;
  texture?: never;
}

export interface InvalidTextureResolution extends TextureResolutionBase {
  status: 'invalid';
  source: 'none';
  diagnostic: TextureDiagnostic & { code: 'invalid-resref' };
  resolvedResref?: never;
  txiSource?: never;
  aliasEvidence?: never;
  texture?: never;
}

export interface DecodeErrorTextureResolution extends TextureResolutionBase {
  status: 'decode-error';
  resolvedResref: string;
  source: ResolvedTextureSource;
  txiSource?: TextureTxiSource;
  aliasEvidence?: string;
  diagnostic: TextureDiagnostic & { code: 'decode-error' };
  texture?: never;
}

export type TextureResolution<TTexture> =
  | ResolvedTextureResolution<TTexture>
  | MissingTextureResolution
  | InvalidTextureResolution
  | DecodeErrorTextureResolution;

export interface TextureSourceArtifact<TTexture> {
  texture: TTexture;
  txiSource?: TextureTxiSource;
}

export interface TextureSourceProvider<TTexture> {
  load(
    source: ResolvedTextureSource,
    resref: string,
    activeModule?: string,
  ): Promise<TextureSourceArtifact<TTexture> | undefined>;
}

export interface TextureResolverOptions {
  aliases?: readonly ExplicitTextureAlias[];
  cacheGeneration?: () => number;
}

type ExactResolution<TTexture> =
  | { status: 'resolved'; artifact: TextureSourceArtifact<TTexture>; source: ResolvedTextureSource }
  | { status: 'decode-error'; source: ResolvedTextureSource; error: unknown };

interface ExactResolutionAttempt<TTexture> {
  exact?: ExactResolution<TTexture>;
  searchedSources: ResolvedTextureSource[];
}

const TEXTURE_SEMANTICS = new Set<TextureSemantic>([
  'diffuse', 'lightmap', 'normal', 'bump', 'environment',
  'gui', 'font', 'particle', 'other',
]);

const RESOLVED_TEXTURE_SOURCES = new Set<ResolvedTextureSource>([
  'override-tga', 'override-tpc', 'active-module', 'gui-pack', 'texture-pack', 'key-bif',
]);

const TEXTURE_TXI_SOURCES = new Set<TextureTxiSource>([
  'override-txi', 'embedded-tpc', 'active-module-txi',
  'gui-pack-txi', 'texture-pack-txi', 'key-bif-txi',
]);

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
    validateTextureRequest(request);
    const requestedResref = normalizeTextureResref(request.resref);
    const activeModule = normalizeOptionalResref(request.activeModule);
    const cacheGeneration = this.readCacheGeneration();
    if (!isTextureResrefUsable(requestedResref)) {
      return {
        status: 'invalid',
        requestedResref,
        source: 'none',
        cacheGeneration,
        searchedSources: [],
        diagnostic: {
          code: 'invalid-resref',
          message: `Rejected texture sentinel '${requestedResref || '<empty>'}' before resource lookup`,
        },
      };
    }

    const direct = await this.resolveExact(requestedResref, request.semantic, activeModule);
    if (direct.exact) {
      return this.toResolution(
        direct.exact,
        request,
        requestedResref,
        requestedResref,
        cacheGeneration,
        direct.searchedSources,
      );
    }

    const alias = request.allowAlias ? this.aliases.get(requestedResref) : undefined;
    if (alias) {
      const aliased = await this.resolveExact(alias.resolvedResref, request.semantic, activeModule);
      if (aliased.exact) {
        return this.toResolution(
          aliased.exact,
          request,
          requestedResref,
          alias.resolvedResref,
          cacheGeneration,
          [...direct.searchedSources, ...aliased.searchedSources],
          alias.evidence,
        );
      }
      direct.searchedSources.push(...aliased.searchedSources);
    }

    const isOptional = isOptionalTextureSemantic(request.semantic);
    return {
      status: 'missing',
      requestedResref,
      source: 'none',
      cacheGeneration,
      searchedSources: direct.searchedSources,
      diagnostic: {
        code: isOptional ? 'missing-optional-texture' : 'missing-required-texture',
        message: isOptional
          ? `Optional ${request.semantic} texture '${requestedResref}' was not found; its material feature is disabled`
          : `Required ${request.semantic} texture '${requestedResref}' was not found in any permitted source`,
      },
    };
  }

  private toResolution(
    exact: ExactResolution<TTexture>,
    request: TextureRequest,
    requestedResref: string,
    resolvedResref: string,
    cacheGeneration: number,
    searchedSources: readonly ResolvedTextureSource[],
    aliasEvidence?: string,
  ): ResolvedTextureResolution<TTexture> | DecodeErrorTextureResolution {
    if (exact.status === 'decode-error') {
      return {
        status: 'decode-error',
        requestedResref,
        resolvedResref,
        source: exact.source,
        cacheGeneration,
        searchedSources,
        ...(aliasEvidence ? { aliasEvidence } : {}),
        diagnostic: {
          code: 'decode-error',
          message: `Failed to decode ${request.semantic} texture '${resolvedResref}' from ${exact.source}: ${formatError(exact.error)}`,
        },
      };
    }

    return {
      status: 'resolved',
      requestedResref,
      resolvedResref,
      source: exact.source,
      cacheGeneration,
      searchedSources,
      ...(exact.artifact.txiSource ? { txiSource: exact.artifact.txiSource } : {}),
      ...(aliasEvidence ? { aliasEvidence } : {}),
      texture: exact.artifact.texture,
    };
  }

  private async resolveExact(
    resref: string,
    semantic: TextureSemantic,
    activeModule?: string,
  ): Promise<ExactResolutionAttempt<TTexture>> {
    const sources: ResolvedTextureSource[] = ['override-tga', 'override-tpc'];
    if (activeModule) {
      sources.push('active-module');
    }
    if (semantic === 'gui' || semantic === 'font') {
      sources.push('gui-pack');
    }
    sources.push('texture-pack', 'key-bif');

    const searchedSources: ResolvedTextureSource[] = [];
    for (const source of sources) {
      searchedSources.push(source);
      try {
        const artifact = await this.provider.load(source, resref, activeModule);
        if (artifact !== undefined && artifact !== null) {
          validateTextureSourceArtifact(artifact, source, resref);
          return { exact: { status: 'resolved', source, artifact }, searchedSources };
        }
      } catch (error) {
        return { exact: { status: 'decode-error', source, error }, searchedSources };
      }
    }
    return { searchedSources };
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
    validateLifetimeEntry(normalizedResref, texture, ownership, generation, this.currentGeneration);

    const key = lifetimeKey(normalizedResref, ownership, generation);
    const replaced = this.entries.get(key);
    this.entries.set(key, { texture, ownership, generation });
    if (replaced && replaced.texture !== texture && !this.isTextureRetained(replaced.texture)) {
      replaced.texture.dispose();
    }
  }

  get(
    resref: string,
    ownership: TextureOwnership,
    generation: number = this.currentGeneration,
  ): TTexture | undefined {
    const normalizedResref = normalizeTextureResref(resref);
    if (!isTextureResrefUsable(normalizedResref) || !isTextureOwnership(ownership)) {
      return undefined;
    }
    return this.entries.get(lifetimeKey(normalizedResref, ownership, generation))?.texture;
  }

  disposeModuleGeneration(generation: number): { disposed: number; nextGeneration: number } {
    if (generation !== this.currentGeneration) {
      throw new RangeError(`Texture generation ${generation} is not active`);
    }

    const removedTextures = new Set<TTexture>();
    for (const [key, entry] of this.entries) {
      if (entry.ownership === 'module' && entry.generation === generation) {
        removedTextures.add(entry.texture);
        this.entries.delete(key);
      }
    }

    let disposed = 0;
    for (const texture of removedTextures) {
      if (!this.isTextureRetained(texture)) {
        texture.dispose();
        disposed += 1;
      }
    }

    this.generation += 1;
    return { disposed, nextGeneration: this.generation };
  }

  private isTextureRetained(texture: TTexture): boolean {
    for (const entry of this.entries.values()) {
      if (entry.texture === texture) {
        return true;
      }
    }
    return false;
  }
}

const INVALID_RESREFS = new Set(['', '0', '****']);

export function normalizeTextureResref(resref: unknown): string {
  return typeof resref === 'string' ? resref.trim().toLowerCase() : '';
}

export function isTextureResrefUsable(resref: unknown): resref is string {
  return typeof resref === 'string' && !INVALID_RESREFS.has(normalizeTextureResref(resref));
}

export function isOptionalTextureSemantic(semantic: TextureSemantic): boolean {
  return semantic === 'lightmap' || semantic === 'normal' || semantic === 'bump' || semantic === 'environment';
}

export function validateTextureResolution<TTexture>(
  resolution: TextureResolution<TTexture>,
): TextureResolution<TTexture> {
  if (!resolution || typeof resolution !== 'object') {
    throw new TypeError('Texture resolution must be an object');
  }
  if (!Number.isSafeInteger(resolution.cacheGeneration) || resolution.cacheGeneration < 1) {
    throw new RangeError('Texture resolution cache generation must be a positive safe integer');
  }
  if (resolution.requestedResref !== normalizeTextureResref(resolution.requestedResref)) {
    throw new TypeError('Texture resolution requested resref must be normalized');
  }
  if (resolution.searchedSources !== undefined) {
    if (!Array.isArray(resolution.searchedSources) || resolution.searchedSources.some(
      (source) => !RESOLVED_TEXTURE_SOURCES.has(source),
    )) {
      throw new TypeError('Texture resolution searched sources must contain only concrete sources');
    }
  }

  switch (resolution.status) {
    case 'resolved':
      validateConcreteResolutionIdentity(resolution);
      if (resolution.texture === undefined || resolution.texture === null) {
        throw new TypeError('Resolved texture resolution requires a texture');
      }
      if (resolution.diagnostic !== undefined) {
        throw new TypeError('Resolved texture resolution cannot contain a diagnostic');
      }
      break;
    case 'decode-error':
      validateConcreteResolutionIdentity(resolution);
      validateDiagnostic(resolution.diagnostic, ['decode-error']);
      if (resolution.texture !== undefined) {
        throw new TypeError('Decode-error texture resolution cannot contain a texture');
      }
      break;
    case 'missing':
      if (!isTextureResrefUsable(resolution.requestedResref)) {
        throw new TypeError('Missing texture resolution requires a usable requested resref');
      }
      validateEmptyResolutionFields(resolution);
      validateDiagnostic(resolution.diagnostic, [
        'missing-required-texture', 'missing-optional-texture',
      ]);
      break;
    case 'invalid':
      if (isTextureResrefUsable(resolution.requestedResref)) {
        throw new TypeError('Invalid texture resolution requires an unusable requested resref');
      }
      validateEmptyResolutionFields(resolution);
      validateDiagnostic(resolution.diagnostic, ['invalid-resref']);
      break;
    default:
      throw new TypeError(`Unknown texture resolution status '${String((resolution as { status?: unknown }).status)}'`);
  }
  return resolution;
}

export function validateTextureRequest(request: TextureRequest): TextureRequest {
  if (!request || typeof request !== 'object') {
    throw new TypeError('Texture request must be an object');
  }
  if (typeof request.resref !== 'string') {
    throw new TypeError('Texture request resref must be a string');
  }
  if (!TEXTURE_SEMANTICS.has(request.semantic)) {
    throw new TypeError(`Unknown texture semantic '${String(request.semantic)}'`);
  }
  if (typeof request.allowAlias !== 'boolean') {
    throw new TypeError('Texture request allowAlias must be boolean');
  }
  if (request.activeModule !== undefined && typeof request.activeModule !== 'string') {
    throw new TypeError('Texture request activeModule must be a string when provided');
  }
  return request;
}

function validateTextureSourceArtifact<TTexture>(
  artifact: TextureSourceArtifact<TTexture>,
  source: ResolvedTextureSource,
  resref: string,
): void {
  if (!artifact || typeof artifact !== 'object' || artifact.texture === undefined || artifact.texture === null) {
    throw new TypeError(`Texture provider returned an invalid artifact for '${resref}' from ${source}`);
  }
  if (artifact.txiSource !== undefined && !TEXTURE_TXI_SOURCES.has(artifact.txiSource)) {
    throw new TypeError(`Texture provider returned an invalid TXI source for '${resref}' from ${source}`);
  }
}

function validateConcreteResolutionIdentity(
  resolution: ResolvedTextureResolution<unknown> | DecodeErrorTextureResolution,
): void {
  if (!isTextureResrefUsable(resolution.requestedResref)) {
    throw new TypeError(`${resolution.status} texture resolution requires a usable requested resref`);
  }
  if (
    !isTextureResrefUsable(resolution.resolvedResref) ||
    resolution.resolvedResref !== normalizeTextureResref(resolution.resolvedResref)
  ) {
    throw new TypeError(`${resolution.status} texture resolution requires a normalized resolved resref`);
  }
  if (!RESOLVED_TEXTURE_SOURCES.has(resolution.source)) {
    throw new TypeError(`${resolution.status} texture resolution requires a concrete source`);
  }
  if (resolution.txiSource !== undefined && !TEXTURE_TXI_SOURCES.has(resolution.txiSource)) {
    throw new TypeError(`${resolution.status} texture resolution has an invalid TXI source`);
  }

  const isAlias = resolution.resolvedResref !== resolution.requestedResref;
  const hasAliasEvidence = typeof resolution.aliasEvidence === 'string' && !!resolution.aliasEvidence.trim();
  if (isAlias !== hasAliasEvidence) {
    throw new TypeError('Texture alias identity and evidence must agree');
  }
}

function validateEmptyResolutionFields(
  resolution: MissingTextureResolution | InvalidTextureResolution,
): void {
  if (resolution.source !== 'none') {
    throw new TypeError(`${resolution.status} texture resolution cannot name a concrete source`);
  }
  if (
    resolution.resolvedResref !== undefined ||
    resolution.txiSource !== undefined ||
    resolution.aliasEvidence !== undefined ||
    resolution.texture !== undefined
  ) {
    throw new TypeError(`${resolution.status} texture resolution contains incompatible fields`);
  }
}

function validateDiagnostic(
  diagnostic: TextureDiagnostic,
  allowedCodes: readonly TextureDiagnostic['code'][],
): void {
  if (
    !diagnostic ||
    typeof diagnostic !== 'object' ||
    !allowedCodes.includes(diagnostic.code) ||
    typeof diagnostic.message !== 'string' ||
    !diagnostic.message.trim()
  ) {
    throw new TypeError(`Texture resolution requires diagnostic code ${allowedCodes.join(' or ')}`);
  }
}

function validateLifetimeEntry<TTexture extends { dispose(): void }>(
  normalizedResref: string,
  texture: TTexture,
  ownership: TextureOwnership,
  generation: number,
  currentGeneration: number,
): void {
  if (!isTextureResrefUsable(normalizedResref)) {
    throw new TypeError(`Cannot cache invalid texture resref '${normalizedResref || '<empty>'}'`);
  }
  if (!texture || typeof texture.dispose !== 'function') {
    throw new TypeError(`Texture '${normalizedResref}' is not disposable`);
  }
  if (!isTextureOwnership(ownership)) {
    throw new TypeError(`Invalid texture ownership '${ownership}'`);
  }
  if (generation !== currentGeneration) {
    throw new RangeError(`Texture generation ${generation} is not active`);
  }
}

function lifetimeKey(resref: string, ownership: TextureOwnership, generation: number): string {
  return ownership === 'module'
    ? `${ownership}:${generation}:${resref}`
    : `${ownership}:${resref}`;
}

function isTextureOwnership(ownership: unknown): ownership is TextureOwnership {
  return ownership === 'module' || ownership === 'shared-gui' || ownership === 'shared-global';
}

function normalizeOptionalResref(resref: unknown): string | undefined {
  const normalized = normalizeTextureResref(resref);
  return isTextureResrefUsable(normalized) ? normalized : undefined;
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return typeof error === 'string' && error.trim() ? error.trim() : 'unknown decoder error';
}
