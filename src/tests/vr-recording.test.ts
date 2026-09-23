import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import { XRHandRole, XRInputFrame } from '@/vr/runtime/XRTypes';
import { VRInputRecorder } from '@/vr/runtime/recording/VRInputRecorder';
import { VRTracePlayer } from '@/vr/runtime/recording/VRTracePlayer';
import { VRTraceConversions, VRTraceRecording } from '@/vr/runtime/recording/VRTraceTypes';

function createMockFrame(timestamp: number, posX: number, triggerValue: number = 0): XRInputFrame {
  return {
    timestamp,
    head: {
      position: new THREE.Vector3(0, 1.7, 0),
      orientation: new THREE.Quaternion(0, 0, 0, 1),
      linearVelocity: new THREE.Vector3(0, 0, 0),
      angularVelocity: new THREE.Vector3(0, 0, 0),
      trackingState: 'tracked',
    },
    hands: {
      right: {
        hand: 'right',
        pose: {
          position: new THREE.Vector3(posX, 1.2, -0.5),
          orientation: new THREE.Quaternion(0, 0, 0, 1),
          linearVelocity: new THREE.Vector3(0.5, 0, 0),
          angularVelocity: null,
          trackingState: 'tracked',
        },
        targetRayPose: {
          position: new THREE.Vector3(posX, 1.2, -0.5),
          orientation: new THREE.Quaternion(0, 0, 0, 1),
          linearVelocity: null,
          angularVelocity: null,
          trackingState: 'tracked',
        },
        buttons: {
          trigger: { pressed: triggerValue > 0.5, touched: triggerValue > 0.1, value: triggerValue },
        },
        axes: [0, 0],
        interactionProfile: 'oculus-touch-v3',
      },
    },
    activeInteractionProfiles: ['oculus-touch-v3'],
  };
}

describe('VRTraceConversions', () => {
  test('converts Vector3 to trace and back', () => {
    const v = new THREE.Vector3(1.23456, -0.98765, 42.0);
    const trace = VRTraceConversions.vectorToTrace(v)!;
    expect(trace).toEqual({ x: 1.2346, y: -0.9877, z: 42 });

    const restored = VRTraceConversions.traceToVector(trace)!;
    expect(restored.x).toBeCloseTo(1.2346, 4);
    expect(restored.y).toBeCloseTo(-0.9877, 4);
    expect(restored.z).toBeCloseTo(42, 4);
  });

  test('converts Quaternion to trace and back', () => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
    const trace = VRTraceConversions.quaternionToTrace(q);
    const restored = VRTraceConversions.traceToQuaternion(trace);

    expect(restored.x).toBeCloseTo(q.x, 3);
    expect(restored.y).toBeCloseTo(q.y, 3);
    expect(restored.z).toBeCloseTo(q.z, 3);
    expect(restored.w).toBeCloseTo(q.w, 3);
  });
});

describe('VRInputRecorder & VRTracePlayer', () => {
  test('records frames and produces valid trace recording', () => {
    const recorder = new VRInputRecorder();
    expect(recorder.isRecording()).toBe(false);

    recorder.start({ title: 'test-recording', dominantHand: 'right' }, 1000);
    expect(recorder.isRecording()).toBe(true);

    recorder.recordFrame(createMockFrame(1000, 0.2, 0), 1000);
    recorder.addMarker('player:swing-start');
    recorder.recordFrame(createMockFrame(1016, 0.4, 0.8), 1016);
    recorder.recordFrame(createMockFrame(1033, 0.6, 1.0), 1033);

    const recording = recorder.stop(1033);
    expect(recorder.isRecording()).toBe(false);
    expect(recording.version).toBe(1);
    expect(recording.metadata.frameCount).toBe(3);
    expect(recording.metadata.durationMs).toBe(33);
    expect(recording.frames[0].timeMs).toBe(0);
    expect(recording.frames[1].timeMs).toBe(16);
    expect(recording.frames[1].markers).toContain('player:swing-start');
    expect(recording.frames[2].timeMs).toBe(33);
  });

  test('replays recorded frames with interpolation', () => {
    const recorder = new VRInputRecorder();
    recorder.start({}, 0);
    recorder.recordFrame(createMockFrame(0, 0.0, 0.0), 0);
    recorder.recordFrame(createMockFrame(100, 1.0, 1.0), 100);
    const recording = recorder.stop(100);

    const player = new VRTracePlayer();
    player.load(recording);
    expect(player.isPlaying()).toBe(false);

    player.play(500); // engine starts playback at timestamp 500
    expect(player.isPlaying()).toBe(true);

    // Sample exactly midway at timestamp 550 (elapsed 50ms)
    const midFrame = player.sample(550);
    expect(midFrame).not.toBeNull();
    const rightHand = midFrame!.hands.right!;
    expect(rightHand).toBeDefined();

    // Position X should be interpolated between 0.0 and 1.0 -> ~0.5
    expect(rightHand.pose.position.x).toBeCloseTo(0.5, 2);

    // Sample at completion (timestamp 600, elapsed 100ms)
    const endFrame = player.sample(600);
    expect(endFrame).not.toBeNull();
    expect(endFrame!.hands.right!.pose.position.x).toBeCloseTo(1.0, 2);

    // Sample past duration
    const pastFrame = player.sample(650);
    expect(pastFrame).toBeNull();
    expect(player.isPlaying()).toBe(false);
  });

  test('notifies markers during replay', () => {
    const recorder = new VRInputRecorder();
    recorder.start({}, 0);
    recorder.addMarker('checkpoint:alpha');
    recorder.recordFrame(createMockFrame(0, 0.0), 0);
    recorder.addMarker('checkpoint:beta');
    recorder.recordFrame(createMockFrame(50, 0.5), 50);
    const recording = recorder.stop(50);

    const player = new VRTracePlayer(recording);
    const markersSeen: string[] = [];
    player.onMarker = (m) => markersSeen.push(m);

    player.play(0);
    player.sample(0);
    expect(markersSeen).toEqual(['checkpoint:alpha']);

    player.sample(50);
    expect(markersSeen).toEqual(['checkpoint:alpha', 'checkpoint:beta']);
  });
});
