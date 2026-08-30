import {
  EMPTY_XR_RUNTIME_RATES,
  readXRRuntimeRates,
  XRRuntimeRates,
  XRSessionDiagnosticSnapshot,
  XRSessionLifecycleState,
} from '../compatibility/XRRuntimeContracts';

export interface XRSessionControllerDependencies {
  requestSession(): Promise<XRSession>;
  bindSession(session: XRSession): Promise<void>;
  setAnimationLoopActive(active: boolean): void;
  getInputSuppressed(): boolean;
  setInputSuppressed(suppressed: boolean): void;
  prepareSession?(session: XRSession): void | Promise<void>;
  cleanupSession?(session: XRSession | null): void | Promise<void>;
  onStateChanged?(snapshot: XRSessionDiagnosticSnapshot): void;
}

export class XRSessionController {
  private currentState: XRSessionLifecycleState = 'ready';
  private activeSession: XRSession | null = null;
  private inputSuppressedBeforeSession = false;
  private ownsInputSuppression = false;
  private ownsAnimationLoop = false;
  private rates: XRRuntimeRates = EMPTY_XR_RUNTIME_RATES;
  private failureStage: string | null = null;
  private failure: unknown = null;
  private cleanupPromise: Promise<void> | null = null;

  constructor(private readonly dependencies: XRSessionControllerDependencies) {}

  get state(): XRSessionLifecycleState {
    return this.currentState;
  }

  get session(): XRSession | null {
    return this.activeSession;
  }

  get diagnosticSnapshot(): XRSessionDiagnosticSnapshot {
    const error = normalizeError(this.failure);
    return {
      state: this.currentState,
      ...this.rates,
      failureStage: this.failureStage,
      failureName: error?.name ?? null,
      failureMessage: error?.message ?? null,
    };
  }

  markUnavailable(): void {
    if (this.activeSession) throw new Error('Cannot mark XR unavailable while a session is active');
    this.transition('unavailable');
  }

  markReady(): void {
    if (this.activeSession) throw new Error('Cannot mark XR ready while a session is active');
    this.failure = null;
    this.failureStage = null;
    this.transition('ready');
  }

  updateObservedCallbackHz(observedCallbackHz: number | null): void {
    this.rates = {
      ...this.rates,
      observedCallbackHz: typeof observedCallbackHz === 'number' && Number.isFinite(observedCallbackHz) && observedCallbackHz > 0
        ? observedCallbackHz
        : null,
    };
  }

  async enter(requestedHz: number | null = null): Promise<XRSession> {
    if (this.currentState !== 'ready' && this.currentState !== 'failed' && this.currentState !== 'lost') {
      throw new Error(`Cannot enter XR from state ${this.currentState}`);
    }
    this.failure = null;
    this.failureStage = null;
    this.rates = EMPTY_XR_RUNTIME_RATES;
    this.ownsInputSuppression = false;
    this.ownsAnimationLoop = false;
    this.transition('requesting');

    let session: XRSession | null = null;
    try {
      this.failureStage = 'request-session';
      session = await this.dependencies.requestSession();
      this.activeSession = session;
      session.addEventListener('end', this.handleRuntimeEnd);
      this.inputSuppressedBeforeSession = this.dependencies.getInputSuppressed();
      this.ownsInputSuppression = true;
      this.dependencies.setInputSuppressed(true);
      await this.dependencies.prepareSession?.(session);
      this.ownsAnimationLoop = true;
      this.dependencies.setAnimationLoopActive(true);
      this.failureStage = 'bind-session';
      await this.dependencies.bindSession(session);
      this.rates = readXRRuntimeRates(session, requestedHz);
      this.failureStage = null;
      this.transition('presenting');
      return session;
    } catch (error) {
      this.failure = error;
      await this.cleanup(session, true);
      this.transition('failed');
      throw error;
    }
  }

  async end(): Promise<void> {
    const session = this.activeSession;
    if (!session) return;
    this.transition('ending');
    let endError: unknown = null;
    try {
      await session.end();
    } catch (error) {
      endError = error;
      this.failure = error;
      this.failureStage = 'end-session';
    } finally {
      await this.cleanup(session, false);
    }
    if (endError) {
      this.transition('failed');
      throw endError;
    }
    this.transition('ready');
  }

  private readonly handleRuntimeEnd = (): void => {
    const expected = this.currentState === 'ending';
    if (!expected) this.transition('lost');
    void this.cleanup(this.activeSession, false).then(() => {
      if (expected) this.transition('ready');
    });
  };

  private cleanup(session: XRSession | null, endAcquiredSession: boolean): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = this.performCleanup(session, endAcquiredSession)
      .finally(() => { this.cleanupPromise = null; });
    return this.cleanupPromise;
  }

  private async performCleanup(session: XRSession | null, endAcquiredSession: boolean): Promise<void> {
    try {
      session?.removeEventListener('end', this.handleRuntimeEnd);
    } catch (error) {
      this.recordCleanupFailure(error);
    }
    if (this.ownsAnimationLoop) {
      this.ownsAnimationLoop = false;
      try {
        this.dependencies.setAnimationLoopActive(false);
      } catch (error) {
        this.recordCleanupFailure(error);
      }
    }
    if (this.ownsInputSuppression) {
      this.ownsInputSuppression = false;
      try {
        this.dependencies.setInputSuppressed(this.inputSuppressedBeforeSession);
      } catch (error) {
        this.recordCleanupFailure(error);
      }
    }
    this.activeSession = null;
    try {
      await this.dependencies.cleanupSession?.(session);
    } catch (error) {
      this.recordCleanupFailure(error);
    } finally {
      if (endAcquiredSession && session) {
        try {
          await session.end();
        } catch {
          // Startup rollback is already failing. Local ownership is released even
          // when the runtime refuses the best-effort session termination.
        }
      }
    }
  }

  private recordCleanupFailure(error: unknown): void {
    if (this.failure === null) {
      this.failure = error;
      this.failureStage = 'cleanup-session';
    }
  }

  private transition(state: XRSessionLifecycleState): void {
    this.currentState = state;
    this.dependencies.onStateChanged?.(this.diagnosticSnapshot);
  }
}

function normalizeError(error: unknown): { name: string; message: string } | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'Error', message: String(error) };
}
