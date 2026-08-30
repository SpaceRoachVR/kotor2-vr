import {
  resolveValidVRWorldPromptPage,
  VRWorldActionPromptModel,
} from './VRWorldActionPromptModel';

export interface VRWorldPromptOpeningIdentity {
  readonly candidateId: string;
  readonly openingKey: string;
}

export type VRWorldPromptModelResolution =
  | { readonly status: 'success'; readonly model: VRWorldActionPromptModel }
  | { readonly status: 'expected-empty' }
  | { readonly status: 'failed' };

type CachedVRWorldPromptModelResolution = Exclude<VRWorldPromptModelResolution, { readonly status: 'failed' }>;

export interface VRWorldPromptModelResolverLogger {
  error(message: string, error?: unknown): void;
}

export interface VRWorldPromptModelResolverOptions {
  readonly retryDelayStableFrames?: number;
  readonly logger?: VRWorldPromptModelResolverLogger;
}

const DEFAULT_RETRY_DELAY_STABLE_FRAMES = 30;

/**
 * Caches one stable prompt opening and distinguishes expected empty results
 * from construction faults. A fault receives one delayed retry; persistent
 * faults remain quiescent until the candidate/opening identity changes.
 */
export class VRWorldPromptModelResolver {
  private readonly retryDelayStableFrames: number;
  private readonly logger: VRWorldPromptModelResolverLogger;
  private identityKey: string | null = null;
  private cachedResolution: CachedVRWorldPromptModelResolution | null = null;
  private failureActive = false;
  private stableFramesSinceFailure = 0;
  private retryAttempted = false;
  private diagnosticReported = false;

  constructor(options: VRWorldPromptModelResolverOptions = {}) {
    const retryDelay = options.retryDelayStableFrames ?? DEFAULT_RETRY_DELAY_STABLE_FRAMES;
    if (!Number.isInteger(retryDelay) || retryDelay < 1) {
      throw new RangeError('retryDelayStableFrames must be a positive integer');
    }
    if (options.logger && typeof options.logger.error !== 'function') {
      throw new TypeError('world prompt resolver logger must provide error(message, error)');
    }
    this.retryDelayStableFrames = retryDelay;
    this.logger = options.logger ?? console;
  }

  resolve(
    identity: VRWorldPromptOpeningIdentity,
    factory: () => VRWorldActionPromptModel | null,
  ): VRWorldPromptModelResolution {
    const identityKey = createIdentityKey(identity);
    if (typeof factory !== 'function') {
      throw new TypeError('world prompt model factory must be callable');
    }
    if (identityKey !== this.identityKey) this.beginOpening(identityKey);

    if (this.cachedResolution) return this.cachedResolution;
    if (this.failureActive) {
      if (this.retryAttempted) return { status: 'failed' };
      this.stableFramesSinceFailure += 1;
      if (this.stableFramesSinceFailure < this.retryDelayStableFrames) {
        return { status: 'failed' };
      }
      this.retryAttempted = true;
    }

    try {
      const model = factory();
      if (model === null) {
        this.cachedResolution = { status: 'expected-empty' };
      } else if (resolveValidVRWorldPromptPage(model, 0)) {
        this.cachedResolution = { status: 'success', model };
      } else {
        throw new TypeError('world prompt factory returned a malformed model');
      }
      this.failureActive = false;
    } catch (error) {
      this.failureActive = true;
      this.reportFailureOnce(identity, error);
    }
    return this.cachedResolution ?? { status: 'failed' };
  }

  reset(): void {
    this.identityKey = null;
    this.cachedResolution = null;
    this.failureActive = false;
    this.stableFramesSinceFailure = 0;
    this.retryAttempted = false;
    this.diagnosticReported = false;
  }

  private beginOpening(identityKey: string): void {
    this.reset();
    this.identityKey = identityKey;
  }

  private reportFailureOnce(identity: VRWorldPromptOpeningIdentity, error: unknown): void {
    if (this.diagnosticReported) return;
    this.diagnosticReported = true;
    try {
      this.logger.error(
        `[VRWorldPromptModelResolver] candidate='${identity.candidateId}' opening='${identity.openingKey}' construction failed; one stable-frame retry will be attempted`,
        error,
      );
    } catch {
      // Diagnostics cannot destabilize the XR frame loop.
    }
  }
}

function createIdentityKey(identity: VRWorldPromptOpeningIdentity): string {
  if (!identity || typeof identity !== 'object' ||
    typeof identity.candidateId !== 'string' || identity.candidateId.trim().length === 0 ||
    typeof identity.openingKey !== 'string' || identity.openingKey.trim().length === 0) {
    throw new TypeError('world prompt opening identity requires candidateId and openingKey');
  }
  return JSON.stringify([identity.candidateId.trim(), identity.openingKey.trim()]);
}
