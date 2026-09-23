import * as THREE from 'three';
import {
  XRButtonState,
  XRHandInputFrame,
  XRHandRole,
  XRInputFrame,
  XRWorldPose,
} from '../XRTypes';
import {
  VRTraceButton,
  VRTraceConversions,
  VRTraceFrame,
  VRTraceHandFrame,
  VRTracePose,
  VRTraceRecording,
} from './VRTraceTypes';

export interface VRPlayerOptions {
  readonly loop?: boolean;
  readonly playbackSpeed?: number;
  readonly interpolatePoses?: boolean;
}

const DEFAULT_OPTIONS: Required<VRPlayerOptions> = {
  loop: false,
  playbackSpeed: 1.0,
  interpolatePoses: true,
};

/** Replays serialized WebXR traces back into typed runtime XRInputFrames. */
export class VRTracePlayer {
  private recording: VRTraceRecording | null = null;
  private options: Required<VRPlayerOptions> = { ...DEFAULT_OPTIONS };
  private playing = false;
  private startEngineTimestamp = 0;
  private currentPlaybackTimeMs = 0;
  private lastSampledFrameIndex = 0;
  private processedMarkerIndices = new Set<number>();

  public onMarker?: (marker: string, timeMs: number) => void;
  public onFinished?: () => void;

  constructor(recording?: VRTraceRecording, options?: VRPlayerOptions) {
    if (recording) this.load(recording, options);
  }

  load(recording: VRTraceRecording, options: VRPlayerOptions = {}): void {
    if (!recording || recording.version !== 1 || !Array.isArray(recording.frames)) {
      throw new TypeError('Invalid VRTraceRecording format');
    }
    this.recording = recording;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.stop();
  }

  play(startEngineTimestamp = 0, options: VRPlayerOptions = {}): void {
    if (!this.recording || this.recording.frames.length === 0) {
      throw new Error('Cannot play: no trace frames loaded');
    }
    this.options = { ...this.options, ...options };
    this.startEngineTimestamp = startEngineTimestamp;
    this.currentPlaybackTimeMs = 0;
    this.lastSampledFrameIndex = 0;
    this.processedMarkerIndices.clear();
    this.playing = true;
  }

  stop(): void {
    this.playing = false;
    this.currentPlaybackTimeMs = 0;
    this.lastSampledFrameIndex = 0;
    this.processedMarkerIndices.clear();
  }

  pause(): void {
    this.playing = false;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  getRecording(): VRTraceRecording | null {
    return this.recording;
  }

  getProgress(): { timeMs: number; durationMs: number; percent: number; frameIndex: number } {
    if (!this.recording || this.recording.frames.length === 0) {
      return { timeMs: 0, durationMs: 0, percent: 0, frameIndex: 0 };
    }
    const duration = this.recording.metadata.durationMs || this.recording.frames[this.recording.frames.length - 1].timeMs;
    const percent = duration > 0 ? Math.min(100, (this.currentPlaybackTimeMs / duration) * 100) : 0;
    return {
      timeMs: this.currentPlaybackTimeMs,
      durationMs: duration,
      percent,
      frameIndex: this.lastSampledFrameIndex,
    };
  }

  sample(engineTimestamp: number): XRInputFrame | null {
    if (!this.playing || !this.recording || this.recording.frames.length === 0) {
      return null;
    }

    const elapsedMs = Math.max(0, (engineTimestamp - this.startEngineTimestamp) * this.options.playbackSpeed);
    const duration = this.recording.metadata.durationMs || this.recording.frames[this.recording.frames.length - 1].timeMs;

    if (elapsedMs > duration) {
      if (this.options.loop && duration > 0) {
        this.startEngineTimestamp = engineTimestamp;
        this.currentPlaybackTimeMs = 0;
        this.lastSampledFrameIndex = 0;
        this.processedMarkerIndices.clear();
      } else {
        this.playing = false;
        this.onFinished?.();
        return null;
      }
    } else {
      this.currentPlaybackTimeMs = elapsedMs;
    }

    const frames = this.recording.frames;
    let idx = this.findFrameIndex(elapsedMs);
    this.lastSampledFrameIndex = idx;

    const currentFrame = frames[idx];
    const nextFrame = frames[idx + 1] ?? currentFrame;

    // Check for any markers on current frame
    if (currentFrame.markers && !this.processedMarkerIndices.has(idx)) {
      this.processedMarkerIndices.add(idx);
      for (const m of currentFrame.markers) {
        this.onMarker?.(m, currentFrame.timeMs);
      }
    }

    const alpha = (nextFrame.timeMs > currentFrame.timeMs && this.options.interpolatePoses)
      ? Math.max(0, Math.min(1, (elapsedMs - currentFrame.timeMs) / (nextFrame.timeMs - currentFrame.timeMs)))
      : 0;

    const head = this.interpolatePose(currentFrame.head, nextFrame.head, alpha);

    const hands: Partial<Record<XRHandRole, XRHandInputFrame>> = {};
    for (const role of ['left', 'right'] as const) {
      const currentHand = currentFrame.hands[role];
      const nextHand = nextFrame.hands[role];
      if (!currentHand) continue;

      const handPose = nextHand && this.options.interpolatePoses
        ? this.interpolatePose(currentHand.pose, nextHand.pose, alpha)
        : this.convertPose(currentHand.pose);

      const targetRayPose = currentHand.targetRayPose
        ? (nextHand?.targetRayPose && this.options.interpolatePoses
          ? this.interpolatePose(currentHand.targetRayPose, nextHand.targetRayPose, alpha)
          : this.convertPose(currentHand.targetRayPose))
        : handPose;

      const buttons: Record<string, XRButtonState> = {};
      for (const [key, btn] of Object.entries(currentHand.buttons)) {
        buttons[key] = {
          pressed: btn.pressed,
          touched: btn.touched,
          value: btn.value,
        };
      }

      hands[role] = {
        hand: role,
        pose: handPose,
        targetRayPose,
        buttons,
        axes: [...currentHand.axes],
        interactionProfile: currentHand.interactionProfile ?? null,
      };
    }

    return {
      timestamp: engineTimestamp,
      head,
      hands,
      activeInteractionProfiles: currentFrame.activeInteractionProfiles
        ? [...currentFrame.activeInteractionProfiles]
        : [],
    };
  }

  private findFrameIndex(timeMs: number): number {
    const frames = this.recording!.frames;
    if (frames.length <= 1) return 0;
    if (timeMs <= frames[0].timeMs) return 0;
    if (timeMs >= frames[frames.length - 1].timeMs) return frames.length - 1;

    // Linear search forward starting from last index, or fallback to binary search
    let start = this.lastSampledFrameIndex;
    if (start < frames.length - 1 && frames[start].timeMs <= timeMs && frames[start + 1].timeMs > timeMs) {
      return start;
    }

    let low = 0;
    let high = frames.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (frames[mid].timeMs <= timeMs) {
        if (mid === frames.length - 1 || frames[mid + 1].timeMs > timeMs) {
          return mid;
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }

  private convertPose(p: VRTracePose): XRWorldPose {
    return {
      position: VRTraceConversions.traceToVector(p.position) ?? new THREE.Vector3(),
      orientation: VRTraceConversions.traceToQuaternion(p.orientation),
      linearVelocity: VRTraceConversions.traceToVector(p.linearVelocity),
      angularVelocity: VRTraceConversions.traceToVector(p.angularVelocity),
      trackingState: p.trackingState ?? 'tracked',
    };
  }

  private interpolatePose(p0: VRTracePose, p1: VRTracePose, alpha: number): XRWorldPose {
    const v0 = VRTraceConversions.traceToVector(p0.position) ?? new THREE.Vector3();
    const v1 = VRTraceConversions.traceToVector(p1.position) ?? new THREE.Vector3();
    const pos = v0.clone().lerp(v1, alpha);

    const q0 = VRTraceConversions.traceToQuaternion(p0.orientation);
    const q1 = VRTraceConversions.traceToQuaternion(p1.orientation);
    const orient = q0.clone().slerp(q1, alpha);

    const lv0 = VRTraceConversions.traceToVector(p0.linearVelocity);
    const lv1 = VRTraceConversions.traceToVector(p1.linearVelocity);
    const linVel = lv0 && lv1 ? lv0.clone().lerp(lv1, alpha) : (lv0 ?? lv1);

    const av0 = VRTraceConversions.traceToVector(p0.angularVelocity);
    const av1 = VRTraceConversions.traceToVector(p1.angularVelocity);
    const angVel = av0 && av1 ? av0.clone().lerp(av1, alpha) : (av0 ?? av1);

    return {
      position: pos,
      orientation: orient,
      linearVelocity: linVel,
      angularVelocity: angVel,
      trackingState: p0.trackingState ?? 'tracked',
    };
  }
}
