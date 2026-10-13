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

/**
 * Chunk emitters draw pieces of another model as their particles. Retail's
 * droid explosion (v_drdexpld_01, visualeffects row 4034, the Ebon Hawk
 * Sensor Droids' death) throws droid parts (FX_droid03/04/18, Fx_part_04,
 * texture fx_expparts) from P2P-gravity Explosion emitters. Two faults left an
 * untextured lump floating where the droid died for the effect's whole life:
 * the P2P tick returned before the chunk instances were ever placed, so every
 * instance sat at the emitter origin at full size, and the chunk material was
 * a clone taken before the source model's texture had loaded, so it never got
 * one.
 */
function createEmitter(flags: Record<string, boolean> = {}): OdysseyEmitter3D {
  const emitter = Object.setPrototypeOf(new THREE.Object3D(), OdysseyEmitter3D.prototype) as OdysseyEmitter3D;
  const material = new THREE.ShaderMaterial({ uniforms: { time: { value: 0 } } });
  Object.assign(emitter, {
    type: 'OdysseyEmitter',
    node: { chunkResRef: 'fx_droid04', renderOrder: 0, renderMode: 'Normal', updateMode: 'Explosion', flags },
    updateType: 'Explosion', maxParticleCount: 2, geometry: new THREE.BufferGeometry(), material,
    _chunkLoaded: false, _isChunkEmitter: true, _birthTimer: 0, _chunkMatrix: new THREE.Matrix4(), sizes: [1, 1, 1], angle: 0,
    _v3: new THREE.Vector3(), _lastWorldPos: new THREE.Vector3(), _worldPosDelta: new THREE.Vector3(),
    offsets: new THREE.BufferAttribute(new Float32Array(6), 3),
    velocities: new THREE.BufferAttribute(new Float32Array(8), 4),
    props: new THREE.BufferAttribute(new Float32Array(8), 4),
  });
  (emitter as any).getMaxParticleCount = () => 2;
  emitter.mesh = new THREE.Points(emitter.geometry, emitter.material) as never;
  emitter.add(emitter.mesh);
  return emitter;
}

async function loadChunk(emitter: OdysseyEmitter3D, source: OdysseyModel3D) {
  jest.mocked(MDLLoader.loader.load).mockResolvedValue({} as never);
  const build = jest.spyOn(OdysseyModel3D, 'FromMDL').mockResolvedValue(source);
  try { await (emitter as any).loadChunkModel(); } finally { build.mockRestore(); }
}

const scaleOf = (mesh: THREE.InstancedMesh, index: number) => {
  const matrix = new THREE.Matrix4();
  mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixScale(matrix).length();
};

describe('chunk emitters', () => {
  test('an unborn chunk is not drawn at the emitter origin', async () => {
    const emitter = createEmitter();
    const source = new OdysseyModel3D();
    source.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    await loadChunk(emitter, source);
    const mesh = (emitter as any)._chunkMesh as THREE.InstancedMesh;
    expect(mesh).toBeInstanceOf(THREE.InstancedMesh);
    for (let i = 0; i < mesh.count; i++) expect(scaleOf(mesh, i)).toBe(0);
  });

  test('a P2P chunk emitter places its chunks every tick', async () => {
    const emitter = createEmitter({ isP2P: true, isP2PSel: false });
    const source = new OdysseyModel3D();
    source.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()));
    await loadChunk(emitter, source);
    (emitter as any).tickP2PGravity = jest.fn();
    // The emitter stands at x = 10. A Normal-mode particle lives at a world
    // position, (11, 2, 3) for particle 0; particle 1 is dead.
    emitter.position.set(10, 0, 0);
    emitter.updateMatrix();
    (emitter as any).offsets.setXYZ(0, 11, 2, 3);
    (emitter as any).props.setXYZW(0, 0.1, 1, 1, 0);
    emitter.tick(1 / 30);
    expect((emitter as any).tickP2PGravity).toHaveBeenCalled();
    const mesh = (emitter as any)._chunkMesh as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    // The chunk mesh is the emitter's child, so the instance is local.
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([1, 2, 3]);
    expect(scaleOf(mesh, 1)).toBe(0);
  });

  test('the chunk draws with its source mesh material, so a texture that loads later shows', async () => {
    const emitter = createEmitter();
    const source = new OdysseyModel3D();
    const material = new THREE.ShaderMaterial({ uniforms: { map: { value: null } } });
    source.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
    await loadChunk(emitter, source);
    const texture = new THREE.Texture();
    material.uniforms.map.value = texture; // the texture queue completes after the chunk was built
    const drawn = (emitter as any)._chunkMesh.material as THREE.ShaderMaterial;
    expect(drawn.uniforms.map.value).toBe(texture);
  });
});
