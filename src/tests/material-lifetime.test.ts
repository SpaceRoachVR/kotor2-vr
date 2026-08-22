import { describe, expect, jest, test } from '@jest/globals';
import { TextureLifetimeRegistry } from '@/loaders/TextureResolution';

function disposableTexture(name: string) {
  return { name, dispose: jest.fn() };
}

describe('TextureLifetimeRegistry', () => {
  test('disposes the departing module generation without destroying shared GUI resources', () => {
    const registry = new TextureLifetimeRegistry<ReturnType<typeof disposableTexture>>();
    const moduleTexture = disposableTexture('module-wall');
    const guiTexture = disposableTexture('shared-gui');
    const generation = registry.currentGeneration;
    registry.set('module-wall', moduleTexture, 'module', generation);
    registry.set('shared-gui', guiTexture, 'shared-gui', generation);

    const disposal = registry.disposeModuleGeneration(generation);

    expect(disposal).toEqual({ disposed: 1, nextGeneration: generation + 1 });
    expect(moduleTexture.dispose).toHaveBeenCalledTimes(1);
    expect(guiTexture.dispose).not.toHaveBeenCalled();
    expect(registry.get('module-wall')).toBeUndefined();
    expect(registry.get('shared-gui')).toBe(guiTexture);
  });

  test('does not dispose an object that is also retained by a shared cache entry', () => {
    const registry = new TextureLifetimeRegistry<ReturnType<typeof disposableTexture>>();
    const sharedObject = disposableTexture('shared-object');
    const generation = registry.currentGeneration;
    registry.set('module-alias', sharedObject, 'module', generation);
    registry.set('gui-alias', sharedObject, 'shared-gui', generation);

    registry.disposeModuleGeneration(generation);

    expect(sharedObject.dispose).not.toHaveBeenCalled();
    expect(registry.get('gui-alias')).toBe(sharedObject);
  });

  test('refuses to dispose a stale generation twice', () => {
    const registry = new TextureLifetimeRegistry<ReturnType<typeof disposableTexture>>();
    const texture = disposableTexture('module-wall');
    const generation = registry.currentGeneration;
    registry.set('module-wall', texture, 'module', generation);
    registry.disposeModuleGeneration(generation);

    expect(() => registry.disposeModuleGeneration(generation)).toThrow(
      `Texture generation ${generation} is not active`,
    );
    expect(texture.dispose).toHaveBeenCalledTimes(1);
  });
});
