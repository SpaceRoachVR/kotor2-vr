import { describe, expect, test } from '@jest/globals';
import { VRHurtPresentationGate } from '@/vr/runtime/VRHurtPresentationGate';

// Part D1: the engine takes HP at the roll, up to 0.9 s before the blade
// lands. The player is shown the hurt when the blow lands; the numbers stay
// the engine's.
describe('hurt on the blow', () => {
  const gate = () => {
    const g = new VRHurtPresentationGate({ boltTravelMs: 160, meleeTimeoutMs: 1_300, assignWindowMs: 200 });
    g.update(80, 0);
    return g;
  };

  test('a melee hit holds the shown HP until the attacker\'s Hit event', () => {
    const g = gate();
    g.recordHit({ attackerId: 7, critical: false, ranged: false, nowMs: 100 });
    let u = g.update(55, 100);
    expect(u.displayedHitPoints).toBe(80);
    expect(u.released).toEqual([]);
    u = g.update(55, 600);
    expect(u.displayedHitPoints).toBe(80);
    g.noteBlowLanded(7);
    u = g.update(55, 960);
    expect(u.displayedHitPoints).toBe(55);
    expect(u.released).toEqual([{ attackerId: 7, critical: false, amount: 25, reason: 'blow' }]);
  });

  test('another attacker\'s Hit event does not land it', () => {
    const g = gate();
    g.recordHit({ attackerId: 7, critical: false, ranged: false, nowMs: 100 });
    g.update(70, 100);
    g.noteBlowLanded(9);
    expect(g.update(70, 300).displayedHitPoints).toBe(80);
  });

  test('a melee animation with no Hit event lands at the timeout', () => {
    const g = gate();
    g.recordHit({ attackerId: 7, critical: true, ranged: false, nowMs: 100 });
    g.update(60, 100);
    expect(g.update(60, 1_399).released).toEqual([]);
    expect(g.update(60, 1_400).released).toEqual([{ attackerId: 7, critical: true, amount: 20, reason: 'timeout' }]);
  });

  test('a ranged hit lands when the bolt arrives', () => {
    const g = gate();
    g.recordHit({ attackerId: 3, critical: false, ranged: true, nowMs: 1_000 });
    expect(g.update(74, 1_000).displayedHitPoints).toBe(80);
    expect(g.update(74, 1_100).released).toEqual([]);
    const u = g.update(74, 1_160);
    expect(u.displayedHitPoints).toBe(74);
    expect(u.released[0]).toMatchObject({ attackerId: 3, amount: 6, reason: 'bolt' });
  });

  test('damage with no roll behind it (a grenade, poison) shows at once', () => {
    const g = gate();
    expect(g.update(70, 500)).toEqual({ displayedHitPoints: 70, released: [] });
  });

  test('a hit that took no HP (a shield) still lands, with amount 0', () => {
    const g = gate();
    g.recordHit({ attackerId: 7, critical: false, ranged: false, nowMs: 100 });
    g.update(80, 100);
    g.noteBlowLanded(7);
    expect(g.update(80, 800).released).toEqual([{ attackerId: 7, critical: false, amount: 0, reason: 'blow' }]);
  });

  test('two attackers: each hit is held and lands on its own blow', () => {
    const g = gate();
    g.recordHit({ attackerId: 1, critical: false, ranged: false, nowMs: 100 });
    g.update(70, 100);
    g.recordHit({ attackerId: 2, critical: false, ranged: true, nowMs: 400 });
    expect(g.update(65, 400).displayedHitPoints).toBe(80);
    const bolt = g.update(65, 560);
    expect(bolt.released.map((r) => r.attackerId)).toEqual([2]);
    expect(bolt.displayedHitPoints).toBe(75);
    g.noteBlowLanded(1);
    expect(g.update(65, 900).displayedHitPoints).toBe(65);
  });

  test('damage that arrives after the roll frame (an engine applying it at the blow) shows at once', () => {
    const g = gate();
    g.recordHit({ attackerId: 7, critical: false, ranged: false, nowMs: 100 });
    expect(g.update(80, 100).displayedHitPoints).toBe(80);
    const u = g.update(71, 950);
    expect(u.displayedHitPoints).toBe(71);
    expect(u.released).toEqual([{ attackerId: 7, critical: false, amount: 9, reason: 'late' }]);
    expect(g.holding).toBe(false);
  });

  test('a heal while a hit is held covers it, and the shown HP never passes the maximum', () => {
    const g = gate();
    g.recordHit({ attackerId: 7, critical: false, ranged: false, nowMs: 100 });
    expect(g.update(51, 100, 80).displayedHitPoints).toBe(80);
    // A medpac to full while the blade is still coming.
    expect(g.update(80, 300, 80).displayedHitPoints).toBe(80);
    g.noteBlowLanded(7);
    expect(g.update(80, 900, 80).released).toEqual([{ attackerId: 7, critical: false, amount: 0, reason: 'blow' }]);
  });

  test('a load or party swap (no HP) drops whatever was held', () => {
    const g = gate();
    g.recordHit({ attackerId: 7, critical: false, ranged: false, nowMs: 100 });
    g.update(60, 100);
    expect(g.update(null, 200)).toEqual({ displayedHitPoints: null, released: [] });
    expect(g.holding).toBe(false);
    expect(g.update(40, 300).displayedHitPoints).toBe(40);
  });
});
