import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  VRWorldTargetLabelHost,
  VRWorldTargetLabelTextureRenderer,
} from '@/vr/runtime/VRWorldTargetLabelHost';

describe('VRWorldTargetLabelHost', () => {
  test('shows the target name above the existing world reticle anchor', () => {
    const scene = new THREE.Scene();
    const texture = new THREE.Texture();
    const textRenderer = new RecordingTextRenderer(texture);
    const host = new VRWorldTargetLabelHost(scene, textRenderer, {
      verticalOffsetMetres: 0.3,
    });

    host.update({ id: '42', name: 'Plasteel Cylinder', position: new THREE.Vector3(2, 3, 1) });

    expect(host.object.visible).toBe(true);
    expect(host.object.position.toArray()).toEqual([2, 3, 1.3]);
    expect(host.text).toBe('Plasteel Cylinder');
    expect(host.object.material.map).toBe(texture);
  });

  test('hides the label when no world target is available', () => {
    const host = new VRWorldTargetLabelHost(
      new THREE.Scene(),
      new RecordingTextRenderer(new THREE.Texture())
    );
    host.update({ id: '42', name: 'Console', position: new THREE.Vector3() });

    host.clear();

    expect(host.object.visible).toBe(false);
    expect(host.text).toBe('');
  });
});

class RecordingTextRenderer implements VRWorldTargetLabelTextureRenderer {
  constructor(private readonly texture: THREE.Texture) {}

  render(): THREE.Texture {
    return this.texture;
  }

  dispose(): void {}
}
