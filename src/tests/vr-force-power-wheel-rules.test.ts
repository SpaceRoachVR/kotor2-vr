import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  isVRDroidOnlyForcePower,
  orderVRForcePowersByRecent,
  VR_RECENT_FORCE_POWER_LIMIT,
  VRRecentForcePowers,
} from '@/vr/runtime/VRForcePowerWheelRules';

describe('droid-only Force powers', () => {
  test('retail spells.2da rows 47, 12 and 13 are Stun, Disable and Destroy Droid', () => {
    expect([47, 12, 13].every(isVRDroidOnlyForcePower)).toBe(true);
    expect(isVRDroidOnlyForcePower(9)).toBe(false); // FORCE_POWER_CHOKE
    expect(isVRDroidOnlyForcePower(undefined)).toBe(false);
  });

  test('the ids match the install\'s spells.2da labels', () => {
    // Pinned against the retail table read for Part F: FORCE_POWER_DROID_STUN
    // is row 47, FORCE_POWER_DROID_DISABLE row 12, FORCE_POWER_DROID_DESTROY
    // row 13 (data/2da.bif). The source names them so a reviewer can check.
    const source = fs.readFileSync(path.join(process.cwd(), 'src/vr/runtime/VRForcePowerWheelRules.ts'), 'utf8');
    for (const label of ['FORCE_POWER_DROID_STUN', 'FORCE_POWER_DROID_DISABLE', 'FORCE_POWER_DROID_DESTROY']) {
      expect(source).toContain(label);
    }
  });
});

describe('VRRecentForcePowers', () => {
  test('most recent first, a repeat moves to the front, capped', () => {
    const recent = new VRRecentForcePowers();
    recent.note(1); recent.note(2); recent.note(1);
    expect(recent.list()).toEqual([1, 2]);
    for (let i = 10; i < 20; i++) recent.note(i);
    expect(recent.list()).toHaveLength(VR_RECENT_FORCE_POWER_LIMIT);
    expect(recent.list()[0]).toBe(19);
    recent.note('x'); recent.note(-1);
    expect(recent.list()[0]).toBe(19);
  });

  test('ordering keeps the engine order for the rest', () => {
    const actions = [{ spellId: 1 }, { spellId: 2 }, {}, { spellId: 3 }];
    expect(orderVRForcePowersByRecent(actions, [3, 9]).map((a) => a.spellId)).toEqual([3, 1, 2, undefined]);
    expect(orderVRForcePowersByRecent(actions, null)).toEqual(actions);
  });
});
