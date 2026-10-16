import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import {
  UpgradeBagPorts, UpgradeItemPort, UpgradePart, UpgradeSession,
} from '@/game/tsl/crafting/UpgradeSession';
import { ItemCategory, UpgradeRow } from '@/game/tsl/crafting/UpgradeRules';

const part = (resref: string, row: number, type: number, level = 1): UpgradePart =>
  ({ resref, row, type, level, name: resref });

const scope = part('g_i_upgrade001', 16, 4);
const scope2 = part('g_i_upgrade002', 40, 4);
const chamber = part('g_i_upgrade010', 20, 6);
const powerPack = part('g_i_upgrade020', 30, 5);
const allParts = [scope, scope2, chamber, powerPack];
const table: UpgradeRow[] = allParts.map(p => ({ row: p.row, template: p.resref, type: p.type }));
const partFor = (row: number) => allParts.find(p => p.row === row);

class FakeItem implements UpgradeItemPort {
  slots: number[] = [-1, -1, -1];
  constructor(public category: ItemCategory, public level: number) {}
  getSlot(i: number) { return this.slots[i] ?? -1; }
  setSlot(i: number, row: number) { this.slots[i] = row; }
}

class FakeBag implements UpgradeBagPorts {
  counts = new Map<string, number>();
  failTakeAt = Infinity;
  takes = 0;
  constructor(init: [UpgradePart, number][]) { for (const [p, n] of init) this.counts.set(p.resref, n); }
  parts() {
    return allParts.filter(p => (this.counts.get(p.resref) ?? 0) > 0)
      .map(p => ({ part: p, count: this.counts.get(p.resref)! }));
  }
  takeOne(resref: string) {
    this.takes++;
    if (this.takes >= this.failTakeAt) return false;
    const n = this.counts.get(resref) ?? 0;
    if (n <= 0) return false;
    this.counts.set(resref, n - 1);
    return true;
  }
  returnOne(resref: string) { this.counts.set(resref, (this.counts.get(resref) ?? 0) + 1); return true; }
  snapshot() { return allParts.map(p => this.counts.get(p.resref) ?? 0); }
}

describe('UpgradeSession', () => {
  let item: FakeItem;
  let bag: FakeBag;
  let session: UpgradeSession;
  const count = (r: string) => bag.counts.get(r) ?? 0;
  const make = (level = 3) => {
    item = new FakeItem('ranged', level);
    bag = new FakeBag([[scope, 2], [scope2, 1], [chamber, 1], [powerPack, 1]]);
    session = new UpgradeSession(item, bag, table, partFor);
  };
  beforeEach(() => make());

  test('install takes one part from a stack', () => {
    expect(session.stage(0, scope)).toBe(true);
    expect(session.assemble()).toBe(true);
    expect(item.getSlot(0)).toBe(16);
    expect(count('g_i_upgrade001')).toBe(1);
    expect(session.hasChanges()).toBe(false);
  });

  test('replace returns the old part in the same assemble', () => {
    item.slots[0] = 16;
    bag.counts.set(scope.resref, 0);
    session.stage(0, scope2);
    session.assemble();
    expect(item.getSlot(0)).toBe(40);
    expect(count(scope.resref)).toBe(1);
    expect(count(scope2.resref)).toBe(0);
  });

  test('remove returns the part', () => {
    item.slots[0] = 16;
    bag.counts.set(scope.resref, 0);
    expect(session.stage(0, null)).toBe(true);
    session.assemble();
    expect(item.getSlot(0)).toBe(-1);
    expect(count(scope.resref)).toBe(1);
  });

  test('closed slot and wrong type are refused', () => {
    make(1);
    expect(session.stage(2, powerPack)).toBe(false);
    expect(session.stage(1, scope)).toBe(false);
    expect(session.hasChanges()).toBe(false);
  });

  test('a part above the item level is refused', () => {
    make(3);
    const hi = part('g_i_upgrade099', 99, 4, 4);
    expect(session.stage(0, hi)).toBe(false);
  });

  test('a last unit cannot be staged twice', () => {
    expect(session.candidates(1)).toContain(chamber);
    session.stage(1, chamber);
    expect(session.candidates(1).filter(p => p === chamber).length).toBe(0);
  });

  test('a stack of two can fill two slots of the same type only while units remain', () => {
    bag.counts.set(scope.resref, 1);
    expect(session.stage(0, scope)).toBe(true);
    expect(session.candidates(0)).not.toContain(scope);
  });

  test('assemble refuses atomically when a take fails', () => {
    const before = bag.snapshot();
    session.stage(0, scope);
    session.stage(1, chamber);
    bag.failTakeAt = 2;
    expect(session.assemble()).toBe(false);
    expect([item.getSlot(0), item.getSlot(1)]).toEqual([-1, -1]);
    expect(bag.snapshot()).toEqual(before);
  });

  test('removing an orphan row clears the slot and returns nothing', () => {
    item.slots[0] = 777;
    const before = bag.snapshot();
    expect(session.stage(0, null)).toBe(true);
    expect(session.assemble()).toBe(true);
    expect(item.getSlot(0)).toBe(-1);
    expect(bag.snapshot()).toEqual(before);
  });

  test('replacing an orphan row installs the new part and returns nothing', () => {
    item.slots[0] = 777;
    session.stage(0, scope);
    expect(session.assemble()).toBe(true);
    expect(item.getSlot(0)).toBe(16);
    expect(count(scope.resref)).toBe(1);
    expect(bag.snapshot().reduce((a, b) => a + b, 0)).toBe(4);
  });

  test('a good change alongside an orphan slot still succeeds', () => {
    item.slots[0] = 777;
    session.stage(0, null);
    session.stage(1, chamber);
    expect(session.assemble()).toBe(true);
    expect([item.getSlot(0), item.getSlot(1)]).toEqual([-1, 20]);
    expect(count(chamber.resref)).toBe(0);
  });

  test('a failed return rolls back every bag effect and changes no slot', () => {
    item.slots[0] = 16;
    bag.counts.set(scope.resref, 1);
    const before = bag.snapshot();
    session.stage(0, scope2);
    session.stage(1, chamber);
    bag.returnOne = (resref: string) => {
      if (resref === scope.resref) return false;
      bag.counts.set(resref, (bag.counts.get(resref) ?? 0) + 1);
      return true;
    };
    expect(session.assemble()).toBe(false);
    expect([item.getSlot(0), item.getSlot(1)]).toEqual([16, -1]);
    expect(bag.snapshot()).toEqual(before);
  });

  test('a failing rollback is logged, never silent', () => {
    item.slots[0] = 16;
    session.stage(0, scope2);
    bag.returnOne = () => false;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(session.assemble()).toBe(false);
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain(scope2.resref);
    spy.mockRestore();
  });

  test('cancel leaves everything unchanged', () => {
    const before = bag.snapshot();
    session.stage(0, scope);
    session.cancel();
    expect(session.hasChanges()).toBe(false);
    expect(item.getSlot(0)).toBe(-1);
    expect(bag.snapshot()).toEqual(before);
  });

  test('slots() reports type, openness, installed and staged', () => {
    make(1);
    item.slots[0] = 16;
    session.stage(0, null);
    const v = session.slots();
    expect(v.map(s => [s.type, s.open])).toEqual([[4, true], [6, false], [5, false]]);
    expect(v[0].installed).toBe(scope);
    expect(v[0].staged).toBeNull();
    expect(v[1].staged).toBeUndefined();
  });
});
