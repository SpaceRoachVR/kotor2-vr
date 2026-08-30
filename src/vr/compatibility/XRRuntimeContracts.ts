export type XRSessionLifecycleState =
  | 'unavailable'
  | 'ready'
  | 'requesting'
  | 'presenting'
  | 'ending'
  | 'lost'
  | 'failed';

export interface XRRuntimeRates {
  readonly runtimeReportedHz: number | null;
  readonly runtimeSupportedHz: readonly number[];
  readonly requestedHz: number | null;
  readonly observedCallbackHz: number | null;
}

export interface XRSessionDiagnosticSnapshot extends XRRuntimeRates {
  readonly state: XRSessionLifecycleState;
  readonly failureStage: string | null;
  readonly failureName: string | null;
  readonly failureMessage: string | null;
}

export const EMPTY_XR_RUNTIME_RATES: XRRuntimeRates = Object.freeze({
  runtimeReportedHz: null,
  runtimeSupportedHz: Object.freeze([] as number[]),
  requestedHz: null,
  observedCallbackHz: null,
});

export function readXRRuntimeRates(session: XRSession, requestedHz: number | null = null): XRRuntimeRates {
  const runtimeSession = session as XRSession & {
    readonly frameRate?: number;
    readonly supportedFrameRates?: ArrayLike<number>;
  };
  return {
    runtimeReportedHz: positiveFiniteOrNull(runtimeSession.frameRate),
    runtimeSupportedHz: normalizeSupportedRates(runtimeSession.supportedFrameRates),
    requestedHz: positiveFiniteOrNull(requestedHz),
    observedCallbackHz: null,
  };
}

function normalizeSupportedRates(rates: ArrayLike<number> | undefined): readonly number[] {
  if (!rates) return [];
  return [...new Set(Array.from(rates, positiveFiniteOrNull).filter((rate): rate is number => rate !== null))]
    .sort((left, right) => left - right);
}

function positiveFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
