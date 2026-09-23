import * as THREE from 'three';
import { XRHandRole, XRInputFrame, XRWorldPose } from '../XRTypes';
import {
  GestureDefinition,
  GestureDirection,
  GestureRecognitionResult,
  GestureTrajectorySample,
} from './VRGestureTypes';

export interface VRGestureStateMachineOptions {
  readonly historyWindowMs?: number;
  readonly defaultDirectionConeCosine?: number;
}

const DEFAULT_OPTIONS: Required<VRGestureStateMachineOptions> = {
  historyWindowMs: 350,
  defaultDirectionConeCosine: 0.55,
};

/**
 * Composable, multi-gesture state machine recognizing physical gestures
 * (swings, flicks, thrusts, two-handed poses) from continuous WebXR input frames.
 */
export class VRGestureStateMachine {
  private readonly options: Required<VRGestureStateMachineOptions>;
  private readonly gestures = new Map<string, GestureDefinition>();
  private readonly gestureCooldowns = new Map<string, number>();

  private readonly trajectoryHistory: Record<XRHandRole, GestureTrajectorySample[]> = {
    left: [],
    right: [],
  };

  private readonly lastSampleTime: Record<XRHandRole, number> = {
    left: Number.NEGATIVE_INFINITY,
    right: Number.NEGATIVE_INFINITY,
  };

  private readonly previousPositions: Record<XRHandRole, THREE.Vector3 | null> = {
    left: null,
    right: null,
  };

  constructor(options: VRGestureStateMachineOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  registerGesture(definition: GestureDefinition): void {
    if (!definition || !definition.id) throw new TypeError('GestureDefinition must have an id');
    if (this.gestures.has(definition.id)) {
      throw new Error(`Gesture '${definition.id}' is already registered`);
    }
    this.gestures.set(definition.id, definition);
  }

  unregisterGesture(id: string): boolean {
    this.gestureCooldowns.delete(id);
    return this.gestures.delete(id);
  }

  clearGestures(): void {
    this.gestures.clear();
    this.gestureCooldowns.clear();
  }

  reset(): void {
    this.trajectoryHistory.left = [];
    this.trajectoryHistory.right = [];
    this.previousPositions.left = null;
    this.previousPositions.right = null;
    this.lastSampleTime.left = Number.NEGATIVE_INFINITY;
    this.lastSampleTime.right = Number.NEGATIVE_INFINITY;
    this.gestureCooldowns.clear();
  }

  process(
    inputFrame: XRInputFrame,
    dominantHand: XRHandRole = 'right'
  ): readonly GestureRecognitionResult[] {
    if (!inputFrame) return [];
    const timestamp = inputFrame.timestamp;
    const offhandHand: XRHandRole = dominantHand === 'right' ? 'left' : 'right';

    // 1. Update trajectory history for active hands
    for (const role of ['left', 'right'] as const) {
      const hand = inputFrame.hands[role];
      if (!hand || hand.pose.trackingState === 'unavailable') {
        this.trajectoryHistory[role] = [];
        this.previousPositions[role] = null;
        continue;
      }

      let vel = hand.pose.linearVelocity;
      if (!vel) {
        // Derive velocity from delta position if runtime does not provide it
        const prevPos = this.previousPositions[role];
        const prevTime = this.lastSampleTime[role];
        const dt = (timestamp - prevTime) / 1000;
        if (prevPos && dt > 0.001 && dt < 0.2) {
          vel = hand.pose.position.clone().sub(prevPos).divideScalar(dt);
        } else {
          vel = new THREE.Vector3(0, 0, 0);
        }
      }

      this.previousPositions[role] = hand.pose.position.clone();
      this.lastSampleTime[role] = timestamp;

      const sample: GestureTrajectorySample = {
        position: hand.pose.position.clone(),
        orientation: hand.pose.orientation.clone(),
        velocity: vel.clone(),
        timestamp,
      };

      const history = this.trajectoryHistory[role];
      history.push(sample);

      // Prune history older than window
      const cutoff = timestamp - this.options.historyWindowMs;
      while (history.length > 0 && history[0].timestamp < cutoff) {
        history.shift();
      }
    }

    // 2. Evaluate all registered gestures
    const results: GestureRecognitionResult[] = [];

    for (const gesture of this.gestures.values()) {
      const cooldownUntil = this.gestureCooldowns.get(gesture.id) ?? Number.NEGATIVE_INFINITY;
      if (timestamp < cooldownUntil) continue;

      const targetHands: XRHandRole[] = [];
      if (gesture.handRequirement === 'dominant') targetHands.push(dominantHand);
      else if (gesture.handRequirement === 'offhand') targetHands.push(offhandHand);
      else if (gesture.handRequirement === 'either') {
        targetHands.push(dominantHand, offhandHand);
      } else if (gesture.handRequirement === 'both') {
        // Evaluate both hands simultaneously
        const res = this.evaluateBothHands(gesture, inputFrame, timestamp);
        if (res) {
          this.gestureCooldowns.set(gesture.id, timestamp + gesture.cooldownMilliseconds);
          results.push(res);
        }
        continue;
      }

      for (const handRole of targetHands) {
        const hand = inputFrame.hands[handRole];
        if (!hand || hand.pose.trackingState === 'unavailable') continue;

        // Modifier check
        if (!this.checkModifier(hand, gesture.requiredModifier)) continue;

        const history = this.trajectoryHistory[handRole];
        if (history.length === 0) continue;

        const latestSample = history[history.length - 1];
        const speed = latestSample.velocity.length();
        if (speed < gesture.minimumSpeedMetresPerSecond) continue;

        // Direction constraint check
        if (gesture.directionConstraint && gesture.directionConstraint !== 'any') {
          if (!this.checkDirection(gesture, latestSample.velocity, inputFrame.head)) {
            continue;
          }
        }

        // Custom evaluator if provided
        let customConfidence = 1.0;
        let customPayload: unknown = undefined;
        if (gesture.customEvaluator) {
          const evalRes = gesture.customEvaluator(history, inputFrame.head);
          if (!evalRes.valid) continue;
          if (evalRes.confidence !== undefined) customConfidence = evalRes.confidence;
          customPayload = evalRes.payload;
        }

        // Calculate peak speed over recent history
        let peakSpeed = speed;
        for (const s of history) {
          const sSpeed = s.velocity.length();
          if (sSpeed > peakSpeed) peakSpeed = sSpeed;
        }

        this.gestureCooldowns.set(gesture.id, timestamp + gesture.cooldownMilliseconds);

        results.push({
          gestureId: gesture.id,
          hand: handRole,
          phase: 'recognized',
          confidence: customConfidence,
          speedMetresPerSecond: speed,
          peakSpeedMetresPerSecond: peakSpeed,
          directionVector: latestSample.velocity.clone().normalize(),
          pose: {
            position: hand.pose.position.clone(),
            orientation: hand.pose.orientation.clone(),
            linearVelocity: hand.pose.linearVelocity?.clone() ?? null,
            angularVelocity: hand.pose.angularVelocity?.clone() ?? null,
            trackingState: hand.pose.trackingState,
          },
          timestamp,
          payload: customPayload,
        });

        break; // Recognized for this gesture
      }
    }

    return results;
  }

  private checkModifier(
    hand: NonNullable<XRInputFrame['hands'][XRHandRole]>,
    requiredModifier?: GestureDefinition['requiredModifier']
  ): boolean {
    if (!requiredModifier || requiredModifier === 'none') return true;

    if (requiredModifier === 'grip') {
      const gripBtn = hand.buttons['squeeze'] ?? hand.buttons['grip'] ?? hand.buttons['1'];
      return gripBtn ? gripBtn.pressed || gripBtn.value > 0.4 : false;
    }

    if (requiredModifier === 'trigger') {
      const trigBtn = hand.buttons['trigger'] ?? hand.buttons['0'];
      return trigBtn ? trigBtn.pressed || trigBtn.value > 0.4 : false;
    }

    if (requiredModifier === 'primary_button') {
      const btn = hand.buttons['a-button'] ?? hand.buttons['x-button'] ?? hand.buttons['4'];
      return btn ? btn.pressed : false;
    }

    return true;
  }

  private checkDirection(
    gesture: GestureDefinition,
    velocity: THREE.Vector3,
    head: XRWorldPose
  ): boolean {
    const velNorm = velocity.clone().normalize();
    const targetDir = this.resolveDirectionVector(gesture.directionConstraint!, head.orientation);
    const coneCosine = gesture.directionConeCosine ?? this.options.defaultDirectionConeCosine;

    return velNorm.dot(targetDir) >= coneCosine;
  }

  private resolveDirectionVector(
    constraint: GestureDirection,
    headOrientation: THREE.Quaternion
  ): THREE.Vector3 {
    switch (constraint) {
      case 'forward':
        return new THREE.Vector3(0, 0, -1).applyQuaternion(headOrientation).normalize();
      case 'backward':
        return new THREE.Vector3(0, 0, 1).applyQuaternion(headOrientation).normalize();
      case 'left':
        return new THREE.Vector3(-1, 0, 0).applyQuaternion(headOrientation).normalize();
      case 'right':
        return new THREE.Vector3(1, 0, 0).applyQuaternion(headOrientation).normalize();
      case 'up':
        return new THREE.Vector3(0, 1, 0);
      case 'down':
        return new THREE.Vector3(0, -1, 0);
      case 'any':
      default:
        return new THREE.Vector3(0, 0, 0);
    }
  }

  private evaluateBothHands(
    gesture: GestureDefinition,
    inputFrame: XRInputFrame,
    timestamp: number
  ): GestureRecognitionResult | null {
    const leftHand = inputFrame.hands['left'];
    const rightHand = inputFrame.hands['right'];
    if (!leftHand || !rightHand) return null;
    if (leftHand.pose.trackingState === 'unavailable' || rightHand.pose.trackingState === 'unavailable') return null;

    if (!this.checkModifier(leftHand, gesture.requiredModifier)) return null;
    if (!this.checkModifier(rightHand, gesture.requiredModifier)) return null;

    const leftHist = this.trajectoryHistory['left'];
    const rightHist = this.trajectoryHistory['right'];
    if (leftHist.length === 0 || rightHist.length === 0) return null;

    const leftSpeed = leftHist[leftHist.length - 1].velocity.length();
    const rightSpeed = rightHist[rightHist.length - 1].velocity.length();
    const avgSpeed = (leftSpeed + rightSpeed) / 2;

    if (avgSpeed < gesture.minimumSpeedMetresPerSecond) return null;

    if (gesture.directionConstraint && gesture.directionConstraint !== 'any') {
      if (!this.checkDirection(gesture, leftHist[leftHist.length - 1].velocity, inputFrame.head)) return null;
      if (!this.checkDirection(gesture, rightHist[rightHist.length - 1].velocity, inputFrame.head)) return null;
    }

    return {
      gestureId: gesture.id,
      hand: 'right', // Primary reporting hand
      phase: 'recognized',
      confidence: 1.0,
      speedMetresPerSecond: avgSpeed,
      peakSpeedMetresPerSecond: Math.max(leftSpeed, rightSpeed),
      directionVector: rightHist[rightHist.length - 1].velocity.clone().normalize(),
      pose: {
        position: rightHand.pose.position.clone(),
        orientation: rightHand.pose.orientation.clone(),
        linearVelocity: rightHand.pose.linearVelocity?.clone() ?? null,
        angularVelocity: rightHand.pose.angularVelocity?.clone() ?? null,
        trackingState: rightHand.pose.trackingState,
      },
      timestamp,
    };
  }
}
