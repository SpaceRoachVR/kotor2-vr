import { describe, expect, test, beforeEach, jest } from '@jest/globals';
import {
  ColourPort, UpgradeBagPorts, UpgradeItemPort, UpgradePart, UpgradeSession,
} from '@/game/tsl/crafting/UpgradeSession';
import { COLOUR_SLOT, ItemCategory, UpgradeRow } from '@/game/tsl/crafting/UpgradeRules';

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

describe('UpgradeSession colour slot', () => {
  const crystal = (n: number) => part(`u_l_colo_0${n}`, -1, COLOUR_SLOT, 0);
  const c1 = crystal(1), c4 = crystal(4), c5 = crystal(5);
  const lsCrystal = part('g_i_crystal01', 50, 0);

  class SaberItem implements UpgradeItemPort {
    category: ItemCategory = 'lightsaber';
    level = 3;
    slots: number[] = [-1, -1, -1, -1, -1, -1];
    setCalls: number[] = [];
    sets: string[] = [];
    currentPart: UpgradePart | undefined = c1;
    setResult = true;
    rejected = new Set<string>(['u_l_colo_05']);
    colour: ColourPort = {
      current: () => this.currentPart,
      accepts: (r: string) => !this.rejected.has(r),
      set: (r: string) => { this.sets.push(r); return this.setResult; },
    };
    getSlot(i: number) { return this.slots[i] ?? -1; }
    setSlot(i: number, row: number) { this.setCalls.push(i); this.slots[i] = row; }
  }

  class SaberBag implements UpgradeBagPorts {
    counts = new Map<string, number>([['u_l_colo_04', 1], ['u_l_colo_05', 1], ['g_i_crystal01', 1]]);
    returns = 0;
    parts() {
      return [lsCrystal].filter(p => (this.counts.get(p.resref) ?? 0) > 0)
        .map(p => ({ part: p, count: this.counts.get(p.resref)! }));
    }
    colourCrystals() {
      return [c1, c4, c5].filter(p => (this.counts.get(p.resref) ?? 0) > 0)
        .map(p => ({ part: p, count: this.counts.get(p.resref)! }));
    }
    takeOne(r: string) {
      const n = this.counts.get(r) ?? 0;
      if (n <= 0) return false;
      this.counts.set(r, n - 1);
      return true;
    }
    returnOne(r: string) { this.returns++; this.counts.set(r, (this.counts.get(r) ?? 0) + 1); return true; }
  }

  let saber: SaberItem;
  let sbag: SaberBag;
  let sess: UpgradeSession;
  const n = (r: string) => sbag.counts.get(r) ?? 0;
  const lsTable: UpgradeRow[] = [{ row: lsCrystal.row, template: lsCrystal.resref, type: lsCrystal.type }];
  beforeEach(() => {
    saber = new SaberItem();
    sbag = new SaberBag();
    sess = new UpgradeSession(saber, sbag, lsTable, row => (row === lsCrystal.row ? lsCrystal : undefined));
  });

  test('colour slot shows the current crystal and cannot be removed', () => {
    expect(sess.slots()[1].installed?.resref).toBe('u_l_colo_01');
    expect(sess.slots()[1].open).toBe(true);
    expect(sess.stage(1, null)).toBe(false);
    expect(sess.hasChanges()).toBe(false);
  });

  test('colour candidates exclude the current crystal and crystals the saber rejects', () => {
    sbag.counts.set('u_l_colo_01', 1);
    expect(sess.candidates(1).map(p => p.resref)).toEqual(['u_l_colo_04']);
    expect(sess.stage(1, c5)).toBe(false);
  });

  test('swap takes one crystal, returns the old, sets the colour', () => {
    expect(sess.stage(1, c4)).toBe(true);
    expect(sess.assemble()).toBe(true);
    expect(n('u_l_colo_04')).toBe(0);
    expect(n('u_l_colo_01')).toBe(1);
    expect(saber.sets).toEqual(['u_l_colo_04']);
    expect(saber.setCalls).not.toContain(1);
  });

  test('unknown current colour returns nothing', () => {
    saber.currentPart = undefined;
    sess.stage(1, c4);
    expect(sess.assemble()).toBe(true);
    expect(sbag.returns).toBe(0);
    expect(n('u_l_colo_04')).toBe(0);
  });

  test('an unknown colour swap is logged once per session, naming the item', () => {
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    try {
      saber.currentPart = undefined;
      (saber as UpgradeItemPort).name = 'Lightsaber';
      sbag.counts.set('u_l_colo_04', 2);
      expect(sess.stage(1, c4)).toBe(true);
      expect(sess.assemble()).toBe(true);
      expect(sess.stage(1, c4)).toBe(true);
      expect(sess.assemble()).toBe(true);
      expect(sbag.returns).toBe(0);
      expect(info).toHaveBeenCalledTimes(1);
      expect(String(info.mock.calls[0][0])).toContain('Lightsaber');
    } finally {
      info.mockRestore();
    }
  });

  test('a failed set rolls the bag back', () => {
    saber.setResult = false;
    sess.stage(0, lsCrystal);
    sess.stage(1, c4);
    expect(sess.assemble()).toBe(false);
    expect(n('u_l_colo_04')).toBe(1);
    expect(n('u_l_colo_01')).toBe(0);
    expect(n('g_i_crystal01')).toBe(1);
    expect(saber.setCalls).toEqual([]);
  });

  test('staging the current crystal is a no-op', () => {
    expect(sess.stage(1, c1)).toBe(true);
    expect(sess.hasChanges()).toBe(false);
  });

  test('parts without a colour change do not call set', () => {
    sess.stage(0, lsCrystal);
    expect(sess.assemble()).toBe(true);
    expect(saber.sets).toEqual([]);
    expect(saber.slots[0]).toBe(50);
  });

  test('cancel discards a staged colour', () => {
    sess.stage(1, c4);
    sess.cancel();
    expect(sess.hasChanges()).toBe(false);
    expect(n('u_l_colo_04')).toBe(1);
  });

  test('a saber without a colour port shows the slot closed', () => {
    delete saber.colour;
    expect(sess.slots()[1].open).toBe(false);
    expect(sess.candidates(1)).toEqual([]);
    expect(sess.stage(1, c4)).toBe(false);
  });
});
