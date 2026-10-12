import { describe, expect, jest, test } from '@jest/globals';
jest.mock('@/GameState', () => ({ GameState: {} }));

import * as THREE from 'three';
import { MDLLoader } from '@/loaders';
import { ModuleItem } from '@/module/ModuleItem';
import { OdysseyModel3D } from '@/three/odyssey/OdysseyModel3D';

describe('equipped item model ownership', () => {
  test.each([false, true])('releases a previous item model even when attached=%s', async attached => {
    const previous = new OdysseyModel3D();
    const unsubscribe = jest.fn();
    (previous as any).sourceModelUnsubscribe = unsubscribe;
    if (attached) new THREE.Object3D().add(previous);
    const item = Object.create(ModuleItem.prototype) as ModuleItem;
    Object.assign(item, { model: previous, baseItem: undefined });
    const replacement = await item.loadModel();
    expect(replacement).not.toBe(previous);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(previous.parent).toBeNull();
    expect(item.model).toBe(replacement);
  });

  test('releases the old model if the replacement asset cannot be built', async () => {
    const previous = new OdysseyModel3D();
    const unsubscribe = jest.fn();
    (previous as any).sourceModelUnsubscribe = unsubscribe;
    const item = Object.create(ModuleItem.prototype) as ModuleItem;
    Object.assign(item, { model: previous, baseItem: { itemClass: 'w_blstrpstl', defaultModel: 'w_blstrpstl_001' },
      getModelVariation: () => 1, getTemplateResRef: () => 'laser', getTag: () => 'laser', id: 1, objectType: 17 });
    const load = jest.spyOn(MDLLoader.loader, 'load').mockRejectedValue(new Error('missing MDL'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await item.loadModel();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(item.model).not.toBe(previous);
      expect(warning).toHaveBeenCalled();
    } finally { load.mockRestore(); warning.mockRestore(); }
  });
});
