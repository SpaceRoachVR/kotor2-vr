import { describe, expect, test } from '@jest/globals';
import * as THREE from 'three';
import {
  VRCombatActorSnapshot,
  VRCombatVisualEventObserver,
} from '@/vr/runtime/VRCombatVisualEvents';

const at = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);

function snapshot(overrides: Partial<VRCombatActorSnapshot> = {}): VRCombatActorSnapshot {
  return {
    id: 1,
    position: at(0, 0),
    isDroid: false,
    deathStarted: false,
    attackResultsCalculated: false,
    attackIsRanged: true,
    attackResult: 1,
    attackTargetPosition: at(0, 10),
    ...overrides,
  };
}

describe('VRCombatVisualEventObserver', () => {
  test('the first sighting of an actor emits nothing', () => {
    // Loading into a module mid-fight must not spray bolts for attacks that
    // already resolved before VR ever saw them.
    const observer = new VRCombatVisualEventObserver();
    expect(observer.observe([snapshot({ attackResultsCalculated: true })])).toEqual([]);
  });

  test('a ranged attack resolving fires one bolt from shooter to target', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ attackResultsCalculated: false })]);
    const events = observer.observe([snapshot({ attackResultsCalculated: true })]);

    expect(events).toHaveLength(1);
    const bolt = events[0];
    expect(bolt.kind).toBe('bolt');
    if (bolt.kind !== 'bolt') throw new Error('expected a bolt');
    // Lifted off the floor: a bolt from a creature's origin leaves its feet.
    expect(bolt.from.z).toBeGreaterThan(0);
    expect(bolt.to.y).toBeCloseTo(10, 5);
  });

  test('a bolt is aimed at a creature unless the snapshot says otherwise', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ attackResultsCalculated: false })]);
    const [bolt] = observer.observe([snapshot({ attackResultsCalculated: true })]);
    if (bolt?.kind !== 'bolt') throw new Error('expected a bolt');
    expect(bolt.targetIsCreature).toBe(true);
  });

  // A Bash resolves its rounds with no trigger pull, so VRSpike draws the
  // player's own bolt for it; it lands on the object's bounds centre, since a
  // knee-high footlocker sits well under creature chest height.
  test('a bash bolt is marked non-creature and lands on the aim point', () => {
    const observer = new VRCombatVisualEventObserver();
    const bash = { attackTargetIsCreature: false, attackTargetAimPoint: at(0, 10, 0.3) };
    observer.observe([snapshot({ ...bash, attackResultsCalculated: false })]);
    const [bolt] = observer.observe([snapshot({ ...bash, attackResultsCalculated: true })]);
    if (bolt?.kind !== 'bolt') throw new Error('expected a bolt');
    expect(bolt.targetIsCreature).toBe(false);
    expect(bolt.to.z).toBeCloseTo(0.3, 5);
  });

  test('a held attack state does not re-fire every frame', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ attackResultsCalculated: false })]);
    expect(observer.observe([snapshot({ attackResultsCalculated: true })])).toHaveLength(1);
    expect(observer.observe([snapshot({ attackResultsCalculated: true })])).toHaveLength(0);
    expect(observer.observe([snapshot({ attackResultsCalculated: true })])).toHaveLength(0);
  });

  test('a miss still fires a bolt, because the shot left the weapon', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ attackResultsCalculated: false })]);
    const events = observer.observe([snapshot({ attackResultsCalculated: true, attackResult: 4 })]);
    expect(events).toHaveLength(1);
  });

  test('results meaning no shot occurred fire nothing', () => {
    for (const attackResult of [0, 6]) {
      const observer = new VRCombatVisualEventObserver();
      observer.observe([snapshot({ attackResultsCalculated: false })]);
      expect(observer.observe([snapshot({ attackResultsCalculated: true, attackResult })])).toEqual([]);
    }
  });

  test('a melee attack fires no bolt', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ attackResultsCalculated: false, attackIsRanged: false })]);
    const events = observer.observe([snapshot({ attackResultsCalculated: true, attackIsRanged: false })]);
    expect(events).toEqual([]);
  });

  test('a ranged attack with no positioned target fires no bolt', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ attackResultsCalculated: false, attackTargetPosition: null })]);
    const events = observer.observe([snapshot({ attackResultsCalculated: true, attackTargetPosition: null })]);
    expect(events).toEqual([]);
  });

  test('a droid beginning to die explodes exactly once', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ isDroid: true, deathStarted: false })]);
    const events = observer.observe([snapshot({ isDroid: true, deathStarted: true })]);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('explosion');
    expect(observer.observe([snapshot({ isDroid: true, deathStarted: true })])).toHaveLength(0);
  });

  test('a droid whose HP hits zero explodes even before deathStarted latches', () => {
    // Script-killed droids can be faded out before the engine's latch is seen.
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ isDroid: true, deathStarted: false, isDead: false })]);
    const events = observer.observe([snapshot({ isDroid: true, deathStarted: false, isDead: true })]);
    expect(events.map((e) => e.kind)).toEqual(['explosion']);
    // The later latch is the same death, not a second one.
    expect(observer.observe([snapshot({ isDroid: true, deathStarted: true, isDead: true })])).toEqual([]);
  });

  test('a non-droid dying does not explode', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ isDroid: false, deathStarted: false })]);
    expect(observer.observe([snapshot({ isDroid: false, deathStarted: true })])).toEqual([]);
  });

  test('an actor that disappears is forgotten, so a reused id cannot inherit its latch', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ isDroid: true, deathStarted: true })]);
    observer.observe([]);
    // Same id reappears already dead: treated as a first sighting, not a death.
    expect(observer.observe([snapshot({ isDroid: true, deathStarted: true })])).toEqual([]);
  });

  test('several actors are tracked independently in one pass', () => {
    const observer = new VRCombatVisualEventObserver();
    const shooter = snapshot({ id: 1, attackResultsCalculated: false });
    const dyingDroid = snapshot({ id: 2, isDroid: true, deathStarted: false, attackIsRanged: false });
    observer.observe([shooter, dyingDroid]);

    const events = observer.observe([
      snapshot({ id: 1, attackResultsCalculated: true }),
      snapshot({ id: 2, isDroid: true, deathStarted: true, attackIsRanged: false }),
    ]);
    expect(events.map((e) => e.kind).sort()).toEqual(['bolt', 'explosion']);
  });

  test('malformed snapshots are skipped without failing the pass', () => {
    const observer = new VRCombatVisualEventObserver();
    const good = snapshot({ id: 5, attackResultsCalculated: false });
    observer.observe([good]);
    const events = observer.observe([
      null as never,
      snapshot({ id: 1.5 }),
      snapshot({ id: 6, position: at(NaN, 0) }),
      snapshot({ id: 5, attackResultsCalculated: true }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBe(5);
  });

  test('reset forgets everything', () => {
    const observer = new VRCombatVisualEventObserver();
    observer.observe([snapshot({ attackResultsCalculated: false })]);
    observer.reset();
    expect(observer.observe([snapshot({ attackResultsCalculated: true })])).toEqual([]);
  });
});
