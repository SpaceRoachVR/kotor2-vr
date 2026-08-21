import { XRHandRole } from './XRTypes';
import { VRRadialHit } from './VRRadialMenuLayout';
import {
  validateVRRadialMenu,
  VRRadialActionItem,
  VRRadialMenuDefinition,
  VRRadialMenuItem,
  VRRadialPage,
} from './VRRadialMenuModel';

export interface VRRadialControllerInput {
  readonly menuPressed: boolean;
  readonly selectPressed: boolean;
  readonly openingMenu: VRRadialMenuDefinition | null;
  readonly rayHit: VRRadialHit | null;
  readonly touchHits: Readonly<Partial<Record<XRHandRole, VRRadialHit | null>>>;
}

export type VRRadialCloseReason = 'cancel' | 'activated' | 'invalid' | 'lifecycle';

export type VRRadialControllerEffect =
  | { readonly type: 'opened' }
  | { readonly type: 'closed'; readonly reason: VRRadialCloseReason }
  | { readonly type: 'hover-haptic'; readonly hand: XRHandRole }
  | { readonly type: 'confirm-haptic'; readonly hand: XRHandRole }
  | { readonly type: 'negative-haptic'; readonly hand: XRHandRole }
  | { readonly type: 'activate'; readonly item: VRRadialActionItem; readonly hand: XRHandRole };

export interface VRRadialPresentation {
  readonly menu: VRRadialMenuDefinition;
  readonly pageIndex: number;
  readonly page: VRRadialPage;
  readonly hoveredId: string | 'cancel' | null;
}

type ControllerState = 'closed' | 'open' | 'waiting-for-menu-release';

const HAND_ORDER: readonly XRHandRole[] = ['left', 'right'];

/**
 * Engine-independent state machine for the trigger-confirm radial action
 * wheel. The owning XR runtime executes emitted activation effects only after
 * it has applied the corresponding close and pause transitions.
 */
export class VRRadialMenuController {
  private state: ControllerState = 'closed';
  private menu: VRRadialMenuDefinition | null = null;
  private pageIndex = 0;
  private hoveredId: string | 'cancel' | null = null;
  private previousSelectPressed = false;
  private lastMenuPressed = false;
  private readonly touchOverlapIds: Record<XRHandRole, string | null> = { left: null, right: null };

  get isOpen(): boolean {
    return this.state === 'open';
  }

  get presentation(): VRRadialPresentation | null {
    if (!this.menu || this.state !== 'open') return null;
    const page = this.menu.pages[this.pageIndex];
    if (!page) return null;
    return { menu: this.menu, pageIndex: this.pageIndex, page, hoveredId: this.hoveredId };
  }

  /**
   * Synchronizes the physical Menu state while another foreground surface owns
   * input. This can only release the post-close latch; it never opens the wheel
   * or emits an activation.
   */
  synchronizeMenuPressed(menuPressed: boolean): void {
    this.lastMenuPressed = menuPressed === true;
    if (this.state === 'waiting-for-menu-release' && !this.lastMenuPressed) {
      this.state = 'closed';
    }
  }

  process(input: VRRadialControllerInput): readonly VRRadialControllerEffect[] {
    const effects: VRRadialControllerEffect[] = [];
    const selectPressed = input.selectPressed === true;
    const selectPressedEdge = selectPressed && !this.previousSelectPressed;
    this.previousSelectPressed = selectPressed;
    this.synchronizeMenuPressed(input.menuPressed);

    if (this.state === 'waiting-for-menu-release') {
      return effects;
    }

    if (this.state === 'closed') {
      if (input.menuPressed) this.open(input.openingMenu, effects);
      return effects;
    }

    // X is visibility/cancel only. Release takes precedence over all other
    // controls and never confirms an item.
    if (!input.menuPressed) {
      this.closeInto(effects, 'cancel', false);
      return effects;
    }

    if (selectPressedEdge) {
      this.resolveHit(input.rayHit, 'left', effects);
      return effects;
    }

    this.processTouchHits(input.touchHits, effects);
    if (this.state === 'open') this.updateRayHover(input.rayHit, effects);
    return effects;
  }

  close(reason: VRRadialCloseReason = 'lifecycle'): readonly VRRadialControllerEffect[] {
    if (this.state !== 'open') return [];
    const effects: VRRadialControllerEffect[] = [];
    this.closeInto(effects, reason, this.lastMenuPressed);
    return effects;
  }

  private open(menu: VRRadialMenuDefinition | null, effects: VRRadialControllerEffect[]): void {
    if (!menu || !this.isValidMenu(menu)) {
      this.closeInto(effects, 'invalid', true);
      effects.push({ type: 'negative-haptic', hand: 'left' });
      return;
    }

    this.state = 'open';
    this.menu = menu;
    this.pageIndex = 0;
    this.hoveredId = null;
    this.clearTouchOverlaps();
    effects.push({ type: 'opened' });
  }

  private processTouchHits(
    touchHits: Readonly<Partial<Record<XRHandRole, VRRadialHit | null>>>,
    effects: VRRadialControllerEffect[],
  ): void {
    for (const hand of HAND_ORDER) {
      if (this.state !== 'open') return;
      const hit = touchHits[hand] ?? null;
      const overlapId = this.overlapIdFor(hit);
      if (overlapId === this.touchOverlapIds[hand]) continue;
      this.touchOverlapIds[hand] = overlapId;
      if (hit) this.resolveHit(hit, hand, effects);
    }
  }

  private updateRayHover(hit: VRRadialHit | null, effects: VRRadialControllerEffect[]): void {
    const nextHoveredId = this.hoveredIdFor(hit);
    if (nextHoveredId === this.hoveredId) return;
    this.hoveredId = nextHoveredId;
    if (nextHoveredId !== null) effects.push({ type: 'hover-haptic', hand: 'left' });
  }

  private resolveHit(hit: VRRadialHit | null, hand: XRHandRole, effects: VRRadialControllerEffect[]): void {
    if (!hit || this.state !== 'open') return;
    if (hit.kind === 'center') {
      this.closeInto(effects, 'cancel', true);
      return;
    }
    if (hit.kind !== 'entry') return;

    const entry = this.entryForIndex(hit.index);
    if (!entry) return;
    if (entry.kind === 'previous-page') {
      this.changePage(this.pageIndex - 1, hand, effects);
      return;
    }
    if (entry.kind === 'next-page') {
      this.changePage(this.pageIndex + 1, hand, effects);
      return;
    }
    if (entry.kind !== 'action' && entry.kind !== 'submenu') return;
    if (!this.revalidate(entry)) {
      this.closeInto(effects, 'invalid', true);
      effects.push({ type: 'negative-haptic', hand });
      return;
    }
    if (entry.kind === 'submenu') {
      this.openSubmenu(entry, hand, effects);
      return;
    }
    if (entry.kind !== 'action') return;
    this.closeInto(effects, 'activated', true);
    effects.push({ type: 'confirm-haptic', hand });
    effects.push({ type: 'activate', item: entry, hand });
  }

  private openSubmenu(
    entry: Extract<VRRadialMenuItem, { readonly kind: 'submenu' }>,
    hand: XRHandRole,
    effects: VRRadialControllerEffect[],
  ): void {
    let menu: VRRadialMenuDefinition;
    try {
      menu = entry.buildMenu();
      validateVRRadialMenu(menu);
    } catch {
      this.closeInto(effects, 'invalid', true);
      effects.push({ type: 'negative-haptic', hand });
      return;
    }

    this.menu = menu;
    this.pageIndex = 0;
    this.hoveredId = null;
    effects.push({ type: 'confirm-haptic', hand });
  }

  private changePage(pageIndex: number, hand: XRHandRole, effects: VRRadialControllerEffect[]): void {
    if (!this.menu || pageIndex < 0 || pageIndex >= this.menu.pages.length) return;
    this.pageIndex = pageIndex;
    this.hoveredId = null;
    effects.push({ type: 'confirm-haptic', hand });
  }

  private closeInto(
    effects: VRRadialControllerEffect[],
    reason: VRRadialCloseReason,
    menuPressed: boolean,
  ): void {
    this.menu = null;
    this.pageIndex = 0;
    this.hoveredId = null;
    this.clearTouchOverlaps();
    this.state = menuPressed ? 'waiting-for-menu-release' : 'closed';
    effects.push({ type: 'closed', reason });
  }

  private entryForIndex(index: number): VRRadialMenuItem | null {
    const page = this.menu?.pages[this.pageIndex];
    if (!page || !Number.isInteger(index) || index < 0 || index >= page.entries.length) return null;
    return page.entries[index];
  }

  private hoveredIdFor(hit: VRRadialHit | null): string | 'cancel' | null {
    if (!hit) return null;
    if (hit.kind === 'center') return 'cancel';
    if (hit.kind !== 'entry') return null;
    return this.entryForIndex(hit.index)?.id ?? null;
  }

  private overlapIdFor(hit: VRRadialHit | null): string | null {
    if (!hit) return null;
    if (hit.kind === 'center') return 'center';
    if (hit.kind !== 'entry' || !this.entryForIndex(hit.index)) return null;
    return `entry:${hit.index}`;
  }

  private clearTouchOverlaps(): void {
    this.touchOverlapIds.left = null;
    this.touchOverlapIds.right = null;
  }

  private isValidMenu(menu: VRRadialMenuDefinition): boolean {
    try {
      validateVRRadialMenu(menu);
      return true;
    } catch {
      return false;
    }
  }

  private revalidate(entry: Extract<VRRadialMenuItem, { readonly revalidate: () => boolean }>): boolean {
    try {
      return entry.revalidate() === true;
    } catch {
      return false;
    }
  }
}
