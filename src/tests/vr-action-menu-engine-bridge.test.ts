import { expect, test } from '@jest/globals';
import {
  snapshotVRActionMenuPanelEntries,
  VRActionMenuBridgeDependencies,
  VRActionMenuPanel,
  VRActionMenuPanelLists,
} from '@/vr/runtime/VRActionMenuEngineBridge';
import { VRActionMenuEntry } from '@/vr/runtime/VRActionWheelModelBuilder';

interface TestActor {
  readonly id: string;
}

interface TestTarget {
  readonly id: string;
  readonly selectable: boolean;
  readonly hostile: boolean;
}

interface TestEntry extends VRActionMenuEntry {
  readonly playerFacingLabel: string;
}

interface BridgeHarness {
  readonly dependencies: VRActionMenuBridgeDependencies<TestActor, TestTarget>;
  currentActor: TestActor | null;
  refreshedPanels: VRActionMenuPanelLists;
  refreshCount: number;
  readonly refreshTargets: Array<TestTarget | null>;
  readonly targetDispatches: number[];
  readonly selfDispatches: number[];
}

function entry(type: number, label: string): TestEntry {
  return {
    action: { type },
    icon: `icon-${type}`,
    playerFacingLabel: label,
  };
}

function target(overrides: Partial<TestTarget> = {}): TestTarget {
  return { id: 'mercenary', selectable: true, hostile: true, ...overrides };
}

function panel(actions: readonly VRActionMenuEntry[], selectedIndex = 0): VRActionMenuPanel {
  return { actions, selectedIndex };
}

function panels(
  targetPanels: readonly VRActionMenuPanel[] = [],
  selfPanels: readonly VRActionMenuPanel[] = [],
): VRActionMenuPanelLists {
  return { targetPanels, selfPanels };
}

function harness(actor: TestActor, refreshedPanels: VRActionMenuPanelLists): BridgeHarness {
  const state = {
    currentActor: actor as TestActor | null,
    refreshedPanels,
    refreshCount: 0,
    refreshTargets: [] as Array<TestTarget | null>,
    targetDispatches: [] as number[],
    selfDispatches: [] as number[],
  };
  return Object.assign(state, {
    dependencies: {
      getCurrentActor: () => state.currentActor,
      isTargetAvailable: (_actor: TestActor, candidate: TestTarget) =>
        candidate.selectable && candidate.hostile,
      refreshPanels: (_actor: TestActor, target: TestTarget | null) => {
        state.refreshCount += 1;
        state.refreshTargets.push(target);
        return state.refreshedPanels;
      },
      getPlayerFacingLabel: (candidate: VRActionMenuEntry) =>
        (candidate as TestEntry).playerFacingLabel,
      getIcon: (candidate: VRActionMenuEntry) =>
        typeof candidate.icon === 'string' ? candidate.icon : undefined,
      onTargetMenuAction: (panelIndex: number) => { state.targetDispatches.push(panelIndex); },
      onSelfMenuAction: (panelIndex: number) => { state.selfDispatches.push(panelIndex); },
    },
  });
}

test('target activation refreshes authoritatively, selects the live match, and delegates only to the target handler', () => {
  const actor = { id: 'exile' };
  const nominatedTarget = target();
  const initialPanels = panels([panel([entry(1, 'Attack')])]);
  const livePanel = panel([entry(2, 'Flurry'), entry(1, 'Attack')]);
  const state = harness(actor, panels([livePanel]));
  const [action] = snapshotVRActionMenuPanelEntries(
    { actor, target: nominatedTarget, kind: 'target', panels: initialPanels.targetPanels },
    state.dependencies,
  );

  expect(action.revalidate()).toBe(true);
  action.activate();

  expect(state.refreshCount).toBe(2);
  expect(state.refreshTargets).toEqual([nominatedTarget, nominatedTarget]);
  expect(livePanel.selectedIndex).toBe(1);
  expect(state.targetDispatches).toEqual([0]);
  expect(state.selfDispatches).toEqual([]);
});

test('self activation refreshes and delegates only to the self handler', () => {
  const actor = { id: 'exile' };
  const initialPanels = panels([], [panel([]), panel([entry(7, 'Force Valor')])]);
  const livePanel = panel([entry(8, 'Force Speed'), entry(7, 'Force Valor')]);
  const state = harness(actor, panels([], [panel([]), livePanel]));
  const [action] = snapshotVRActionMenuPanelEntries(
    { actor, target: null, kind: 'self', panels: initialPanels.selfPanels },
    state.dependencies,
  );

  action.activate();

  expect(state.refreshTargets).toEqual([null]);
  expect(livePanel.selectedIndex).toBe(1);
  expect(state.selfDispatches).toEqual([1]);
  expect(state.targetDispatches).toEqual([]);
});

test('revalidation uses refreshed panels instead of a mutated captured panel', () => {
  const actor = { id: 'exile' };
  const capturedPanel = panel([entry(1, 'Attack')]);
  const state = harness(actor, panels([panel([entry(1, 'Attack')])]));
  const [action] = snapshotVRActionMenuPanelEntries(
    { actor, target: target(), kind: 'target', panels: [capturedPanel] },
    state.dependencies,
  );
  (capturedPanel.actions as VRActionMenuEntry[]).splice(0, 1, entry(9, 'Critical Strike'));

  expect(action.revalidate()).toBe(true);
});

test('a changed source identity fails closed without selecting or delegating', () => {
  const actor = { id: 'exile' };
  const livePanel = panel([entry(2, 'Flurry')], 0);
  const state = harness(actor, panels([livePanel]));
  const [action] = snapshotVRActionMenuPanelEntries(
    { actor, target: target(), kind: 'target', panels: [panel([entry(1, 'Attack')])] },
    state.dependencies,
  );

  expect(action.revalidate()).toBe(false);
  action.activate();

  expect(livePanel.selectedIndex).toBe(0);
  expect(state.targetDispatches).toEqual([]);
  expect(state.selfDispatches).toEqual([]);
});

test('a changed actor fails closed before refreshing or delegating', () => {
  const actor = { id: 'exile' };
  const state = harness(actor, panels([panel([entry(1, 'Attack')])]));
  const [action] = snapshotVRActionMenuPanelEntries(
    { actor, target: target(), kind: 'target', panels: [panel([entry(1, 'Attack')])] },
    state.dependencies,
  );
  state.currentActor = { id: 'kreia' };

  expect(action.revalidate()).toBe(false);
  action.activate();

  expect(state.refreshCount).toBe(0);
  expect(state.targetDispatches).toEqual([]);
});

test.each([
  ['removed', target({ selectable: false })],
  ['non-hostile', target({ hostile: false })],
] as const)('a %s target fails closed without refreshing or delegating', (_reason, unavailableTarget) => {
  const actor = { id: 'exile' };
  const state = harness(actor, panels([panel([entry(1, 'Attack')])]));
  const [action] = snapshotVRActionMenuPanelEntries(
    { actor, target: unavailableTarget, kind: 'target', panels: [panel([entry(1, 'Attack')])] },
    state.dependencies,
  );

  expect(action.revalidate()).toBe(false);
  action.activate();

  expect(state.refreshCount).toBe(0);
  expect(state.targetDispatches).toEqual([]);
});

test('self actions remain independent when no target is available', () => {
  const actor = { id: 'exile' };
  const livePanel = panel([entry(7, 'Force Valor')]);
  const state = harness(actor, panels([], [livePanel]));
  const [action] = snapshotVRActionMenuPanelEntries(
    { actor, target: null, kind: 'self', panels: [panel([entry(7, 'Force Valor')])] },
    state.dependencies,
  );

  expect(action.revalidate()).toBe(true);
  action.activate();

  expect(livePanel.selectedIndex).toBe(0);
  expect(state.selfDispatches).toEqual([0]);
});
