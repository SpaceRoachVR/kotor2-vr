import type {
  TextureRequest,
  TextureResolution,
  TextureResolutionSource,
  TextureTxiSource,
} from '../../src/loaders/TextureResolution';
import {
  isOptionalTextureSemantic,
  normalizeTextureResref,
  validateTextureRequest,
  validateTextureResolution,
} from '../../src/loaders/TextureResolution';

export interface MaterialAuditInput<TTexture> {
  request: TextureRequest;
  resolution: TextureResolution<TTexture>;
  width?: number;
  height?: number;
  sha256?: string;
  fallback?: string;
}

export interface MaterialAuditRecord {
  requestedResref: string;
  resolvedResref?: string;
  semantic: TextureRequest['semantic'];
  activeModule?: string;
  status: TextureResolution<unknown>['status'];
  source: TextureResolution<unknown>['source'];
  selectedSource: TextureResolution<unknown>['source'];
  searchedSources: readonly TextureResolutionSource[];
  txiSource?: TextureTxiSource;
  sourceLayerId?: string;
  diagnosticCode?: string;
  cacheGeneration: number;
  aliasEvidence?: string;
  width?: number;
  height?: number;
  sha256?: string;
  fallback?: string;
}

export function createMaterialAuditRecord<TTexture>(
  input: MaterialAuditInput<TTexture>,
): MaterialAuditRecord {
  if (!input || typeof input !== 'object' || !input.request || !input.resolution) {
    throw new TypeError('Material audit input requires a request and resolution');
  }
  validateTextureRequest(input.request);
  const resolution = validateTextureResolution(input.resolution);
  validateRequestResolutionIdentity(input.request, resolution);
  const width = validateDimension(input.width, 'width');
  const height = validateDimension(input.height, 'height');
  const sha256 = validateSha256(input.sha256);
  const fallback = validateFallback(input.fallback);
  validateResolvedMetadata(resolution, width, height, sha256);
  const activeModule = normalizeTextureResref(input.request.activeModule);
  const diagnosticCode = resolution.diagnostic?.code;

  return Object.freeze({
    requestedResref: resolution.requestedResref,
    ...(resolution.resolvedResref
      ? { resolvedResref: resolution.resolvedResref }
      : {}),
    semantic: input.request.semantic,
    ...(activeModule ? { activeModule } : {}),
    status: resolution.status,
    source: resolution.source,
    selectedSource: resolution.source,
    searchedSources: Object.freeze([...(resolution.searchedSources ?? [])]),
    ...(resolution.txiSource ? { txiSource: resolution.txiSource } : {}),
    ...(resolution.sourceLayerId ? { sourceLayerId: resolution.sourceLayerId } : {}),
    ...(diagnosticCode ? { diagnosticCode } : {}),
    cacheGeneration: resolution.cacheGeneration,
    ...(resolution.aliasEvidence ? { aliasEvidence: resolution.aliasEvidence } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(fallback ? { fallback } : {}),
  });
}

function validateFallback(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = normalizeTextureResref(value);
  if (!normalized) {
    throw new TypeError('Material audit fallback must be a non-empty resref');
  }
  return normalized;
}

function validateDimension(value: number | undefined, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Material audit ${label} must be a positive integer`);
  }
  return value;
}

function validateSha256(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError('Material audit SHA-256 must be 64 hexadecimal characters');
  }
  return normalized;
}

function validateRequestResolutionIdentity<TTexture>(
  request: TextureRequest,
  resolution: TextureResolution<TTexture>,
): void {
  const requestedResref = normalizeTextureResref(request.resref);
  if (requestedResref !== resolution.requestedResref) {
    throw new TypeError(
      `Material audit request '${requestedResref}' does not match resolution '${resolution.requestedResref}'`,
    );
  }

  if (
    resolution.resolvedResref !== undefined &&
    resolution.resolvedResref !== requestedResref &&
    !request.allowAlias
  ) {
    throw new TypeError('Material audit resolution used an alias that the request did not permit');
  }

  if (resolution.status === 'missing') {
    const expectedCode = isOptionalTextureSemantic(request.semantic)
      ? 'missing-optional-texture'
      : 'missing-required-texture';
    if (resolution.diagnostic.code !== expectedCode) {
      throw new TypeError(
        `Material audit missing diagnostic '${resolution.diagnostic.code}' contradicts ${request.semantic} semantics`,
      );
    }
  }
}

function validateResolvedMetadata<TTexture>(
  resolution: TextureResolution<TTexture>,
  width: number | undefined,
  height: number | undefined,
  sha256: string | undefined,
): void {
  if ((width === undefined) !== (height === undefined)) {
    throw new TypeError('Material audit width and height must be supplied together');
  }
  if (resolution.status !== 'resolved' && (width !== undefined || sha256 !== undefined)) {
    throw new TypeError('Material audit dimensions and hashes require a resolved texture');
  }
}
