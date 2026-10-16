import { ItemCategory, UpgradeRow, fits, isSlotOpen, slotTypes } from '@/game/tsl/crafting/UpgradeRules';

/**
 * GUI-free staging of upgrade-slot changes for TSL's Upgrade Workbench. The
 * engine is reached only through the ports below, so this is unit-testable
 * with in-memory fakes. Nothing changes until assemble(); assemble takes every
 * staged part and returns every replaced/removed part together, or changes
 * nothing, so parts are never lost.
 */

export interface UpgradeItemPort {
  category: ItemCategory;
  level: number;
  getSlot(i: number): number;
  setSlot(i: number, row: number): void;
}

export interface UpgradePart {
  resref: string;
  row: number;
  type: number;
  level: number;
  name: string;
}

export interface UpgradeBagPorts {
  parts(): { part: UpgradePart; count: number }[];
  takeOne(resref: string): boolean;
  returnOne(resref: string): boolean;
}

export interface SlotView {
  index: number;
  type: number;
  open: boolean;
  installed?: UpgradePart;
  /** undefined = untouched, null = staged removal. */
  staged?: UpgradePart | null;
}

export class UpgradeSession {
  private readonly types: number[];
  private readonly staging = new Map<number, UpgradePart | null>();

  constructor(
    private readonly item: UpgradeItemPort,
    private readonly bag: UpgradeBagPorts,
    private readonly table: UpgradeRow[],
    private readonly partFor: (row: number) => UpgradePart | undefined,
  ) {
    this.types = slotTypes(item.category);
  }

  private installedRow(i: number): number {
    return this.item.getSlot(i);
  }

  private installed(i: number): UpgradePart | undefined {
    const row = this.installedRow(i);
    return row >= 0 ? this.partFor(row) : undefined;
  }

  slots(): SlotView[] {
    return this.types.map((type, index) => {
      const view: SlotView = { index, type, open: isSlotOpen(this.item.level, type) };
      const installed = this.installed(index);
      if (installed) view.installed = installed;
      if (this.staging.has(index)) view.staged = this.staging.get(index);
      return view;
    });
  }

  /** Units of each part resref currently staged, across all slots. */
  private stagedUnits(): Map<string, number> {
    const used = new Map<string, number>();
    for (const p of this.staging.values()) {
      if (p) used.set(p.resref, (used.get(p.resref) ?? 0) + 1);
    }
    return used;
  }

  candidates(slotIndex: number): UpgradePart[] {
    const type = this.types[slotIndex];
    if (type === undefined || !isSlotOpen(this.item.level, type)) return [];
    const used = this.stagedUnits();
    return this.bag.parts()
      .filter(({ part, count }) => fits(part, type, this.item.level) && count - (used.get(part.resref) ?? 0) > 0)
      .map(({ part }) => part);
  }

  stage(slotIndex: number, part: UpgradePart | null): boolean {
    const type = this.types[slotIndex];
    if (type === undefined || !isSlotOpen(this.item.level, type)) return false;
    if (part === null) {
      if (this.installedRow(slotIndex) >= 0) this.staging.set(slotIndex, null);
      else this.staging.delete(slotIndex);
      return true;
    }
    if (!fits(part, type, this.item.level)) return false;
    if (!this.table.some(r => r.row === part.row && r.type === part.type)) return false;
    // Already installed: nothing to change.
    if (this.installedRow(slotIndex) === part.row) {
      this.staging.delete(slotIndex);
      return true;
    }
    // Units free for this slot: bag count minus units staged in OTHER slots.
    const held = this.bag.parts().find(b => b.part.resref === part.resref)?.count ?? 0;
    let elsewhere = 0;
    for (const [i, p] of this.staging) {
      if (i !== slotIndex && p && p.resref === part.resref) elsewhere++;
    }
    if (held - elsewhere <= 0) return false;
    this.staging.set(slotIndex, part);
    return true;
  }

  hasChanges(): boolean {
    return this.staging.size > 0;
  }

  assemble(): boolean {
    if (!this.hasChanges()) return false;
    const toTake: UpgradePart[] = [];
    const toReturn: UpgradePart[] = [];
    for (const [i, staged] of this.staging) {
      const row = this.installedRow(i);
      if (row >= 0) {
        // An orphan row (no resolvable part) is cleared/overwritten; nothing is returned for it.
        const old = this.partFor(row);
        if (old) toReturn.push(old);
      }
      if (staged) toTake.push(staged);
    }

    const taken: UpgradePart[] = [];
    const undoTakes = () => {
      for (const p of taken) {
        if (!this.bag.returnOne(p.resref)) console.error(`UpgradeSession: rollback could not return part ${p.resref}`);
      }
    };
    for (const p of toTake) {
      if (!this.bag.takeOne(p.resref)) { undoTakes(); return false; }
      taken.push(p);
    }
    const returned: UpgradePart[] = [];
    for (const p of toReturn) {
      if (!this.bag.returnOne(p.resref)) {
        for (const r of returned) {
          if (!this.bag.takeOne(r.resref)) console.error(`UpgradeSession: rollback could not retake part ${r.resref}`);
        }
        undoTakes();
        return false;
      }
      returned.push(p);
    }
    for (const [i, staged] of this.staging) this.item.setSlot(i, staged ? staged.row : -1);
    this.staging.clear();
    return true;
  }

  cancel(): void {
    this.staging.clear();
  }
}
