import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Round 11 (G2): door opening had no audio in the headset although the sound
 * resolved and started. The audio listener was placed on the flatscreen follow
 * camera, which no headset movement drives; measured in a presenting session
 * it sat 3.3 m from the head and stayed where VR was entered.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('the VR audio listener is the headset', () => {
  const game = read('GameState.ts');
  const spike = read('vr/VRSpike.ts');

  test('the engine asks VR for the listener pose before falling back to the camera', () => {
    expect(game).toMatch(/if\(VRSpike\.getListenerPose\(vrAudioListenerPosition, vrAudioListenerForward\)\)\{\s*AudioEngine\.GetAudioEngine\(\)\.update\(delta, vrAudioListenerPosition/);
    expect(game).toMatch(/\}else\{\s*AudioEngine\.GetAudioEngine\(\)\.update\(delta, GameState\.currentCamera\.position/);
  });

  test('the head pose is mapped through the rig, not read from the parentless XR camera', () => {
    const at = spike.indexOf('static getListenerPose(');
    const body = spike.slice(at, spike.indexOf('private static readonly listenerRigQuaternion', at));
    expect(body).toContain('if (!VRSpike.isPresenting');
    expect(body).toContain('position.copy(xrCamera.position).applyMatrix4(rig.matrixWorld);');
    expect(body).not.toContain('xrCamera.getWorldPosition');
  });
});
