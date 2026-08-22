import type { TextureRequest, TextureResolution } from '../../src/loaders/TextureResolution';
import { normalizeTextureResref } from '../../src/loaders/TextureResolution';

export interface MaterialAuditInput<TTexture> {
  request: TextureRequest;
  resolution: TextureResolution<TTexture>;
  width?: number;
  height?: number;
  sha256?: string;
}

export interface MaterialAuditRecord {
  requestedResref: string;
  resolvedResref?: string;
  semantic: TextureRequest['semantic'];
  activeModule?: string;
  status: TextureResolution<unknown>['status'];
  source: TextureResolution<unknown>['source'];
  diagnosticCode?: string;
  cacheGeneration: number;
  aliasEvidence?: string;
  width?: number;
  height?: number;
  sha256?: string;
}

export function createMaterialAuditRecord<TTexture>(
  input: MaterialAuditInput<TTexture>,
): MaterialAuditRecord {
  if (!input || typeof input !== 'object' || !input.request || !input.resolution) {
    throw new TypeError('Material audit input requires a request and resolution');
  }
  const width = validateDimension(input.width, 'width');
  const height = validateDimension(input.height, 'height');
  const sha256 = validateSha256(input.sha256);
  const activeModule = normalizeTextureResref(input.request.activeModule);
  const diagnosticCode = input.resolution.diagnostic?.code;

  return Object.freeze({
    requestedResref: normalizeTextureResref(input.resolution.requestedResref),
    ...(input.resolution.resolvedResref
      ? { resolvedResref: normalizeTextureResref(input.resolution.resolvedResref) }
      : {}),
    semantic: input.request.semantic,
    ...(activeModule ? { activeModule } : {}),
    status: input.resolution.status,
    source: input.resolution.source,
    ...(diagnosticCode ? { diagnosticCode } : {}),
    cacheGeneration: input.resolution.cacheGeneration,
    ...(input.resolution.aliasEvidence ? { aliasEvidence: input.resolution.aliasEvidence } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(sha256 ? { sha256 } : {}),
  });
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
  const normalized = value.trim().toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError('Material audit SHA-256 must be 64 hexadecimal characters');
  }
  return normalized;
}
