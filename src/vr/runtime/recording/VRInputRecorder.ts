import { XRHandRole, XRInputFrame } from '../XRTypes';
import {
  VRTraceButton,
  VRTraceConversions,
  VRTraceFrame,
  VRTraceHandFrame,
  VRTraceMetadata,
  VRTracePose,
  VRTraceRecording,
} from './VRTraceTypes';

export interface VRRecorderOptions {
  readonly maxDurationMs?: number;
  readonly maxFrames?: number;
  readonly samplingIntervalMs?: number;
}

const DEFAULT_OPTIONS: Required<VRRecorderOptions> = {
  maxDurationMs: 10 * 60 * 1000, // 10 minutes
  maxFrames: 60 * 60 * 10,       // 36,000 frames (~10 mins at 60fps)
  samplingIntervalMs: 0,         // Record every available frame by default
};

/** Records runtime WebXR input frames into a deterministic JSON trace. */
export class VRInputRecorder {
  private readonly options: Required<VRRecorderOptions>;
  private recording = false;
  private startTimestamp = 0;
  private lastSampledTime = 0;
  private pendingMarkers: string[] = [];
  private frames: VRTraceFrame[] = [];
  private initialMetadata: Partial<VRTraceMetadata> = {};

  constructor(options: VRRecorderOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  isRecording(): boolean {
    return this.recording;
  }

  getFrameCount(): number {
    return this.frames.length;
  }

  getDurationMs(currentEngineTimestamp?: number): number {
    if (!this.recording) return this.frames.length > 0 ? this.frames[this.frames.length - 1].timeMs : 0;
    if (currentEngineTimestamp == null) return 0;
    return Math.max(0, currentEngineTimestamp - this.startTimestamp);
  }

  start(metadata: Partial<VRTraceMetadata> = {}, engineTimestamp: number = 0): void {
    this.frames = [];
    this.pendingMarkers = [];
    this.initialMetadata = { ...metadata };
    this.startTimestamp = engineTimestamp;
    this.lastSampledTime = Number.NEGATIVE_INFINITY;
    this.recording = true;
  }

  addMarker(marker: string): void {
    if (!this.recording) return;
    this.pendingMarkers.push(marker);
  }

  recordFrame(inputFrame: XRInputFrame | null, engineTimestamp: number): boolean {
    if (!this.recording || !inputFrame) return false;

    const timeMs = Math.max(0, engineTimestamp - this.startTimestamp);

    if (this.options.samplingIntervalMs > 0 && timeMs - this.lastSampledTime < this.options.samplingIntervalMs) {
      return false;
    }

    if (timeMs > this.options.maxDurationMs || this.frames.length >= this.options.maxFrames) {
      this.stop(engineTimestamp);
      return false;
    }

    this.lastSampledTime = timeMs;

    const headPose: VRTracePose = {
      position: VRTraceConversions.vectorToTrace(inputFrame.head.position) ?? { x: 0, y: 0, z: 0 },
      orientation: VRTraceConversions.quaternionToTrace(inputFrame.head.orientation),
      linearVelocity: VRTraceConversions.vectorToTrace(inputFrame.head.linearVelocity),
      angularVelocity: VRTraceConversions.vectorToTrace(inputFrame.head.angularVelocity),
      trackingState: inputFrame.head.trackingState,
    };

    const hands: Partial<Record<XRHandRole, VRTraceHandFrame>> = {};
    for (const role of ['left', 'right'] as const) {
      const hand = inputFrame.hands[role];
      if (!hand) continue;

      const buttons: Record<string, VRTraceButton> = {};
      for (const [key, btn] of Object.entries(hand.buttons)) {
        buttons[key] = {
          pressed: btn.pressed,
          touched: btn.touched,
          value: Number(btn.value.toFixed(3)),
        };
      }

      hands[role] = {
        pose: {
          position: VRTraceConversions.vectorToTrace(hand.pose.position) ?? { x: 0, y: 0, z: 0 },
          orientation: VRTraceConversions.quaternionToTrace(hand.pose.orientation),
          linearVelocity: VRTraceConversions.vectorToTrace(hand.pose.linearVelocity),
          angularVelocity: VRTraceConversions.vectorToTrace(hand.pose.angularVelocity),
          trackingState: hand.pose.trackingState,
        },
        targetRayPose: {
          position: VRTraceConversions.vectorToTrace(hand.targetRayPose.position) ?? { x: 0, y: 0, z: 0 },
          orientation: VRTraceConversions.quaternionToTrace(hand.targetRayPose.orientation),
          linearVelocity: VRTraceConversions.vectorToTrace(hand.targetRayPose.linearVelocity),
          angularVelocity: VRTraceConversions.vectorToTrace(hand.targetRayPose.angularVelocity),
          trackingState: hand.targetRayPose.trackingState,
        },
        buttons,
        axes: hand.axes.map((a) => Number(a.toFixed(3))),
        interactionProfile: hand.interactionProfile,
      };
    }

    const markers = this.pendingMarkers.length > 0 ? [...this.pendingMarkers] : undefined;
    this.pendingMarkers = [];

    this.frames.push({
      timeMs,
      head: headPose,
      hands,
      activeInteractionProfiles: inputFrame.activeInteractionProfiles.length > 0
        ? [...inputFrame.activeInteractionProfiles]
        : undefined,
      markers,
    });

    return true;
  }

  stop(engineTimestamp?: number): VRTraceRecording {
    this.recording = false;
    const finalDurationMs = engineTimestamp != null && engineTimestamp >= this.startTimestamp
      ? engineTimestamp - this.startTimestamp
      : (this.frames.length > 0 ? this.frames[this.frames.length - 1].timeMs : 0);

    const recording: VRTraceRecording = {
      version: 1,
      metadata: {
        title: this.initialMetadata.title ?? 'kotor2-vr-session',
        recordedAt: this.initialMetadata.recordedAt ?? new Date().toISOString(),
        durationMs: finalDurationMs,
        frameCount: this.frames.length,
        targetFps: this.frames.length > 1 && finalDurationMs > 0
          ? Math.round((this.frames.length / finalDurationMs) * 1000)
          : undefined,
        moduleName: this.initialMetadata.moduleName,
        dominantHand: this.initialMetadata.dominantHand,
        notes: this.initialMetadata.notes,
      },
      frames: [...this.frames],
    };

    return recording;
  }

  exportJson(engineTimestamp?: number, pretty = false): string {
    const recording = this.isRecording() ? this.stop(engineTimestamp) : this.buildCurrentRecording();
    return JSON.stringify(recording, null, pretty ? 2 : undefined);
  }

  private buildCurrentRecording(): VRTraceRecording {
    const finalDurationMs = this.frames.length > 0 ? this.frames[this.frames.length - 1].timeMs : 0;
    return {
      version: 1,
      metadata: {
        title: this.initialMetadata.title ?? 'kotor2-vr-session',
        recordedAt: this.initialMetadata.recordedAt ?? new Date().toISOString(),
        durationMs: finalDurationMs,
        frameCount: this.frames.length,
        moduleName: this.initialMetadata.moduleName,
        dominantHand: this.initialMetadata.dominantHand,
        notes: this.initialMetadata.notes,
      },
      frames: [...this.frames],
    };
  }
}
