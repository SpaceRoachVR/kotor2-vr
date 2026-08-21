import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, test } from '@jest/globals';
import {
  VRWorldActionPromptHost,
  VRWorldPromptPresentation,
} from '@/vr/runtime/VRWorldActionPromptHost';
import {
  VRWorldActionPromptModel,
  VRWorldPromptAction,
  buildVRWorldPromptPages,
} from '@/vr/runtime/VRWorldActionPromptModel';
import { XRHandRole, XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRWorldActionPromptHost', () => {
  const originalDocument = globalThis.document;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: createCanvasDocument(),
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: originalDocument,
    });
  });

  test('anchors 0.12m below the target name and billboards toward the head every frame', () => {
    const host = createPromptHost();
    const model = promptModel('door', [promptAction('security')], new THREE.Vector3(1, 2, 1));

    host.present(presentation(model), headAt(new THREE.Vector3(1, 0, 1.7)), null);
    expect(host.object.position.toArray()).toEqual([1, 2, 1.2]);
    const firstQuaternion = host.object.quaternion.clone();

    host.present(presentation(model), headAt(new THREE.Vector3(3, 0, 1.7)), 'security');
    expect(host.object.quaternion.equals(firstQuaternion)).toBe(false);
    expect(host.hoveredId).toBe('security');
  });

  test('maps both controller rays to rectangular action IDs and highlights one', () => {
    const host = createPromptHost();
    const model = promptModel('door', [
      promptAction('security'), promptAction('bash'), promptAction('mine'),
    ], new THREE.Vector3(0, 1, 1));
    host.present(presentation(model), headAt(new THREE.Vector3(0, 0, 1.7)), 'security');

    expect(host.resolveRay('left', rayAtActionRegion(host, 0))).toBe('security');
    expect(host.resolveRay('right', rayAtActionRegion(host, 2))).toBe('mine');
    expect(host.hoveredId).toBe('security');
  });

  test('maps only present compact navigation controls and never exposes empty action slots', () => {
    const host = createPromptHost();
    const actions = Array.from({ length: 5 }, (_, index) => promptAction(`action-${index}`));
    const model = promptModel('door', actions, new THREE.Vector3(0, 1, 1));

    host.present(presentation(model, 0), headAt(new THREE.Vector3(0, 0, 1.7)), null);
    expect(host.resolveRay('left', rayAtNavigationRegion(host, 'previous'))).toBeNull();
    expect(host.resolveRay('left', rayAtNavigationRegion(host, 'next'))).toBe('prompt:next');

    host.present(presentation(model, 1), headAt(new THREE.Vector3(0, 0, 1.7)), null);
    expect(host.resolveRay('right', rayAtNavigationRegion(host, 'previous'))).toBe('prompt:previous');
    expect(host.resolveRay('right', rayAtActionRegion(host, 1))).toBeNull();
    expect(host.resolveRay('right', rayAtNavigationRegion(host, 'next'))).toBeNull();
  });

  test('clears both hand pointers and releases owned resources safely', () => {
    const scene = new THREE.Scene();
    const host = new VRWorldActionPromptHost(scene);
    const model = promptModel('door', [promptAction('security')], new THREE.Vector3(0, 1, 1));
    host.present(presentation(model), headAt(new THREE.Vector3(0, 0, 1.7)), null);
    host.resolveRay('left', rayAtActionRegion(host, 0));
    host.resolveRay('right', rayAtActionRegion(host, 0));

    host.clear();
    expect(host.object.visible).toBe(false);
    expect(scene.children.filter((child) => child.name.includes('VRPanelPointer') && child.visible))
      .toHaveLength(0);

    host.dispose();
    host.dispose();
    expect(scene.children).toHaveLength(0);
    expect(() => host.present(presentation(model), headAt(new THREE.Vector3()), null))
      .toThrow('disposed');
  });

  test('clears safely when a presentation loses its page', () => {
    const host = createPromptHost();
    const model = promptModel('door', [promptAction('use')], new THREE.Vector3());
    host.present(presentation(model), headAt(new THREE.Vector3(0, -1, 1.7)), null);
    const missingPage = {
      model: { ...model, pages: [] },
      pageIndex: 0,
      page: undefined,
      hoveredId: null,
    } as unknown as VRWorldPromptPresentation;

    expect(() => host.present(missingPage, headAt(new THREE.Vector3()), null)).not.toThrow();
    expect(host.object.visible).toBe(false);
  });
});

function createPromptHost(): VRWorldActionPromptHost {
  return new VRWorldActionPromptHost(new THREE.Scene());
}

function presentation(model: VRWorldActionPromptModel, pageIndex = 0): VRWorldPromptPresentation {
  return {
    model,
    pageIndex,
    page: model.pages[pageIndex],
    hoveredId: null,
  };
}

function promptModel(
  id: string,
  actions: readonly VRWorldPromptAction[],
  anchor: THREE.Vector3,
): VRWorldActionPromptModel {
  return { id, name: id, anchor, pages: buildVRWorldPromptPages(actions) };
}

function promptAction(id: string): VRWorldPromptAction {
  return {
    kind: 'action',
    id,
    label: id,
    icon: `icon-${id}`,
    revalidate: () => true,
    activate: () => undefined,
  };
}

function headAt(position: THREE.Vector3): XRWorldPose {
  return pose(position, new THREE.Quaternion());
}

function rayAtActionRegion(host: VRWorldActionPromptHost, index: number): XRWorldPose {
  return rayAtLocalPoint(host, new THREE.Vector3(-0.3 + index * 0.2, 0, 0));
}

function rayAtNavigationRegion(
  host: VRWorldActionPromptHost,
  direction: 'previous' | 'next',
): XRWorldPose {
  return rayAtLocalPoint(host, new THREE.Vector3(direction === 'previous' ? -0.39 : 0.39, 0, 0));
}

function rayAtLocalPoint(host: VRWorldActionPromptHost, localPoint: THREE.Vector3): XRWorldPose {
  host.object.updateWorldMatrix(true, false);
  const target = host.object.localToWorld(localPoint.clone());
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(host.object.getWorldQuaternion(new THREE.Quaternion()));
  const origin = target.clone().addScaledVector(normal, 1);
  const direction = target.clone().sub(origin).normalize();
  return pose(origin, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction));
}

function pose(position: THREE.Vector3, orientation: THREE.Quaternion): XRWorldPose {
  return {
    position,
    orientation,
    linearVelocity: null,
    angularVelocity: null,
    trackingState: 'tracked',
  };
}

function createCanvasDocument(): Document {
  return {
    createElement(tagName: string): HTMLCanvasElement {
      if (tagName !== 'canvas') throw new Error(`Unexpected element: ${tagName}`);
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => createCanvasContext(),
      };
      return canvas as unknown as HTMLCanvasElement;
    },
  } as unknown as Document;
}

function createCanvasContext(): CanvasRenderingContext2D {
  return {
    clearRect: (): void => undefined,
    fillRect: (): void => undefined,
    strokeRect: (): void => undefined,
    fillText: (): void => undefined,
    measureText: (text: string) => ({ width: text.length * 16 } as TextMetrics),
    beginPath: (): void => undefined,
    moveTo: (): void => undefined,
    lineTo: (): void => undefined,
    stroke: (): void => undefined,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}
