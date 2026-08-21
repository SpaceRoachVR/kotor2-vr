import {
  createVRActionSourceKey,
} from './VRActionWheelModelBuilder';
import type {
  VRActionMenuEntry,
  VRActionWheelEngineAction,
} from './VRActionWheelModelBuilder';

export type VRActionMenuPanelKind = 'target' | 'self';

export interface VRActionMenuPanel {
  readonly actions: readonly VRActionMenuEntry[];
  selectedIndex: number;
}

export interface VRActionMenuPanelLists {
  readonly targetPanels: readonly VRActionMenuPanel[];
  readonly selfPanels: readonly VRActionMenuPanel[];
}

export interface VRActionMenuBridgeDependencies<TActor extends object, TTarget extends object> {
  getCurrentActor(): TActor | null;
  isTargetAvailable(actor: TActor, target: TTarget): boolean;
  refreshPanels(actor: TActor, target: TTarget | null): VRActionMenuPanelLists | null;
  getPlayerFacingLabel(entry: VRActionMenuEntry, target: TTarget | null): string;
  getIcon(entry: VRActionMenuEntry): string | undefined;
  onTargetMenuAction(panelIndex: number): void;
  onSelfMenuAction(panelIndex: number): void;
}

export interface VRActionMenuPanelSnapshot<TActor extends object, TTarget extends object> {
  readonly actor: TActor;
  readonly target: TTarget | null;
  readonly kind: VRActionMenuPanelKind;
  readonly panels: readonly VRActionMenuPanel[];
}

interface RefreshedActionSource {
  readonly panel: VRActionMenuPanel;
  readonly actionIndex: number;
}

/**
 * Converts an ActionMenuManager panel snapshot into engine-safe descriptors.
 * Engine ownership remains injected so this module cannot bypass the authored
 * target/self handlers or depend on GameState directly.
 */
export function snapshotVRActionMenuPanelEntries<TActor extends object, TTarget extends object>(
  snapshot: VRActionMenuPanelSnapshot<TActor, TTarget>,
  dependencies: VRActionMenuBridgeDependencies<TActor, TTarget>,
): readonly VRActionWheelEngineAction[] {
  if (!snapshot || !dependencies || !Array.isArray(snapshot.panels)) return [];
  if (snapshot.kind === 'target' && !snapshot.target) return [];
  if (snapshot.kind !== 'target' && snapshot.kind !== 'self') return [];

  const target = snapshot.kind === 'target' ? snapshot.target : null;
  const actions: VRActionWheelEngineAction[] = [];
  snapshot.panels.forEach((panel, panelIndex) => {
    if (!panel || !Array.isArray(panel.actions)) return;
    panel.actions.forEach((entry: VRActionMenuEntry) => {
      const source = describeSource(snapshot.kind, panelIndex, entry, target, dependencies);
      if (!source) return;
      actions.push({
        id: source.sourceKey,
        label: source.label,
        icon: source.icon,
        revalidate: () => refreshActionSource(
          snapshot.actor,
          target,
          snapshot.kind,
          panelIndex,
          source.sourceKey,
          dependencies,
        ) !== null,
        activate: () => {
          const refreshed = refreshActionSource(
            snapshot.actor,
            target,
            snapshot.kind,
            panelIndex,
            source.sourceKey,
            dependencies,
          );
          if (!refreshed) return;
          refreshed.panel.selectedIndex = refreshed.actionIndex;
          if (snapshot.kind === 'target') {
            dependencies.onTargetMenuAction(panelIndex);
          } else {
            dependencies.onSelfMenuAction(panelIndex);
          }
        },
      });
    });
  });
  return actions;
}

function refreshActionSource<TActor extends object, TTarget extends object>(
  actor: TActor,
  target: TTarget | null,
  kind: VRActionMenuPanelKind,
  panelIndex: number,
  sourceKey: string,
  dependencies: VRActionMenuBridgeDependencies<TActor, TTarget>,
): RefreshedActionSource | null {
  try {
    if (dependencies.getCurrentActor() !== actor) return null;
    if (target && !dependencies.isTargetAvailable(actor, target)) return null;
    const panels = dependencies.refreshPanels(actor, target);
    if (!panels) return null;
    const panel = kind === 'target'
      ? panels.targetPanels[panelIndex]
      : panels.selfPanels[panelIndex];
    if (!panel || !Array.isArray(panel.actions)) return null;
    const actionIndex = panel.actions.findIndex((entry) =>
      describeSource(kind, panelIndex, entry, target, dependencies)?.sourceKey === sourceKey
    );
    return actionIndex >= 0 ? { panel, actionIndex } : null;
  } catch {
    return null;
  }
}

function describeSource<TActor extends object, TTarget extends object>(
  kind: VRActionMenuPanelKind,
  panelIndex: number,
  entry: VRActionMenuEntry,
  target: TTarget | null,
  dependencies: VRActionMenuBridgeDependencies<TActor, TTarget>,
): { readonly sourceKey: string; readonly label: string; readonly icon?: string } | null {
  if (!entry || typeof entry !== 'object') return null;
  try {
    const label = dependencies.getPlayerFacingLabel(entry, target);
    const sourceKey = createVRActionSourceKey(kind, panelIndex, {
      action: entry.action,
      talent: entry.talent,
      item: entry.item,
      icon: entry.icon,
      playerFacingLabel: label,
    });
    return { sourceKey, label, icon: dependencies.getIcon(entry) };
  } catch {
    return null;
  }
}
