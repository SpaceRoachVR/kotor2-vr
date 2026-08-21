import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
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
import { VRActionIconTextureLoader } from '@/vr/runtime/VRActionIconTextureCache';

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

  test('loads a real normalized KOTOR action texture instead of a text abbreviation', async () => {
    const texture = new THREE.Texture();
    const dispose = jest.spyOn(texture, 'dispose');
    const iconLoader: VRActionIconTextureLoader = {
      load: jest.fn(async () => texture),
    };
    const host = createPromptHost(iconLoader);
    const action = { ...promptAction('security'), icon: ' IAction_Sec ' };
    const model = promptModel('door', [action], new THREE.Vector3(0, 1, 1));

    host.present(presentation(model), headAt(new THREE.Vector3(0, 0, 1.7)), null);
    await flushPromises();

    expect(iconLoader.load).toHaveBeenCalledTimes(1);
    expect(iconLoader.load).toHaveBeenCalledWith('iaction_sec');
    expect(host.getIconMaterial('security').map).toBe(texture);
    expect(host.object.getObjectByName('Kotor2VR.WorldActionPrompt.Icon.security')).toBeDefined();

    host.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test('guards against stale icon loads when a prompt entry is replaced', async () => {
    const stale = deferred<THREE.Texture>();
    const staleTexture = new THREE.Texture();
    const replacementTexture = new THREE.Texture();
    const staleDispose = jest.spyOn(staleTexture, 'dispose');
    const replacementDispose = jest.spyOn(replacementTexture, 'dispose');
    const iconLoader: VRActionIconTextureLoader = {
      load: jest.fn((resref: string) => resref === 'old_icon'
        ? stale.promise
        : Promise.resolve(replacementTexture)),
    };
    const host = createPromptHost(iconLoader);
    const oldModel = promptModel('door', [
      { ...promptAction('security'), icon: 'old_icon' },
    ], new THREE.Vector3(0, 1, 1));
    const replacementModel = promptModel('door', [
      { ...promptAction('security'), icon: 'new_icon' },
    ], new THREE.Vector3(0, 1, 1));

    host.present(presentation(oldModel), headAt(new THREE.Vector3(0, 0, 1.7)), null);
    host.present(presentation(replacementModel), headAt(new THREE.Vector3(0, 0, 1.7)), null);
    await flushPromises();
    expect(host.getIconMaterial('security').map).toBe(replacementTexture);

    stale.resolve(staleTexture);
    await flushPromises();
    expect(host.getIconMaterial('security').map).toBe(replacementTexture);

    host.dispose();
    expect(staleDispose).toHaveBeenCalledTimes(1);
    expect(replacementDispose).toHaveBeenCalledTimes(1);
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

  test('maps the exact right UV edge to the final region while rejecting coordinates just outside', () => {
    const host = createPromptHost();
    const actions = Array.from({ length: 5 }, (_, index) => promptAction(`action-${index}`));
    const model = promptModel('door', actions, new THREE.Vector3(0, 1, 1));
    host.present(presentation(model, 0), headAt(new THREE.Vector3(0, 0, 1.7)), null);
    const rightPointer = (host as unknown as {
      pointers: Record<XRHandRole, { update: (target: unknown, pose: unknown, width: number, height: number) => unknown }>;
    }).pointers.right;
    const update = rightPointer.update;
    const pointerPose = rayAtNavigationRegion(host, 'next');

    rightPointer.update = () => ({ guiPosition: new THREE.Vector2(512, 0) });
    expect(host.resolveRay('right', pointerPose)).toBe('prompt:next');
    rightPointer.update = () => ({ guiPosition: new THREE.Vector2(512.001, 0) });
    expect(host.resolveRay('right', pointerPose)).toBeNull();
    rightPointer.update = update;
    host.dispose();
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

  test.each([
    'null-pages',
    'null-entry',
    'invalid-kind',
    'duplicate-ids',
    'malformed-callables',
  ] as const)('fails closed for malformed prompt structure: %s', (malformation) => {
    const host = createPromptHost();
    const model = promptModel('door', [promptAction('use')], new THREE.Vector3());
    host.present(presentation(model), headAt(new THREE.Vector3(0, -1, 1.7)), null);

    expect(() => host.present(
      malformedPresentation(model, malformation),
      headAt(new THREE.Vector3(0, -1, 1.7)),
      'use',
    )).not.toThrow();
    expect(host.object.visible).toBe(false);
    expect(host.hoveredId).toBeNull();
  });
});

function createPromptHost(iconLoader?: VRActionIconTextureLoader): VRWorldActionPromptHost {
  return new VRWorldActionPromptHost(new THREE.Scene(), iconLoader);
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
    revalidate: () => true,
    activate: (): void => undefined,
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
    quadraticCurveTo: (): void => undefined,
    closePath: (): void => undefined,
    arc: (): void => undefined,
    stroke: (): void => undefined,
    fill: (): void => undefined,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  } as unknown as CanvasRenderingContext2D;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

type PromptMalformation =
  | 'null-pages'
  | 'null-entry'
  | 'invalid-kind'
  | 'duplicate-ids'
  | 'malformed-callables';

function malformedPresentation(
  validModel: VRWorldActionPromptModel,
  malformation: PromptMalformation,
): VRWorldPromptPresentation {
  const validAction = {
    kind: 'action',
    id: 'use',
    label: 'Use',
    revalidate: () => true,
    activate: (): void => undefined,
  };
  const model = malformation === 'null-pages'
    ? { ...validModel, pages: null }
    : malformation === 'null-entry'
      ? { ...validModel, pages: [{ index: 0, entries: [null] }] }
      : malformation === 'invalid-kind'
        ? { ...validModel, pages: [{ index: 0, entries: [{ ...validAction, kind: 'unsupported' }] }] }
        : malformation === 'duplicate-ids'
          ? { ...validModel, pages: [{ index: 0, entries: [validAction, { ...validAction }] }] }
          : {
              ...validModel,
              pages: [{
                index: 0,
                entries: [{ ...validAction, revalidate: 'not-callable', activate: 'not-callable' }],
              }],
            };
  return {
    model,
    pageIndex: 0,
    page: Array.isArray(model.pages) ? model.pages[0] : undefined,
    hoveredId: null,
  } as unknown as VRWorldPromptPresentation;
}
