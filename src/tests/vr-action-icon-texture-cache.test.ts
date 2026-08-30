import * as THREE from 'three';
import { expect, jest, test } from '@jest/globals';
import {
  resolveVRActionIcon,
  VRActionIconFallbackFactory,
  VRActionIconTextureLoader,
  VROwnedActionIconTextureCache,
} from '@/vr/runtime/VRActionIconTextureCache';

test('normalizes real KOTOR resrefs and derives deterministic category fallbacks', () => {
  expect(resolveVRActionIcon({ id: 'engine:bash', label: 'Bash', icon: ' IATTACKR ' })).toEqual({
    resref: 'iattackr',
    fallbackCategory: 'attack',
  });
  expect(resolveVRActionIcon({ id: 'menu:map', label: 'Area Map' })).toEqual({
    resref: null,
    fallbackCategory: 'map',
  });
  expect(resolveVRActionIcon({ id: 'unknown', label: 'Unknown Action' })).toEqual({
    resref: null,
    fallbackCategory: 'generic',
  });
});

test('caches a failed resref and returns one deterministic fallback with one diagnostic', async () => {
  const fallback = new THREE.Texture();
  const loader: VRActionIconTextureLoader = { load: jest.fn(async () => null) };
  const fallbackFactory: VRActionIconFallbackFactory = { create: jest.fn(() => fallback) };
  const logger = { warn: jest.fn() };
  const cache = new VROwnedActionIconTextureCache(loader, fallbackFactory, {
    capacity: 8,
    logger,
    ownerLabel: 'test',
  });
  const descriptor = resolveVRActionIcon({ id: 'engine:attack', label: 'Attack', icon: 'missing' });
  cache.setActiveDescriptors([descriptor]);

  await expect(cache.load(descriptor)).resolves.toBe(fallback);
  await expect(cache.load(descriptor)).resolves.toBe(fallback);

  expect(loader.load).toHaveBeenCalledTimes(1);
  expect(fallbackFactory.create).toHaveBeenCalledTimes(1);
  expect(logger.warn).toHaveBeenCalledTimes(1);
  cache.dispose();
});

test('evicts the least-recent inactive owned texture and drops its strong reference', async () => {
  const textures = new Map<string, THREE.Texture>();
  const loader: VRActionIconTextureLoader = {
    load: jest.fn(async (resref: string) => {
      const texture = new THREE.Texture();
      texture.name = resref;
      textures.set(resref, texture);
      return texture;
    }),
  };
  const cache = new VROwnedActionIconTextureCache(loader, fallbackFactory(), { capacity: 2 });
  const first = resolveVRActionIcon({ id: 'first', label: 'Attack', icon: 'first' });
  const second = resolveVRActionIcon({ id: 'second', label: 'Attack', icon: 'second' });
  const third = resolveVRActionIcon({ id: 'third', label: 'Attack', icon: 'third' });
  cache.setActiveDescriptors([first]);
  await cache.load(first);
  cache.setActiveDescriptors([second]);
  await cache.load(second);
  const firstDispose = jest.spyOn(textures.get('first')!, 'dispose');
  cache.setActiveDescriptors([third]);
  await cache.load(third);

  expect(firstDispose).toHaveBeenCalledTimes(1);
  expect(cacheRetainsTexture(cache, textures.get('first')!)).toBe(false);
  cache.dispose();
  expect(firstDispose).toHaveBeenCalledTimes(1);
});

test('disposes a late texture after cache disposal without retaining it', async () => {
  const deferred = createDeferred<THREE.Texture | null>();
  const loader: VRActionIconTextureLoader = { load: () => deferred.promise };
  const cache = new VROwnedActionIconTextureCache(loader, fallbackFactory(), { capacity: 8 });
  const descriptor = resolveVRActionIcon({ id: 'late', label: 'Attack', icon: 'late' });
  cache.setActiveDescriptors([descriptor]);
  const pending = cache.load(descriptor);
  const lateTexture = new THREE.Texture();
  const dispose = jest.spyOn(lateTexture, 'dispose');

  cache.dispose();
  deferred.resolve(lateTexture);

  await expect(pending).rejects.toThrow('disposed');
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(cacheRetainsTexture(cache, lateTexture)).toBe(false);
});

function fallbackFactory(): VRActionIconFallbackFactory {
  return { create: () => new THREE.Texture() };
}

function cacheRetainsTexture(cache: VROwnedActionIconTextureCache, texture: THREE.Texture): boolean {
  return Object.values(cache as unknown as Record<string, unknown>).some((value) =>
    value instanceof Map && [...value.values()].some((entry) => entry === texture ||
      (typeof entry === 'object' && entry !== null && Object.values(entry).includes(texture)))
  );
}

function createDeferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => { resolvePromise = resolve; });
  return { promise, resolve: resolvePromise };
}
