import { afterEach, describe, expect, test } from '@jest/globals';
import { PerfLayerGate } from '@/vr/PerfLayerGate';
import type { PerfLayer } from '@/utility/RendererOptions';

/** layer -> [rendersWorld, allRooms, characters, effects, playLayer, active] */
const TABLE: Record<PerfLayer, [boolean, boolean, boolean, boolean, boolean, boolean]> = {
  0: [false, false, false, false, false, true],
  1: [true, false, false, false, false, true],
  2: [true, true, false, false, false, true],
  3: [true, true, true, false, false, true],
  4: [true, true, true, true, false, true],
  5: [true, true, true, true, true, false],
};

afterEach(() => PerfLayerGate.configure(''));

describe('PerfLayerGate', () => {
  test('defaults to layer 5 with every layer on and no gate active', () => {
    expect(PerfLayerGate.layer).toBe(5);
    expect(PerfLayerGate.active()).toBe(false);
  });

  test('configure with no perflayer leaves layer 5', () => {
    PerfLayerGate.configure('');
    expect(PerfLayerGate.layer).toBe(5);
    PerfLayerGate.configure('?foo=bar');
    expect(PerfLayerGate.layer).toBe(5);
  });

  for (const key of Object.keys(TABLE)) {
    const layer = Number(key) as PerfLayer;
    test(`layer ${layer} predicates`, () => {
      PerfLayerGate.configure(`?perflayer=l${layer}`);
      expect(PerfLayerGate.layer).toBe(layer);
      expect([
        PerfLayerGate.rendersWorld(),
        PerfLayerGate.allRooms(),
        PerfLayerGate.characters(),
        PerfLayerGate.effects(),
        PerfLayerGate.playLayer(),
        PerfLayerGate.active(),
      ]).toEqual(TABLE[layer]);
    });
  }

  test('configure resets back to 5 when the layer disappears', () => {
    PerfLayerGate.configure('?perflayer=l1');
    PerfLayerGate.configure('');
    expect(PerfLayerGate.layer).toBe(5);
  });
});
