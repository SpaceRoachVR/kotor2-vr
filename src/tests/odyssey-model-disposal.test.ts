import { describe, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/loaders', () => ({
  MDLLoader: { loader: {} },
  TextureLoader: { disposeModelOwnedTexture: jest.fn() },
}));
jest.mock('@/loaders/MDLLoader', () => ({ MDLLoader: { loader: { load: jest.fn() } } }));

import * as THREE from 'three';
import { OdysseyModel3D } from '@/three/odyssey/OdysseyModel3D';
import { OdysseyEmitter3D } from '@/three/odyssey/OdysseyEmitter3D';
import { MDLLoader } from '@/loaders/MDLLoader';

// Build a resource graph without constructing a shader or queuing game assets.
// The lifecycle methods themselves are the real emitter implementation.
function createEmitter(): OdysseyEmitter3D {
  const emitter = Object.setPrototypeOf(new THREE.Object3D(), OdysseyEmitter3D.prototype) as OdysseyEmitter3D;
  Object.assign(emitter, {
    type: 'OdysseyEmitter', node: { chunkResRef: 'plc_chunkybit02', renderOrder: 0 },
    maxParticleCount: 1, geometry: new THREE.BufferGeometry(), material: new THREE.ShaderMaterial(),
    _chunkLoaded: false,
  });
  emitter.mesh = new THREE.Points(emitter.geometry, emitter.material) as never;
  emitter.add(emitter.mesh);
  return emitter;
}

describe('OdysseyModel3D resource disposal', () => {
  test('releases the bone texture owned by a skinned mesh on unload', () => {
    const model = new OdysseyModel3D();
    const skin = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    skin.skeleton = new THREE.Skeleton([new THREE.Bone()]);
    skin.skeleton.computeBoneTexture();
    const disposed = jest.fn();
    skin.skeleton.boneTexture.addEventListener('dispose', disposed);
    model.add(skin);
    model.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(skin.skeleton.boneTexture).toBeNull();
  });

  test('replacing a skeleton releases its old bone texture and updates shield borrowers', () => {
    const model = new OdysseyModel3D();
    const skin = new THREE.SkinnedMesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    const bone = new THREE.Bone();
    bone.name = 'bone';
    model.nodes.set('bone', bone as never);
    skin.userData.boneNames = ['bone'];
    skin.userData.odysseyModelNode = { bone_parts: [0], bone_inverse_matrix: [new THREE.Matrix4()] };
    skin.skeleton = new THREE.Skeleton([bone]);
    skin.skeleton.computeBoneTexture();
    const previous = skin.skeleton;
    const disposed = jest.fn();
    previous.boneTexture.addEventListener('dispose', disposed);
    const shield = new THREE.SkinnedMesh();
    shield.skeleton = previous;
    model.forceShieldGeometry.push(shield);
    model.skins.push(skin);
    model.buildSkeleton();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(skin.skeleton).not.toBe(previous);
    expect(shield.skeleton).toBe(skin.skeleton);
  });
  test('releases Points geometry and material when a model unloads', () => {
    const model = new OdysseyModel3D();
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.ShaderMaterial();
    const geometryDisposed = jest.fn();
    const materialDisposed = jest.fn();
    geometry.addEventListener('dispose', geometryDisposed);
    material.addEventListener('dispose', materialDisposed);
    model.add(new THREE.Points(geometry, material));

    model.dispose();

    expect(geometryDisposed).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toHaveBeenCalledTimes(1);
    expect(model.children).toHaveLength(0);
  });

  test('calls emitter cleanup once, including resources outside the sprite graph', () => {
    const model = new OdysseyModel3D();
    const emitter = createEmitter();
    model.emitters.push(emitter);
    model.add(emitter);
    const cleanup = jest.spyOn(emitter, 'dispose');
    const geometryDisposed = jest.fn();
    emitter.geometry.addEventListener('dispose', geometryDisposed);

    model.dispose();
    model.dispose();

    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(geometryDisposed).toHaveBeenCalledTimes(1);
  });

  test('nested models release their own subscription and emitter list', () => {
    const parent = new OdysseyModel3D();
    const child = new OdysseyModel3D();
    const unsubscribeParent = jest.fn();
    const unsubscribeChild = jest.fn();
    (parent as any).sourceModelUnsubscribe = unsubscribeParent;
    (child as any).sourceModelUnsubscribe = unsubscribeChild;
    const emitter = createEmitter();
    child.emitters.push(emitter);
    child.add(emitter);
    parent.add(child);

    parent.dispose();

    expect(unsubscribeParent).toHaveBeenCalledTimes(1);
    expect(unsubscribeChild).toHaveBeenCalledTimes(1);
    expect(child.emitters).toHaveLength(0);
    expect(child.children).toHaveLength(0);
  });

  test('releases a chunk source model and its change subscription on emitter unload', async () => {
    const emitter = createEmitter();
    const source = new OdysseyModel3D();
    source.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    const unsubscribe = jest.fn();
    (source as any).sourceModelUnsubscribe = unsubscribe;
    jest.mocked(MDLLoader.loader.load).mockResolvedValue({} as never);
    const build = jest.spyOn(OdysseyModel3D, 'FromMDL').mockResolvedValue(source);
    try {
      await (emitter as any).loadChunkModel();
      expect(unsubscribe).not.toHaveBeenCalled();
      const geometryDisposed = jest.fn();
      (emitter as any)._chunkGeometry.addEventListener('dispose', geometryDisposed);

      emitter.dispose();
      emitter.dispose();

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(geometryDisposed).toHaveBeenCalledTimes(1);
      expect(emitter.children).toHaveLength(0);
    } finally { build.mockRestore(); }
  });

  test('a chunk model completing after disposal is released instead of attached', async () => {
    const emitter = createEmitter();
    const source = new OdysseyModel3D();
    source.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    const unsubscribe = jest.fn();
    (source as any).sourceModelUnsubscribe = unsubscribe;
    let complete!: (model: OdysseyModel3D) => void;
    jest.mocked(MDLLoader.loader.load).mockResolvedValue({} as never);
    const build = jest.spyOn(OdysseyModel3D, 'FromMDL').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    try {
      const loading = (emitter as any).loadChunkModel();
      // Let the import and MDL promise resolve, holding only the model build.
      while (!complete) await Promise.resolve();
      emitter.dispose();
      complete(source);
      await loading;

      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(emitter.children).toHaveLength(0);
      expect((emitter as any)._chunkLoaded).toBe(false);
    } finally { build.mockRestore(); }
  });

  test('preserves material groups on a chunk mesh and releases every cloned material', async () => {
    const emitter = createEmitter();
    const source = new OdysseyModel3D();
    const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()];
    source.add(new THREE.Mesh(new THREE.BufferGeometry(), materials));
    jest.mocked(MDLLoader.loader.load).mockResolvedValue({} as never);
    const build = jest.spyOn(OdysseyModel3D, 'FromMDL').mockResolvedValue(source);
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await (emitter as any).loadChunkModel();
      expect((emitter as any)._chunkMesh?.material).toHaveLength(2);
      const disposals = (emitter as any)._chunkMaterial.map((material: THREE.Material) => {
        const listener = jest.fn(); material.addEventListener('dispose', listener); return listener;
      });
      emitter.dispose();
      for (const listener of disposals) expect(listener).toHaveBeenCalledTimes(1);
      expect(warning).not.toHaveBeenCalled();
    } finally { build.mockRestore(); warning.mockRestore(); }
  });

  test('releases the temporary source when it has no renderable mesh', async () => {
    const emitter = createEmitter();
    const source = new OdysseyModel3D();
    const unsubscribe = jest.fn();
    (source as any).sourceModelUnsubscribe = unsubscribe;
    jest.mocked(MDLLoader.loader.load).mockResolvedValue({} as never);
    const build = jest.spyOn(OdysseyModel3D, 'FromMDL').mockResolvedValue(source);
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await (emitter as any).loadChunkModel();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect((emitter as any)._chunkLoaded).toBe(false);
      expect(warning).toHaveBeenCalledWith(expect.any(String), 'plc_chunkybit02', expect.any(Error));
    } finally { build.mockRestore(); warning.mockRestore(); }
  });
});
