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

describe('ModuleArea.update below L3 (source slice)', () => {
  // A full ModuleArea is too heavy to stand up here; the emulator dry run
  // (Task 7) found the defect, this keeps the fix from being dropped. Below L3
  // the party update is skipped, and with it the player's first room lookup,
  // so updateRoomVisibility bailed and L1/L2 drew every room unculled.
  const fs = require('fs');
  const path = require('path');
  const source: string = fs.readFileSync(path.join(process.cwd(), 'src/module/ModuleArea.ts'), 'utf8');
  const update = source.slice(source.indexOf('  update(delta: number = 0){'), source.indexOf('updateRoomVisibility(delta);'));

  // findWalkableFace returns early without an area, and the area is also set in
  // ModuleCreature.update, so both have to happen here.
  test('still gives the player its area and room when the party update is gated off', () => {
    const partyGate = update.indexOf('//update party');
    expect(partyGate).toBeGreaterThan(-1);
    const block = update.slice(partyGate, update.indexOf('//update creatures'));
    expect(block).toMatch(/if\(PerfLayerGate\.characters\(\)\)\{[\s\S]*?\}else\{[\s\S]*?getCurrentPlayer\(\)[\s\S]*?!player\.room[\s\S]*?player\.area = this[\s\S]*?player\.getCurrentRoom\(\)/);
  });

  test('the room lookup runs before updateRoomVisibility in the same update', () => {
    expect(update.length).toBeGreaterThan(0);
    expect(update).toContain('player.getCurrentRoom()');
  });
});
