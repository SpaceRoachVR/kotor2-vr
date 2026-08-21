import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  VRRadialIconLoader,
  VRRadialMenuHost,
} from '@/vr/runtime/VRRadialMenuHost';
import { VRRadialPresentation } from '@/vr/runtime/VRRadialMenuController';
import {
  paginateVRRadialItems,
  VRRadialActionItem,
  VRRadialMenuDefinition,
} from '@/vr/runtime/VRRadialMenuModel';
import { XRWorldPose } from '@/vr/runtime/XRTypes';

describe('VRRadialMenuHost', () => {
  let previousDocument: unknown;

  beforeEach(() => {
    previousDocument = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = createCanvasDocument();
  });

  afterEach(() => {
    (globalThis as { document?: unknown }).document = previousDocument;
    jest.restoreAllMocks();
  });

  test('places once 0.85m forward and 0.25m below the opening head pose', () => {
    const { host } = createHost();
    const menuDefinition = menu('root', [action('attack', 'Attack'), action('map', 'Map')]);
    const head = pose(new THREE.Vector3(1, 2, 1.7), new THREE.Quaternion());

    host.present(presentationFor(menuDefinition, 'attack'), head);
    const firstPosition = host.object.position.clone();
    const firstOrientation = host.object.quaternion.clone();
    host.present(
      presentationFor(menuDefinition, 'map'),
      pose(new THREE.Vector3(5, 5, 5), new THREE.Quaternion()),
    );

    expect(host.object.position).toEqual(firstPosition);
    expect(host.object.quaternion.equals(firstOrientation)).toBe(true);
    expect(firstPosition.z).toBeCloseTo(1.45);
    expect(firstPosition.distanceTo(new THREE.Vector3(1, 2, 1.45))).toBeCloseTo(0.85);
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(firstOrientation);
    const horizontalHead = new THREE.Vector3(head.position.x, head.position.y, firstPosition.z);
    expect(facing.dot(horizontalHead.sub(firstPosition).normalize())).toBeGreaterThan(0.999);

    host.clear();
    host.present(presentationFor(menuDefinition, null), pose(new THREE.Vector3(5, 5, 5), new THREE.Quaternion()));
    expect(host.object.position).not.toEqual(firstPosition);
    host.dispose();
  });

  test('extrudes only the hovered wedge with high contrast and maps ray and touch through the shared layout', () => {
    const { host, scene } = createHost();
    host.present(
      presentationFor(menu('root', [action('attack', 'Attack'), action('map', 'Map')]), 'attack'),
      headPose(),
    );

    const attackWedge = host.getWedge('attack');
    const mapWedge = host.getWedge('map');
    expect(attackWedge.position.z).toBeCloseTo(0.025);
    expect(mapWedge.position.z).toBe(0);
    expect(attackWedge.material.color.getHex()).toBe(0x9a6819);
    expect(attackWedge.material.opacity).toBeCloseTo(0.96);
    expect(mapWedge.material.color.getHex()).toBe(0x13252c);
    expect(mapWedge.material.opacity).toBeCloseTo(0.92);
    const attackBorder = attackWedge.getObjectByName('Kotor2VR.RadialMenu.Border.attack') as THREE.Line;
    expect((attackBorder.material as THREE.LineBasicMaterial).color.getHex()).toBe(0xffd15c);

    const hit = host.resolveRay(rayAtLocalPoint(host, new THREE.Vector3(0, 0.2, 0)));
    expect(hit).toEqual({ kind: 'entry', index: 0 });
    expect(host.resolveTouch(host.object.localToWorld(new THREE.Vector3(0, 0.2, 0.04)))).toEqual({ kind: 'entry', index: 0 });
    expect(scene.getObjectByName('Kotor2VR.RadialMenu.Pointer')?.visible).toBe(true);
    expect(host.object.getObjectByName('Kotor2VR.RadialMenu.CollisionRing')?.visible).toBe(true);

    expect(host.resolveRay(rayAtLocalPoint(host, new THREE.Vector3(0.5, 0, 0)))).toBeNull();
    expect(scene.getObjectByName('Kotor2VR.RadialMenu.Pointer')?.visible).toBe(true);
    expect(host.object.getObjectByName('Kotor2VR.RadialMenu.CollisionRing')?.visible).toBe(false);
    host.dispose();
  });

  test('renders category fallbacks, the cancel symbol, plaque, page indicator, and transparent collision disc', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const iconLoader: VRRadialIconLoader = { load: jest.fn(async () => null) };
    const { host } = createHost(iconLoader);
    const actions = [
      action('attack', 'Attack', 'missing-icon'),
      action('map', 'Map', 'missing-icon'),
      action('inventory', 'Inventory'),
      action('character', 'Character'),
      action('force', 'Force Storm'),
      action('medpac', 'Advanced Medpac'),
      action('party', 'Party'),
    ];
    const menuDefinition = menu('root', actions);

    host.present(presentationFor(menuDefinition, null), headPose());
    await flushPromises();

    expect(host.getIconMaterial('attack').map).toBeTruthy();
    expect(host.getIconMaterial('map').map).toBeTruthy();
    expect(host.getIconMaterial('attack').map).not.toBe(host.getIconMaterial('map').map);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(host.object.getObjectByName('Kotor2VR.RadialMenu.CancelSymbol')).toBeTruthy();
    expect(host.object.getObjectByName('Kotor2VR.RadialMenu.Plaque')).toBeTruthy();
    expect(host.object.getObjectByName('Kotor2VR.RadialMenu.PageIndicator')?.visible).toBe(true);
    const collisionDisc = host.object.getObjectByName('Kotor2VR.RadialMenu.CollisionDisc') as THREE.Mesh;
    expect((collisionDisc.material as THREE.MeshBasicMaterial).opacity).toBe(0);
    host.dispose();
  });

  test('ignores a stale asynchronous icon load and disposes every owned resource', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const deferred = createDeferred<THREE.Texture | null>();
    const iconLoader: VRRadialIconLoader = {
      load: jest.fn((resref: string) => resref === 'icon-a' ? deferred.promise : Promise.resolve(null)),
    };
    const { host, scene } = createHost(iconLoader);
    host.present(presentationFor(menu('menu-a', [action('a', 'Attack', 'icon-a')]), 'a'), headPose());
    host.clear();
    host.present(presentationFor(menu('menu-b', [action('b', 'Map', 'icon-b')]), 'b'), headPose());
    const staleTexture = new THREE.Texture();
    deferred.resolve(staleTexture);
    await flushPromises();

    expect(host.getIconMaterial('b').map).not.toBe(staleTexture);

    const staleDispose = jest.spyOn(staleTexture, 'dispose');
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    scene.traverse((object) => {
      const renderable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry; material?: THREE.Material | THREE.Material[] };
      if (renderable.geometry) geometries.add(renderable.geometry);
      const objectMaterials = Array.isArray(renderable.material) ? renderable.material : renderable.material ? [renderable.material] : [];
      objectMaterials.forEach((material) => {
        materials.add(material);
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) textures.add(map);
      });
    });
    const geometryDisposals = [...geometries].map((geometry) => jest.spyOn(geometry, 'dispose'));
    const materialDisposals = [...materials].map((material) => jest.spyOn(material, 'dispose'));
    const textureDisposals = [...textures].map((texture) => jest.spyOn(texture, 'dispose'));

    host.dispose();

    expect(host.object.parent).toBeNull();
    expect(scene.getObjectByName('Kotor2VR.RadialMenu.Pointer')).toBeUndefined();
    geometryDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    materialDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    textureDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
    expect(staleDispose).toHaveBeenCalledTimes(1);
  });

  test('bounds the resolved icon cache at 64 textures and never disposes an evicted texture twice', async () => {
    const loadedTextures: THREE.Texture[] = [];
    const iconLoader: VRRadialIconLoader = {
      load: async (resref: string) => {
        const texture = new THREE.Texture();
        texture.name = resref;
        loadedTextures.push(texture);
        return texture;
      },
    };
    const { host } = createHost(iconLoader);

    host.present(
      presentationFor(menu('menu-0', [action('item-0', 'Item 0', 'icon-0')]), null),
      headPose(),
    );
    await flushPromises();
    const firstDispose = jest.spyOn(loadedTextures[0], 'dispose');

    for (let index = 1; index < 65; index += 1) {
      host.present(
        presentationFor(menu(`menu-${index}`, [action(`item-${index}`, `Item ${index}`, `icon-${index}`)]), null),
        headPose(),
      );
      await flushPromises();
    }
    expect(loadedTextures).toHaveLength(65);
    expect(firstDispose).toHaveBeenCalledTimes(1);
    host.dispose();
    expect(firstDispose).toHaveBeenCalledTimes(1);
  });

  test('fails closed when presentation, head, ray, or touch poses contain non-finite coordinates', () => {
    const { host } = createHost();
    const validPresentation = presentationFor(menu('root', [action('attack', 'Attack')]), null);
    host.present(validPresentation, headPose());
    expect(host.object.visible).toBe(true);

    expect(() => host.present(validPresentation, pose(new THREE.Vector3(Number.NaN, 0, 0), new THREE.Quaternion()))).not.toThrow();
    expect(host.object.visible).toBe(false);

    host.present(validPresentation, headPose());
    expect(host.resolveRay(pose(new THREE.Vector3(), new THREE.Quaternion(Number.NaN, 0, 0, 1)))).toBeNull();
    expect(host.object.visible).toBe(false);

    host.present(validPresentation, headPose());
    expect(host.resolveTouch(new THREE.Vector3(Number.NaN, 0, 0))).toBeNull();
    expect(host.object.visible).toBe(false);
    host.dispose();
  });
});

function createHost(iconLoader: VRRadialIconLoader = { load: async () => null }): { host: VRRadialMenuHost; scene: THREE.Scene } {
  const scene = new THREE.Scene();
  return { host: new VRRadialMenuHost(scene, iconLoader), scene };
}

function action(id: string, label: string, icon?: string): VRRadialActionItem {
  return { kind: 'action', id, label, icon, revalidate: () => true, activate: () => undefined };
}

function menu(id: string, actions: readonly VRRadialActionItem[]): VRRadialMenuDefinition {
  return { id, title: 'Action Wheel', pages: paginateVRRadialItems(actions) };
}

function presentationFor(
  menuDefinition: VRRadialMenuDefinition,
  hoveredId: string | 'cancel' | null,
  pageIndex = 0,
): VRRadialPresentation {
  return {
    menu: menuDefinition,
    pageIndex,
    page: menuDefinition.pages[pageIndex],
    hoveredId,
  };
}

function headPose(): XRWorldPose {
  return pose(new THREE.Vector3(0, 0, 1.7), new THREE.Quaternion());
}

function rayAtLocalPoint(host: VRRadialMenuHost, localPoint: THREE.Vector3): XRWorldPose {
  host.object.updateWorldMatrix(true, false);
  const origin = localPoint.clone();
  origin.z = 1;
  host.object.localToWorld(origin);
  return pose(origin, host.object.getWorldQuaternion(new THREE.Quaternion()));
}

function pose(position: THREE.Vector3, orientation: THREE.Quaternion): XRWorldPose {
  return { position, orientation, linearVelocity: null, angularVelocity: null, trackingState: 'tracked' };
}

function createDeferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function createCanvasDocument(): Document {
  return {
    createElement: () => {
      const context = new Proxy<Record<PropertyKey, unknown>>({}, {
        get(target, property) {
          if (property === 'measureText') return () => ({ width: 0 });
          if (!(property in target)) target[property] = jest.fn();
          return target[property];
        },
        set(target, property, value) {
          target[property] = value;
          return true;
        },
      });
      return { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
    },
  } as unknown as Document;
}
