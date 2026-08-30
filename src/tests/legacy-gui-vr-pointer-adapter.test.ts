import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  LegacyGUIVRPointerAdapter,
  LegacyGUIVRPointerControl,
} from '@/vr/runtime/LegacyGUIVRPointerAdapter';

describe('LegacyGUIVRPointerAdapter', () => {
  test('updates all legacy mouse coordinate spaces from centered panel coordinates', () => {
    let pointerVisible = false;
    let coordinates: {
      readonly ui: THREE.Vector2;
      readonly viewport: THREE.Vector2;
      readonly normalized: THREE.Vector2;
    } | null = null;
    const adapter = new LegacyGUIVRPointerAdapter({
      getViewportSize: () => ({ width: 1600, height: 900 }),
      getControlsAtPointer: () => [],
      setPointerVisible: (visible) => { pointerVisible = visible; },
      applyPointerCoordinates: (nextCoordinates) => { coordinates = nextCoordinates; },
    });

    adapter.setPointerPosition(new THREE.Vector2(400, -225));

    expect(coordinates!.ui.toArray()).toEqual([400, -225]);
    expect(coordinates!.viewport.toArray()).toEqual([1200, 675]);
    expect(coordinates!.normalized.toArray()).toEqual([0.5, -0.5]);
    expect(pointerVisible).toBe(true);
  });

  test('activates only the topmost visible clickable control under the pointer', () => {
    const hidden = control({ visible: false, clickable: true });
    const topmost = control({ visible: true, clickable: true });
    const behind = control({ visible: true, clickable: true });
    const adapter = new LegacyGUIVRPointerAdapter({
      getViewportSize: () => ({ width: 1600, height: 900 }),
      getControlsAtPointer: () => [hidden, topmost, behind],
      setPointerVisible: () => undefined,
      applyPointerCoordinates: () => undefined,
    });
    adapter.setPointerPosition(new THREE.Vector2(0, 0));

    expect(adapter.activatePointer()).toBe(true);
    expect(hidden.activationCount).toBe(0);
    expect(topmost.activationCount).toBe(1);
    expect(behind.activationCount).toBe(0);
  });

  test('activates the semantic list row before an overlapping generic control', () => {
    const generic = control({ visible: true, clickable: true });
    const row = control({ visible: true, clickable: true });
    let selected = 0;
    const adapter = new LegacyGUIVRPointerAdapter({
      getViewportSize: () => ({ width: 1600, height: 900 }),
      getControlsAtPointer: () => [generic],
      getSemanticTargetsAtPointer: () => [{
        name: 'LB_REPLIES row 2',
        control: row,
        isAvailable: () => true,
        activate: () => { selected += 1; },
      }],
      setPointerVisible: () => undefined,
      applyPointerCoordinates: () => undefined,
    });
    adapter.setPointerPosition(new THREE.Vector2(0, 0));

    expect(adapter.activatePointer()).toBe(true);
    expect(selected).toBe(1);
    expect(generic.activationCount).toBe(0);
  });

  test('activates a semantic list scroll action without falling back to a generic scrollbar control', () => {
    const genericScrollbar = control({ visible: true, clickable: true });
    const list = control({ visible: true, clickable: true });
    let scrollDown = 0;
    const adapter = new LegacyGUIVRPointerAdapter({
      getViewportSize: () => ({ width: 1600, height: 900 }),
      getControlsAtPointer: () => [genericScrollbar],
      getSemanticTargetsAtPointer: () => [{
        name: 'LB_REPLIES scroll down',
        control: list,
        isAvailable: () => true,
        activate: () => { scrollDown += 1; },
      }],
      setPointerVisible: () => undefined,
      applyPointerCoordinates: () => undefined,
    });
    adapter.setPointerPosition(new THREE.Vector2(0, 0));

    expect(adapter.activatePointer()).toBe(true);
    expect(scrollDown).toBe(1);
    expect(genericScrollbar.activationCount).toBe(0);
  });

  test('hides the legacy cursor and rejects activation after the panel ray is cleared', () => {
    let pointerVisible = true;
    const target = control({ visible: true, clickable: true });
    const adapter = new LegacyGUIVRPointerAdapter({
      getViewportSize: () => ({ width: 1600, height: 900 }),
      getControlsAtPointer: () => [target],
      setPointerVisible: (visible) => { pointerVisible = visible; },
      applyPointerCoordinates: () => undefined,
    });

    adapter.setPointerPosition(null);

    expect(pointerVisible).toBe(false);
    expect(adapter.activatePointer()).toBe(false);
    expect(target.activationCount).toBe(0);
  });
});

function control(options: { visible: boolean; clickable: boolean }): LegacyGUIVRPointerControl & {
  activationCount: number;
} {
  return {
    activationCount: 0,
    name: 'CONTROL',
    isVisible: () => options.visible,
    isClickable: () => options.clickable,
    click(): void {
      this.activationCount += 1;
    },
  };
}
