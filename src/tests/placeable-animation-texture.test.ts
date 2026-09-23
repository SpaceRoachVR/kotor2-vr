(global as any).window = {
  innerWidth: 1920,
  innerHeight: 1080,
  location: { search: '' },
  screen: { width: 1920, height: 1080 },
  addEventListener: () => {},
  removeEventListener: () => {},
};
const createMockElement = (): any => ({
  getContext: (): any => null,
  classList: { add: () => {}, remove: () => {}, contains: () => false },
  style: {},
  appendChild: () => {},
  removeChild: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  setAttribute: () => {},
  getAttribute: (): any => null,
  querySelector: (): any => createMockElement(),
  querySelectorAll: (): any[] => [],
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
});
(global as any).document = {
  createElement: createMockElement,
  getElementById: () => createMockElement(),
  querySelector: () => createMockElement(),
  querySelectorAll: (): any[] => [],
  body: createMockElement(),
  addEventListener: () => {},
  removeEventListener: () => {},
};

import { describe, expect, test, jest } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

import * as THREE from 'three';
import { OdysseyModel } from '@/odyssey';
import { OdysseyModel3D } from '@/three/odyssey';
import { TwoDAManager } from '@/managers/TwoDAManager';

const GAME_ROOT = 'D:/SteamLibrary/steamapps/common/Knights of the Old Republic II';

function loadModelFiles(name: string): { mdl: Uint8Array; mdx: Uint8Array } | null {
  const keyBuf = fs.readFileSync(path.join(GAME_ROOT, 'chitin.key'));
  const keyCount = keyBuf.readUInt32LE(12);
  const offKey = keyBuf.readUInt32LE(20);
  const bifBuf = fs.readFileSync(path.join(GAME_ROOT, 'data/models.bif'));
  const vOff = bifBuf.readUInt32LE(16);

  let mdlId = -1;
  let mdxId = -1;
  for (let i = 0; i < keyCount; i++) {
    const p = offKey + i * 22;
    const resref = keyBuf.toString('latin1', p, p + 16).replace(/\0[\s\S]*$/, '').toLowerCase();
    const resType = keyBuf.readUInt16LE(p + 16);
    const resId = keyBuf.readUInt32LE(p + 18);
    if (resref === name.toLowerCase()) {
      if (resType === 2002) mdlId = resId;
      if (resType === 3008) mdxId = resId;
    }
  }
  if (mdlId === -1) return null;

  function extract(resId: number) {
    if (resId === -1) return new Uint8Array(0);
    const resIdx = resId & 0xFFFFF;
    const bp = vOff + resIdx * 16;
    const offset = bifBuf.readUInt32LE(bp + 4);
    const size = bifBuf.readUInt32LE(bp + 8);
    return new Uint8Array(bifBuf.buffer, bifBuf.byteOffset + offset, size);
  }

  return { mdl: extract(mdlId), mdx: extract(mdxId) };
}

describe('Placeable 3D Model & Animation Simulation', () => {
  test('loading plc_footlker into OdysseyModel3D and playing close2open', async () => {
    for (const modelName of ['plc_footlker', 'plc_plstccrt', 'plc_lockerlg']) {
      const files = loadModelFiles(modelName);
      if (!files) {
        console.log(`Could not load files for ${modelName}`);
        continue;
      }
      const model = OdysseyModel.FromBuffers(files.mdl, files.mdx);
      const model3D = await OdysseyModel3D.FromMDL(model, { static: false });
      
      console.log(`\n=== Testing ${modelName} ===`);
      console.log('Animation map keys:', Array.from(model3D.odysseyAnimationMap.keys()));

      const checkMeshes = (label: string) => {
        const list: any[] = [];
        model3D.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as any;
            list.push({
              childName: child.name,
              visible: child.visible,
              matVisible: mat?.visible,
              opacity: mat?.opacity ?? mat?.uniforms?.opacity?.value,
              map: mat?.userData?.map,
              matType: mat?.type,
              defines: mat?.defines ? Object.keys(mat.defines) : [],
            });
          }
        });
        console.log(`Meshes [${label}]:`, list);
      };

      // Verify meshes exist and retain texture mapping
      const meshes: any[] = [];
      model3D.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as any;
          meshes.push({
            name: child.name,
            visible: child.visible,
            map: mat?.userData?.map,
          });
        }
      });
      expect(meshes.length).toBeGreaterThan(0);
      for (const m of meshes) {
        expect(m.visible).toBe(true);
        expect(typeof m.map).toBe('string');
        expect(m.map.length).toBeGreaterThan(0);
      }

      // Play close2open and update
      model3D.playAnimation('close2open', false);
      for (let f = 1; f <= 15; f++) {
        model3D.update(0.05);
      }

      // Play open
      model3D.playAnimation('open', true);
      for (let f = 1; f <= 5; f++) {
        model3D.update(0.05);
      }

      // Verify all meshes remain visible with maps
      model3D.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const mat = child.material as any;
          expect(child.visible).toBe(true);
          expect(mat?.userData?.map).toBeDefined();
        }
      });
    }
  });

  test('playAnimation safely handles uninitialized animations 2da without throwing', async () => {
    TwoDAManager.datatables.delete('animations');
    const files = loadModelFiles('plc_footlker');
    if (!files) return;

    const model = OdysseyModel.FromBuffers(files.mdl, files.mdx);
    const model3D = await OdysseyModel3D.FromMDL(model, { static: false });
    expect(() => {
      model3D.playAnimation('close2open', false);
    }).not.toThrow();
    expect(model3D.getAnimationName()).toBe('close2open');
  });
});
