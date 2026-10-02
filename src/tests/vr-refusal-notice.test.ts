import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { describeVRRefusal } from '@/vr/runtime/VRRefusalNoticeHost';

// Critic runs 4-5: one sound for every refusal, and nothing for a player who
// cannot hear it. Each refusal now also says why, in view.
describe('refusals say why', () => {
  test('each refusal shape has its own reason', () => {
    expect(describeVRRefusal('refused: out of Force range')).toBe('Out of Force range');
    expect(describeVRRefusal('refused: out of throw range')).toBe('Out of throwing range');
    expect(describeVRRefusal('refused: no locked hostile')).toBe('No target');
    expect(describeVRRefusal('refused: quick save')).toBe("Can't save now");
    expect(describeVRRefusal('refused: quick save failed')).toBe('Save failed');
    expect(describeVRRefusal('refused: swing target lost')).toBe('Target lost');
    expect(describeVRRefusal('cancelled: armed item no longer in the inventory')).toBe('Item no longer in your pack');
  });

  test('outcomes that are not refusals stay quiet', () => {
    expect(describeVRRefusal('released')).toBeNull();
    expect(describeVRRefusal('thrown: scheduled into the combat round')).toBeNull();
  });
});

// Critic run 5 sweep: the wheel accepted Menu only from the left hand, so a
// left-hander (Menu bound to the right A button) could not open it.
test('the wheel opens from the off hand, whichever that is', () => {
  const spike = fs.readFileSync(path.join(__dirname, '..', 'vr', 'VRSpike.ts'), 'utf8');
  expect(spike).not.toMatch(/SemanticXRAction\.Menu && action\.hand === 'left'/);
  expect(spike).toMatch(/SemanticXRAction\.Menu && action\.hand !== VRSpike\.dominantHand/);
});
