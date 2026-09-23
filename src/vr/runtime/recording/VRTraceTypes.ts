import * as THREE from 'three';
import { XRHandRole, XRTrackingState } from '../XRTypes';

export interface VRTraceVector3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VRTraceQuaternion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

export interface VRTracePose {
  readonly position: VRTraceVector3;
  readonly orientation: VRTraceQuaternion;
  readonly linearVelocity?: VRTraceVector3 | null;
  readonly angularVelocity?: VRTraceVector3 | null;
  readonly trackingState?: XRTrackingState;
}

export interface VRTraceButton {
  readonly pressed: boolean;
  readonly touched: boolean;
  readonly value: number;
}

export interface VRTraceHandFrame {
  readonly pose: VRTracePose;
  readonly targetRayPose?: VRTracePose;
  readonly buttons: Readonly<Record<string, VRTraceButton>>;
  readonly axes: readonly number[];
  readonly interactionProfile?: string | null;
}

export interface VRTraceFrame {
  /** Relative offset in milliseconds from trace start. */
  readonly timeMs: number;
  readonly head: VRTracePose;
  readonly hands: Readonly<Partial<Record<XRHandRole, VRTraceHandFrame>>>;
  readonly activeInteractionProfiles?: readonly string[];
  /** Optional discrete event markers (e.g. 'weapon:swing', 'ui:click', 'checkpoint:reach'). */
  readonly markers?: readonly string[];
}

export interface VRTraceMetadata {
  readonly title?: string;
  readonly recordedAt: string;
  readonly durationMs: number;
  readonly frameCount: number;
  readonly targetFps?: number;
  readonly moduleName?: string;
  readonly dominantHand?: XRHandRole;
  readonly notes?: string;
}

export interface VRTraceRecording {
  readonly version: 1;
  readonly metadata: VRTraceMetadata;
  readonly frames: readonly VRTraceFrame[];
}

export class VRTraceConversions {
  static vectorToTrace(v: THREE.Vector3 | null | undefined): VRTraceVector3 | null {
    if (!v) return null;
    return {
      x: Number(v.x.toFixed(4)),
      y: Number(v.y.toFixed(4)),
      z: Number(v.z.toFixed(4)),
    };
  }

  static traceToVector(t: VRTraceVector3 | null | undefined, target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 | null {
    if (!t) return null;
    return target.set(t.x, t.y, t.z);
  }

  static quaternionToTrace(q: THREE.Quaternion): VRTraceQuaternion {
    return {
      x: Number(q.x.toFixed(4)),
      y: Number(q.y.toFixed(4)),
      z: Number(q.z.toFixed(4)),
      w: Number(q.w.toFixed(4)),
    };
  }

  static traceToQuaternion(t: VRTraceQuaternion, target: THREE.Quaternion = new THREE.Quaternion()): THREE.Quaternion {
    return target.set(t.x, t.y, t.z, t.w).normalize();
  }
}
