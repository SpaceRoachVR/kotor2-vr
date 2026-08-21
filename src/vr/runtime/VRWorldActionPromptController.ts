import { RoutedXRAction } from './XRInputRouter';
import { SemanticXRAction, XRHandRole } from './XRTypes';
import {
  VRWorldActionPromptModel,
  VRWorldPromptAction,
  VRWorldPromptEntry,
  VRWorldPromptPage,
} from './VRWorldActionPromptModel';

export interface VRWorldPromptPresentation {
  readonly model: VRWorldActionPromptModel;
  readonly pageIndex: number;
  readonly page: VRWorldPromptPage;
  readonly hoveredId: string | null;
}

export type VRWorldPromptEffect =
  | { readonly type: 'closed' }
  | { readonly type: 'negative-haptic'; readonly hand: XRHandRole }
  | { readonly type: 'activate'; readonly action: VRWorldPromptAction; readonly hand: XRHandRole };

export type VRWorldPromptHoverByHand = Readonly<Partial<Record<XRHandRole, string | null>>>;

const HAND_ORDER: readonly XRHandRole[] = ['left', 'right'];

/**
 * Engine-independent state machine for the static world-action prompt.
 * It emits intents only; the runtime integration owns action execution and haptics.
 */
export class VRWorldActionPromptController {
  private model: VRWorldActionPromptModel | null = null;
  private pageIndex = 0;
  private hoveredId: string | null = null;
  private readonly pressed: Record<XRHandRole, boolean> = { left: false, right: false };

  get presentation(): VRWorldPromptPresentation | null {
    if (!this.model) return null;
    const page = this.model.pages[this.pageIndex];
    if (!page) return null;
    return {
      model: this.model,
      pageIndex: this.pageIndex,
      page,
      hoveredId: this.hoveredId,
    };
  }

  process(
    model: VRWorldActionPromptModel | null,
    hoveredByHand: VRWorldPromptHoverByHand,
    actions: readonly RoutedXRAction[],
  ): readonly VRWorldPromptEffect[] {
    if (!hoveredByHand || typeof hoveredByHand !== 'object') {
      throw new TypeError('world prompt hover state is required');
    }
    if (!Array.isArray(actions)) {
      throw new TypeError('world prompt actions must be an array');
    }

    if (!isPresentableModel(model)) {
      return this.close();
    }

    if (this.model?.id !== model.id) {
      this.resetState();
      this.model = model;
    } else {
      this.model = model;
      if (!this.model.pages[this.pageIndex]) this.pageIndex = 0;
    }

    const page = this.model.pages[this.pageIndex];
    this.hoveredId = resolveDisplayedHover(page, hoveredByHand);

    const nextPressed = resolveSelectPressed(actions);
    const pressedEdges: Record<XRHandRole, boolean> = {
      left: nextPressed.left && !this.pressed.left,
      right: nextPressed.right && !this.pressed.right,
    };
    this.pressed.left = nextPressed.left;
    this.pressed.right = nextPressed.right;

    for (const hand of HAND_ORDER) {
      if (!pressedEdges[hand]) continue;
      const hoveredId = normalizeHoveredId(hoveredByHand[hand]);
      const entry = hoveredId === null ? null : findEntry(page, hoveredId);
      if (!entry) continue;
      return this.resolveEntry(entry, hand);
    }
    return [];
  }

  private resolveEntry(entry: VRWorldPromptEntry, hand: XRHandRole): readonly VRWorldPromptEffect[] {
    if (entry.kind === 'previous-page') {
      if (this.pageIndex > 0) this.pageIndex -= 1;
      this.hoveredId = null;
      return [];
    }
    if (entry.kind === 'next-page') {
      if (this.model && this.pageIndex + 1 < this.model.pages.length) this.pageIndex += 1;
      this.hoveredId = null;
      return [];
    }
    if (entry.kind !== 'action') return [];

    if (!revalidate(entry)) {
      return [{ type: 'negative-haptic', hand }];
    }
    return [{ type: 'activate', action: entry, hand }];
  }

  private close(): readonly VRWorldPromptEffect[] {
    if (!this.model) {
      this.resetState();
      return [];
    }
    this.model = null;
    this.resetState();
    return [{ type: 'closed' }];
  }

  private resetState(): void {
    this.pageIndex = 0;
    this.hoveredId = null;
    this.pressed.left = false;
    this.pressed.right = false;
  }
}

function isPresentableModel(model: VRWorldActionPromptModel | null): model is VRWorldActionPromptModel {
  if (!model || typeof model.id !== 'string' || model.id.trim().length === 0) return false;
  if (!Array.isArray(model.pages) || model.pages.length === 0) return false;
  return model.pages.every((page) =>
    Boolean(page) && Array.isArray(page.entries) && page.entries.length > 0);
}

function resolveSelectPressed(actions: readonly RoutedXRAction[]): Record<XRHandRole, boolean> {
  const pressed: Record<XRHandRole, boolean> = { left: false, right: false };
  for (const action of actions) {
    if (action?.action !== SemanticXRAction.Select || !HAND_ORDER.includes(action.hand)) continue;
    if (action.pressed === true) pressed[action.hand] = true;
  }
  return pressed;
}

function resolveDisplayedHover(
  page: VRWorldPromptPage,
  hoveredByHand: VRWorldPromptHoverByHand,
): string | null {
  for (const hand of HAND_ORDER) {
    const id = normalizeHoveredId(hoveredByHand[hand]);
    if (id !== null && findEntry(page, id)) return id;
  }
  return null;
}

function normalizeHoveredId(id: string | null | undefined): string | null {
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

function findEntry(page: VRWorldPromptPage, id: string): VRWorldPromptEntry | null {
  return page.entries.find((entry) => entry.id === id) ?? null;
}

function revalidate(action: VRWorldPromptAction): boolean {
  try {
    return action.revalidate() === true;
  } catch {
    return false;
  }
}
