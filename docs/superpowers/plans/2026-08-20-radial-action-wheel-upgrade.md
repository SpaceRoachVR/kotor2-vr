# Radial Action Wheel Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed, pausing wrist/context radials with one dynamic all-purpose `X` action wheel and proactive ray-operated world-object action prompts.

**Architecture:** Introduce pure radial model, pagination, layout, and state-machine modules, then keep THREE rendering, XR orchestration, engine action bridging, and world-prompt selection behind narrow interfaces. The wheel snapshots actions at open but revalidates before delegating to the existing `ActionMenuManager`, menu, and `PartyManager` routes; world prompts describe direct use without executing it and reuse authored target actions.

**Tech Stack:** TypeScript 5.9, THREE.js 0.149, WebXR, Jest 30 with ts-jest, KotOR.js `ActionMenuManager`, Quest Touch semantic input profiles.

**Spec:** `docs/superpowers/specs/2026-08-20-radial-action-wheel-design.md`

## Global Constraints

- Left-controller `X` opens the all-purpose wheel; remove the separate wrist radial and the old `Y` contextual radial route.
- The wheel is world-fixed per opening at 0.85 m forward and 0.25 m below the captured head pose.
- Use a 0.33 m outer radius, 0.105 m cancel radius, 0.06 m touch depth, 0.025 m hover extrusion, and two-degree inter-slice gaps.
- Support at most six content actions per page plus dedicated previous/next navigation wedges.
- Only the left controller ray hovers wheel slices; either controller target-ray origin may directly touch them.
- Left-trigger press while the left ray hovers an action confirms it; direct touch activates immediately.
- Left-trigger press on previous/next changes one page immediately; center trigger cancels; a no-target trigger does nothing; releasing `X` always cancels without engine mutation.
- Keep engine simulation, locomotion, and turning running while the wheel is open; suppress only conflicting combat, world-use, and UI activation.
- Omit unavailable actions. Revalidate every action before dispatch and never substitute a different action after failure.
- Preserve the existing VR Comfort Settings route as a static wheel action when retiring the wrist radial.
- The conditional Level-Up slice opens `MenuCharacter`, whose Auto Level-Up route works; never open the empty `MenuLevelUp` shell.
- The radial's Map slice opens `MenuMap`; `MenuGalaxyMap` remains reachable only through its world console.
- World-object prompts are ray-only, accept either controller's ray/trigger, and disappear immediately on range, visibility, front-cone, line-of-sight, object, or action loss.
- Preserve authored action queues, targeting, costs, cooldowns, scripts, locks, keys, menus, and d20 resolution.
- Report automated, browser, and physical Quest 3 evidence separately.

---

## File Structure

### New runtime modules

- `src/vr/runtime/VRRadialMenuModel.ts` — immutable item/menu/page types, validation, and six-content-item pagination.
- `src/vr/runtime/VRRadialMenuLayout.ts` — pure sector geometry and ray/touch hit resolution.
- `src/vr/runtime/VRActionWheelModelBuilder.ts` — deterministic top-level and nested party menu construction from validated engine-facing action descriptors.
- `src/vr/runtime/VRHapticFeedback.ts` — best-effort per-hand WebXR haptic port with once-per-session diagnostics.
- `src/vr/runtime/VRWorldActionPromptModel.ts` — prompt action/page types, candidate priority, and four-action pagination.
- `src/vr/runtime/VRWorldActionPromptController.ts` — prompt hover/select press-edge state and stale-model cleanup.
- `src/vr/runtime/VRWorldActionPromptHost.ts` — billboard canvas row and rectangular hit mapping beneath the target name.

### Replaced or modified runtime modules

- `src/vr/runtime/VRRadialMenuController.ts` — replace the fixed four-way controller with the approved state machine.
- `src/vr/runtime/VRRadialMenuHost.ts` — replace the hand-anchored canvas with a world-fixed wedge group, icon/label planes, and collision surface.
- `src/vr/runtime/VRWorldUseAdapter.ts` — split non-mutating direct-use description from activation.
- `src/vr/runtime/ModuleObjectInteractionTarget.ts` — export the validated object anchor helper for prompts.
- `src/vr/runtime/XRInputRouter.ts` — map Menu to left-hand button 4, left-trigger Select to the wheel context, and either-hand Select to the world-prompt context.
- `src/vr/runtime/XRTypes.ts` — remove the obsolete `Wrist` semantic action.
- `src/vr/VRSpike.ts` — orchestrate wheel placement/hits/effects, haptics, prompt priority, and revised input ownership.
- `src/GameState.ts` — provide action-wheel and world-prompt bridges and remove obsolete pause/context-panel state.
- `DESIGN.md` and `ROADMAP.md` — record the new non-pausing wheel and prompt behavior.

### Removed runtime module

- `src/vr/runtime/VRContextActionPanelController.ts` — the proactive world prompt supersedes post-activation legacy-overlay ownership.

### New tests

- `src/tests/vr-radial-menu-model.test.ts`
- `src/tests/vr-radial-menu-layout.test.ts`
- `src/tests/vr-action-wheel-model-builder.test.ts`
- `src/tests/vr-haptic-feedback.test.ts`
- `src/tests/vr-world-action-prompt-model.test.ts`
- `src/tests/vr-world-action-prompt-controller.test.ts`
- `src/tests/vr-world-action-prompt-host.test.ts`

### Modified or removed tests

- Modify `src/tests/vr-radial-menu-controller.test.ts`.
- Modify `src/tests/vr-radial-menu-host.test.ts`.
- Modify `src/tests/vr-world-use-adapter.test.ts`.
- Modify `src/tests/module-object-interaction-target.test.ts`.
- Modify `src/tests/xr-input-router.test.ts`.
- Modify `src/tests/vr-spike-xr-loop.test.ts`.
- Remove `src/tests/vr-context-action-panel-controller.test.ts` with its superseded runtime class.

---

### Task 1: Immutable radial menu model and deterministic pagination

**Files:**
- Create: `src/vr/runtime/VRRadialMenuModel.ts`
- Create: `src/tests/vr-radial-menu-model.test.ts`

**Interfaces:**
- Produces: `VRRadialActionItem`, `VRRadialSubmenuItem`, `VRRadialContentItem`, `VRRadialNavigationItem`, `VRRadialPage`, `VRRadialMenuDefinition`, `paginateVRRadialItems(items: readonly VRRadialContentItem[], contentPerPage?: number)`, and `validateVRRadialMenu(menu: VRRadialMenuDefinition)`.
- Consumes: no engine or THREE dependencies.

- [ ] **Step 1: Write failing pagination and validation tests**

```ts
import { describe, expect, jest, test } from '@jest/globals';
import {
  paginateVRRadialItems,
  validateVRRadialMenu,
  VRRadialActionItem,
} from '@/vr/runtime/VRRadialMenuModel';

const action = (id: string): VRRadialActionItem => ({
  kind: 'action', id, label: id, revalidate: () => true, activate: jest.fn(),
});

test.each([
  [0, []],
  [1, [['action-0']]],
  [6, [['action-0', 'action-1', 'action-2', 'action-3', 'action-4', 'action-5']]],
  [7, [
    ['action-0', 'action-1', 'action-2', 'action-3', 'action-4', 'action-5', 'nav:next'],
    ['nav:previous', 'action-6'],
  ]],
  [13, [
    ['action-0', 'action-1', 'action-2', 'action-3', 'action-4', 'action-5', 'nav:next'],
    ['nav:previous', 'action-6', 'action-7', 'action-8', 'action-9', 'action-10', 'action-11', 'nav:next'],
    ['nav:previous', 'action-12'],
  ]],
])('paginates %i content items with dedicated navigation', (count, expected) => {
  const pages = paginateVRRadialItems(
    Array.from({ length: count }, (_, index) => action(`action-${index}`))
  );
  expect(pages.map((page) => page.entries.map((entry) => entry.id))).toEqual(expected);
});

test('rejects duplicate ids and empty menus', () => {
  expect(() => validateVRRadialMenu({ id: 'empty', title: 'Empty', pages: [] })).toThrow('at least one page');
  const pages = paginateVRRadialItems([action('same'), action('same')]);
  expect(() => validateVRRadialMenu({ id: 'duplicate', title: 'Menu', pages })).toThrow('duplicate item id');
});
```

- [ ] **Step 2: Run the focused test and verify the missing-module failure**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-model.test.ts`

Expected: FAIL because `VRRadialMenuModel` does not exist.

- [ ] **Step 3: Implement the discriminated model and pagination**

```ts
export interface VRRadialActionItem {
  readonly kind: 'action';
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  activate(): void;
}

export interface VRRadialSubmenuItem {
  readonly kind: 'submenu';
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  buildMenu(): VRRadialMenuDefinition;
}

export type VRRadialContentItem = VRRadialActionItem | VRRadialSubmenuItem;
export interface VRRadialNavigationItem {
  readonly kind: 'previous-page' | 'next-page';
  readonly id: 'nav:previous' | 'nav:next';
  readonly label: 'Previous' | 'Next';
}
export type VRRadialMenuItem = VRRadialContentItem | VRRadialNavigationItem;
export interface VRRadialPage { readonly index: number; readonly entries: readonly VRRadialMenuItem[]; }
export interface VRRadialMenuDefinition { readonly id: string; readonly title: string; readonly pages: readonly VRRadialPage[]; }

export function paginateVRRadialItems(
  items: readonly VRRadialContentItem[],
  contentPerPage = 6
): readonly VRRadialPage[] {
  if (!Number.isInteger(contentPerPage) || contentPerPage < 1 || contentPerPage > 6) {
    throw new RangeError('contentPerPage must be an integer from 1 through 6');
  }
  const pages: VRRadialPage[] = [];
  for (let offset = 0; offset < items.length; offset += contentPerPage) {
    const index = pages.length;
    const entries: VRRadialMenuItem[] = [];
    if (index > 0) entries.push({ kind: 'previous-page', id: 'nav:previous', label: 'Previous' });
    entries.push(...items.slice(offset, offset + contentPerPage));
    if (offset + contentPerPage < items.length) entries.push({ kind: 'next-page', id: 'nav:next', label: 'Next' });
    pages.push({ index, entries });
  }
  return pages;
}
```

Implement `validateVRRadialMenu` to require a non-empty trimmed menu ID/title, at least one page, sequential page indices, 1-8 entries per page, non-empty unique content IDs across the whole menu, valid labels, and callable `revalidate`/`activate` or `buildMenu` functions.

- [ ] **Step 4: Run the model tests**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-model.test.ts`

Expected: PASS.

- [ ] **Step 5: Type-check and commit**

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

```powershell
git add src/vr/runtime/VRRadialMenuModel.ts src/tests/vr-radial-menu-model.test.ts
git commit -m "feat: add radial menu model and pagination"
```

---

### Task 2: Shared pie-slice geometry for rendering, ray hits, and touch hits

**Files:**
- Create: `src/vr/runtime/VRRadialMenuLayout.ts`
- Create: `src/tests/vr-radial-menu-layout.test.ts`

**Interfaces:**
- Consumes: `XRWorldPose` from `src/vr/runtime/XRTypes.ts`.
- Produces: `VR_RADIAL_LAYOUT`, `VRRadialSector`, `VRRadialHit`, `createVRRadialSectors(count)`, `resolveVRRadialPoint(point, count)`, `resolveVRRadialRay(root, pose, count)`, and `resolveVRRadialTouch(root, worldProbe, count)`.

- [ ] **Step 1: Write failing geometry tests for sectors, gaps, center, outside, ray, and touch**

```ts
import * as THREE from 'three';
import { describe, expect, test } from '@jest/globals';
import {
  createVRRadialSectors,
  resolveVRRadialPoint,
  resolveVRRadialRay,
  resolveVRRadialTouch,
} from '@/vr/runtime/VRRadialMenuLayout';

test.each([1, 2, 6, 7, 8])('creates %i equal sectors with two-degree gaps', (count) => {
  const sectors = createVRRadialSectors(count);
  expect(sectors).toHaveLength(count);
  expect(sectors[0].endAngle - sectors[0].startAngle).toBeCloseTo((Math.PI * 2 / count) - THREE.MathUtils.degToRad(2));
});

test('classifies center, entry, gap, and outside without overlap', () => {
  expect(resolveVRRadialPoint(new THREE.Vector2(0, 0), 6)).toEqual({ kind: 'center' });
  expect(resolveVRRadialPoint(new THREE.Vector2(0, 0.2), 6)).toEqual({ kind: 'entry', index: 0 });
  expect(resolveVRRadialPoint(new THREE.Vector2(0, 0.34), 6)).toBeNull();
});

test('uses the same local point for a ray and a 6cm-deep touch probe', () => {
  const root = new THREE.Group();
  root.position.set(0, 1, 1.4);
  root.rotateX(Math.PI / 2);
  root.updateWorldMatrix(true, true);
  const ray = resolveVRRadialRay(root, pose(new THREE.Vector3(0, 0, 1.4)), 6);
  const localPoint = new THREE.Vector3(0, 0.2, 0.04).applyMatrix4(root.matrixWorld);
  expect(ray?.hit.kind).toBe('entry');
  expect(resolveVRRadialTouch(root, localPoint, 6)?.hit).toEqual({ kind: 'entry', index: 0 });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-layout.test.ts`

Expected: FAIL because the layout module is missing.

- [ ] **Step 3: Implement constants and finite-input validation**

```ts
export const VR_RADIAL_LAYOUT = Object.freeze({
  outerRadiusMetres: 0.33,
  innerRadiusMetres: 0.105,
  touchDepthMetres: 0.06,
  hoverExtrusionMetres: 0.025,
  gapRadians: THREE.MathUtils.degToRad(2),
});

export interface VRRadialSector { readonly index: number; readonly startAngle: number; readonly endAngle: number; }
export type VRRadialHit = { readonly kind: 'center' } | { readonly kind: 'entry'; readonly index: number };
```

Start sector zero at top (`Math.PI / 2`) and proceed clockwise. Subtract half the gap from each side. Treat points inside a gap as no hit. Validate counts as integers from 1 through 8, vectors as finite, ray directions as non-zero, and root matrices as finite.

- [ ] **Step 4: Implement ray-plane and world-to-local touch resolution**

Use the root's world quaternion to derive the local positive-Z plane normal. Intersect the target ray from local `-Z` transformed by `XRWorldPose.orientation`; reject intersections behind the controller. For touch, transform the world probe with `root.matrixWorld.clone().invert()`, reject `Math.abs(local.z) > 0.06`, then call the same point classifier used by the ray.

- [ ] **Step 5: Run the layout tests and type-check**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-layout.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: both PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/vr/runtime/VRRadialMenuLayout.ts src/tests/vr-radial-menu-layout.test.ts
git commit -m "feat: add radial ray and touch geometry"
```

---

### Task 3: Hold-to-open, trigger-confirm radial state machine

**Files:**
- Replace: `src/vr/runtime/VRRadialMenuController.ts`
- Modify: `src/tests/vr-radial-menu-controller.test.ts`

**Interfaces:**
- Consumes: `VRRadialMenuDefinition`, `VRRadialActionItem`, `VRRadialHit`, and `XRHandRole`.
- Produces: `VRRadialControllerInput`, `VRRadialPresentation`, `VRRadialControllerEffect`, `VRRadialMenuController.process(input)`, `presentation`, `isOpen`, and `close(reason)`.

- [ ] **Step 1: Replace old four-quadrant tests with failing approved-flow tests**

```ts
test('opens on X, confirms the left-ray action on left-trigger press, and closes before activation', () => {
  const activate = jest.fn();
  const controller = new VRRadialMenuController();
  const menu = singlePageMenu([{ kind: 'action', id: 'attack', label: 'Attack', revalidate: () => true, activate }]);
  expect(controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menu, rayHit: null }))).toContainEqual({ type: 'opened' });
  controller.process(input({ menuPressed: true, selectPressed: false, rayHit: { kind: 'entry', index: 0 } }));
  const effects = controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 0 } }));
  expect(controller.isOpen).toBe(false);
  expect(effects).toEqual(expect.arrayContaining([{ type: 'activate', item: expect.objectContaining({ id: 'attack' }), hand: 'left' }]));
  expect(activate).not.toHaveBeenCalled();
});

test.each([null, { kind: 'center' } as const, { kind: 'entry', index: 0 } as const])('X release over %p cancels without activation', (hit) => {
  const controller = new VRRadialMenuController();
  controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menuWithAction(), rayHit: hit }));
  expect(controller.process(input({ menuPressed: false, selectPressed: false, rayHit: hit }))).toContainEqual({ type: 'closed', reason: 'cancel' });
});

test('left-trigger on center cancels while a no-target trigger leaves the wheel open', () => {
  const controller = new VRRadialMenuController();
  controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menuWithAction(), rayHit: null }));
  controller.process(input({ menuPressed: true, selectPressed: true, rayHit: null }));
  expect(controller.isOpen).toBe(true);
  controller.process(input({ menuPressed: true, selectPressed: false, rayHit: { kind: 'center' } }));
  expect(controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'center' } }))).toContainEqual({ type: 'closed', reason: 'cancel' });
});

test('direct touch activates immediately and waits for X release before reopening', () => {
  const controller = new VRRadialMenuController();
  controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menuWithAction(), rayHit: null }));
  expect(controller.process(input({ menuPressed: true, selectPressed: false, rayHit: null, touchHits: { right: { kind: 'entry', index: 0 } } }))[0].type).toBe('activate');
  expect(controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menuWithAction(), rayHit: null })).some((effect) => effect.type === 'opened')).toBe(false);
  controller.process(input({ menuPressed: false, selectPressed: false, rayHit: null }));
  expect(controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menuWithAction(), rayHit: null })).some((effect) => effect.type === 'opened')).toBe(true);
});

test('left-trigger press changes one page immediately and holding it does not repeat', () => {
  const controller = new VRRadialMenuController();
  const menu = menuWithActions(7);
  controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menu, rayHit: null }));
  controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 6 } }));
  expect(controller.presentation?.pageIndex).toBe(1);
  controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 0 } }));
  expect(controller.presentation?.pageIndex).toBe(1);
  controller.process(input({ menuPressed: true, selectPressed: false, rayHit: { kind: 'entry', index: 0 } }));
  controller.process(input({ menuPressed: true, selectPressed: true, rayHit: { kind: 'entry', index: 0 } }));
  expect(controller.presentation?.pageIndex).toBe(0);
});

test('a Party submenu starts on page one and a new opening always resets to page one', () => {
  const controller = new VRRadialMenuController();
  controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menuWithParty(), rayHit: null }));
  controller.process(input({ menuPressed: true, selectPressed: false, rayHit: null, touchHits: { left: { kind: 'entry', index: 0 } } }));
  expect(controller.presentation?.menu.id).toBe('party');
  expect(controller.presentation?.pageIndex).toBe(0);
  controller.close('lifecycle');
  controller.process(input({ menuPressed: false, selectPressed: false, rayHit: null }));
  controller.process(input({ menuPressed: true, selectPressed: false, openingMenu: menuWithActions(7), rayHit: null }));
  expect(controller.presentation?.pageIndex).toBe(0);
});
```

- [ ] **Step 2: Run the controller test and observe failures against the old API**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-controller.test.ts`

Expected: FAIL because the old controller requires four items and has no page/touch/effect model.

- [ ] **Step 3: Implement controller inputs, presentation, and effects**

```ts
export interface VRRadialControllerInput {
  readonly menuPressed: boolean;
  readonly selectPressed: boolean;
  readonly openingMenu: VRRadialMenuDefinition | null;
  readonly rayHit: VRRadialHit | null;
  readonly touchHits: Readonly<Partial<Record<XRHandRole, VRRadialHit | null>>>;
}

export type VRRadialControllerEffect =
  | { readonly type: 'opened' }
  | { readonly type: 'closed'; readonly reason: 'cancel' | 'activated' | 'invalid' | 'lifecycle' }
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
```

Keep internal state as `closed | open | waiting-for-menu-release`. Ray hover may select only while open. Track the previous left-trigger state and act only on a false-to-true edge. Resolve touch in stable hand order `left`, then `right`; use per-hand overlap IDs so a continuous overlap fires once. Trigger or direct-touch navigation changes the page immediately and never emits an engine activation. Page changes clear hover state. A submenu calls only its pure `buildMenu()` after `revalidate()`, replaces the current menu, and starts at page one.

- [ ] **Step 4: Implement cancellation and activation ordering**

On an `X` release edge, close with `cancel` regardless of the ray hit. On a left-trigger press edge, resolve the current ray hit rather than a stale prior hover: null does nothing, center closes with `cancel`, navigation changes only the page, and an action calls `revalidate`. On false, close with `invalid` plus negative haptic. On true, transition to closed/waiting first, then emit `activate`; do not invoke the engine callback inside the controller.

- [ ] **Step 5: Run controller tests and type-check**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-controller.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/vr/runtime/VRRadialMenuController.ts src/tests/vr-radial-menu-controller.test.ts
git commit -m "feat: add radial hold trigger and touch state machine"
```

---

### Task 4: World-fixed wedge host, authentic icons, and pointer visualization

**Files:**
- Replace: `src/vr/runtime/VRRadialMenuHost.ts`
- Modify: `src/tests/vr-radial-menu-host.test.ts`

**Interfaces:**
- Consumes: `VRRadialPresentation`, `VRRadialHit`, `XRWorldPose`, `createVRRadialSectors`, `resolveVRRadialRay`, and `resolveVRRadialTouch`.
- Produces: `VRRadialIconLoader`, `VRRadialMenuHost.present(presentation, openingHeadPose)`, `resolveRay(pose)`, `resolveTouch(worldProbe)`, `clear()`, and `dispose()`.

- [ ] **Step 1: Write failing placement, hover, icon fallback, collision, and disposal tests**

```ts
test('places once 0.85m forward and 0.25m below the opening head pose', () => {
  const host = createHost();
  const head = pose(new THREE.Vector3(1, 2, 1.7), new THREE.Quaternion());
  host.present(presentation('attack'), head);
  const first = host.object.position.clone();
  host.present(presentation('map'), pose(new THREE.Vector3(5, 5, 5), new THREE.Quaternion()));
  expect(host.object.position).toEqual(first);
  expect(first.z).toBeCloseTo(1.45);
  expect(first.distanceTo(new THREE.Vector3(1, 2, 1.45))).toBeCloseTo(0.85);
});

test('extrudes only the hovered wedge and maps ray/touch through shared layout', () => {
  const host = createHost();
  host.present(presentation('attack'), headPose());
  expect(host.getWedge('attack').position.z).toBeCloseTo(0.025);
  expect(host.getWedge('map').position.z).toBe(0);
  expect(host.resolveRay(rayAtEntryZero())?.kind).toBe('entry');
  expect(host.resolveTouch(host.object.localToWorld(new THREE.Vector3(0, 0.2, 0.04)))?.kind).toBe('entry');
});

test('ignores a stale asynchronous icon load and disposes every owned resource', async () => {
  const deferred = createDeferred<THREE.Texture | null>();
  const host = createHost({ load: jest.fn(() => deferred.promise) });
  host.present(presentationFor(menu('menu-a', actionWithIcon('a', 'icon-a'))), headPose());
  host.clear();
  host.present(presentationFor(menu('menu-b', actionWithIcon('b', 'icon-b'))), headPose());
  const staleTexture = new THREE.Texture();
  deferred.resolve(staleTexture);
  await Promise.resolve();
  expect(host.getIconMaterial('b').map).not.toBe(staleTexture);
  const dispose = jest.spyOn(staleTexture, 'dispose');
  host.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the host tests and verify failure against the canvas host**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-host.test.ts`

Expected: FAIL because the current host is hand-anchored and exposes no wedge collision API.

- [ ] **Step 3: Implement the fixed root and wedge mesh creation**

Create one `THREE.ShapeGeometry` per sector using the layout angles and radii. Use `MeshBasicMaterial` colors from the spec, `depthTest: false`, `depthWrite: false`, and increasing render orders. Create a center disc with `CircleGeometry`, a red cancel-symbol texture, a plaque plane, a page-indicator plane, and a transparent collision disc covering the 0.33 m radius.

Place the root only when the opening menu ID changes:

```ts
const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(head.orientation);
forward.z = 0;
if (forward.lengthSq() <= 1e-8) forward.copy(this.lastHorizontalForward);
else this.lastHorizontalForward.copy(forward.normalize());
this.object.position.copy(head.position).addScaledVector(forward, 0.85);
this.object.position.z = head.position.z - 0.25;
this.object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
  new THREE.Vector3(0, 0, 1).cross(forward.clone().negate()).normalize(),
  new THREE.Vector3(0, 0, 1),
  forward.clone().negate()
));
```

- [ ] **Step 4: Implement labels, icon loading, fallback icons, and stale-load guards**

```ts
export interface VRRadialIconLoader {
  load(resref: string): Promise<THREE.Texture | null>;
}
```

Use a monotonically increasing presentation token. Before assigning an asynchronously loaded texture, verify the token and item ID still match. Fall back deterministically by label/category (`Attack`, Force, item/Medpac, Inventory, Map, Party, navigation) and log each failed resref once. Keep a bounded map of at most 64 resolved icon textures and dispose it on session teardown.

- [ ] **Step 5: Implement ray line, collision dot, and shared hit methods**

Update a two-point cyan `THREE.Line` from the left target-ray origin to the plane hit or the 5 m maximum. Show a small collision ring only on center/entry hits. Delegate sector classification to `VRRadialMenuLayout`; do not duplicate angle math in the host.

- [ ] **Step 6: Run host tests and type-check**

Run: `npx jest --runInBand --no-cache src/tests/vr-radial-menu-host.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/vr/runtime/VRRadialMenuHost.ts src/tests/vr-radial-menu-host.test.ts
git commit -m "feat: render world fixed radial wedges"
```

---

### Task 5: Engine-safe action-wheel model builder

**Files:**
- Create: `src/vr/runtime/VRActionWheelModelBuilder.ts`
- Create: `src/tests/vr-action-wheel-model-builder.test.ts`
- Modify: `src/GameState.ts`

**Interfaces:**
- Consumes: `VRRadialContentItem`, generic `VRActionWheelEngineAction`, static menu callbacks, `canLevelUp`, and party descriptors.
- Produces: `VRActionWheelBuildContext`, `VRActionWheelEngineAction`, `VRActionWheelPartyMember`, `buildVRActionWheel(context: VRActionWheelBuildContext)`, and `createVRActionSourceKey(kind: 'target' | 'self', panelIndex: number, entry: VRActionMenuEntry)`.
- Later tasks consume: `VRSpikeHooks.createActionWheel(aimedTargetId): VRRadialMenuDefinition | null`.

- [ ] **Step 1: Write failing builder tests for order, filtering, routes, party submenu, and revalidation**

```ts
test('orders combat, self, menus, conditional level-up, party, and comfort settings while omitting invalid entries', () => {
  const menu = buildVRActionWheel(context({
    targetActions: [engineAction('attack', 'Attack')],
    selfActions: [engineAction('force-lightning', 'Force Lightning')],
    canLevelUp: true,
    partyMembers: [partyMember('kreia', 'Kreia')],
  }));
  expect(contentIds(menu)).toEqual([
    'engine:attack', 'engine:force-lightning', 'menu:inventory', 'menu:character',
    'menu:map', 'menu:level-up', 'submenu:party', 'menu:comfort-settings',
  ]);
  expect(contentIds(menu)).not.toContain('menu:galaxy-map');
});

test('Level-Up opens Character and never the empty MenuLevelUp shell', () => {
  const openCharacter = jest.fn();
  const menu = buildVRActionWheel(context({ canLevelUp: true, openCharacter }));
  findAction(menu, 'menu:level-up').activate();
  expect(openCharacter).toHaveBeenCalledTimes(1);
});

test('party re-resolves the live index before switching', () => {
  const switchLeader = jest.fn();
  const member = partyMember('atton', 'Atton', { resolveCurrentIndex: () => 2, switchLeader });
  const partyMenu = findSubmenu(
    buildVRActionWheel(context({ partyMembers: [member] })),
    'submenu:party'
  ).buildMenu();
  const item = findAction(partyMenu, 'party:atton');
  expect(item.revalidate()).toBe(true);
  item.activate();
  expect(switchLeader).toHaveBeenCalledWith(2);
});

test('a refreshed engine action with a different source key fails instead of activating another action', () => {
  const source = engineAction('attack', 'Attack', { revalidate: () => false });
  expect(findAction(buildVRActionWheel(context({ targetActions: [source] })), 'engine:attack').revalidate()).toBe(false);
});
```

- [ ] **Step 2: Run the builder tests and verify the missing-module failure**

Run: `npx jest --runInBand --no-cache src/tests/vr-action-wheel-model-builder.test.ts`

Expected: FAIL because the builder does not exist.

- [ ] **Step 3: Implement generic descriptors and deterministic construction**

```ts
export interface VRActionWheelEngineAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  activate(): void;
}

export interface VRActionWheelPartyMember {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  resolveCurrentIndex(): number;
  switchLeader(index: number): void;
}

export interface VRActionWheelBuildContext {
  readonly id: string;
  readonly targetActions: readonly VRActionWheelEngineAction[];
  readonly selfActions: readonly VRActionWheelEngineAction[];
  readonly canLevelUp: boolean;
  readonly partyMembers: readonly VRActionWheelPartyMember[];
  readonly openInventory: () => void;
  readonly openCharacter: () => void;
  readonly openMap: () => void;
  readonly openComfortSettings: () => void;
}
```

Validate and deduplicate engine action IDs, append Inventory, Character, and Map, append Level-Up only when eligible, append Party only when another member exists, then append Comfort Settings. `menu:level-up` must call `openCharacter`; `menu:comfort-settings` must call `openComfortSettings`.

- [ ] **Step 4: Move `GameState` action extraction into bridge helpers**

Delete `buildVRRadialItems` and its local four-item padding. Add a bridge that snapshots each target/self panel entry with a source key composed from panel kind, panel index, action type, talent `__index`/label, item ID/name, icon, and player-facing label.

For every engine descriptor's `revalidate` and `activate`, refresh authoritatively:

```ts
function refreshVRActionSource(
  actor: ModuleCreature,
  target: ModuleObject | null,
  kind: 'target' | 'self',
  panelIndex: number,
  sourceKey: string
): { panel: VRActionPanel; actionIndex: number } | null {
  if (GameState.getCurrentPlayer() !== actor) return null;
  if (target && !GameState.ModuleObjectManager.playerSelectableObjects.includes(target)) return null;
  GameState.ActionMenuManager.SetPC(actor);
  if (target) GameState.ActionMenuManager.SetTarget(target);
  GameState.ActionMenuManager.UpdateMenuActions();
  const panel = kind === 'target'
    ? GameState.ActionMenuManager.ActionPanels.targetPanels[panelIndex]
    : GameState.ActionMenuManager.ActionPanels.selfPanels[panelIndex];
  const actionIndex = panel?.actions.findIndex((entry) => createVRActionSourceKey(kind, panelIndex, entry) === sourceKey) ?? -1;
  return actionIndex >= 0 ? { panel, actionIndex } : null;
}
```

On activation, set `selectedIndex` from the refreshed match and call the existing `onTargetMenuAction` or `onSelfMenuAction`. Do not call `attackCreature`, talent methods, or action queues directly from the new bridge.

- [ ] **Step 5: Add `createActionWheel` to the `VRSpike` hook contract and GameState install hook**

Replace `getRadialMenuContext`/`getWristMenuContext` with:

```ts
createActionWheel?: (aimedTargetId: number | null) => VRRadialMenuDefinition | null;
```

Use only a valid hostile nominated target for target-dependent combat actions. Supply self actions regardless of target. Supply `MenuInventory.open`, `MenuCharacter.open`, `MenuMap.open`, and the existing `vrComfortSettingsPanelOpen` route; do not reference `MenuGalaxyMap` or `MenuLevelUp`. Party descriptors must omit `party[0]` and re-resolve object identity with `PartyManager.party.indexOf(member)` immediately before switching.

- [ ] **Step 6: Run builder tests, affected GameState tests, and type-check**

Run: `npx jest --runInBand --no-cache src/tests/vr-action-wheel-model-builder.test.ts src/tests/vr-radial-menu-controller.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/vr/runtime/VRActionWheelModelBuilder.ts src/tests/vr-action-wheel-model-builder.test.ts src/GameState.ts src/vr/VRSpike.ts
git commit -m "feat: build all purpose VR action wheel"
```

---

### Task 6: Quest `X` binding, haptics, and VRSpike wheel orchestration

**Files:**
- Create: `src/vr/runtime/VRHapticFeedback.ts`
- Create: `src/tests/vr-haptic-feedback.test.ts`
- Modify: `src/vr/runtime/XRTypes.ts`
- Modify: `src/vr/runtime/XRInputRouter.ts`
- Modify: `src/tests/xr-input-router.test.ts`
- Modify: `src/vr/VRSpike.ts`
- Modify: `src/tests/vr-spike-xr-loop.test.ts`

**Interfaces:**
- Consumes: Tasks 3-5 controller/host/model APIs and `XRSession.inputSources`.
- Produces: `VRHapticFeedback.pulse(session, hand, pattern)`, `VRHapticPattern`, and the complete all-purpose wheel runtime path.

- [ ] **Step 1: Write failing input-profile tests for `X`, left-trigger wheel Select, and either-hand prompt Select contexts**

Add `radial-wheel` and `world-prompt` to `XRActionContext`, then test:

```ts
test('routes Quest left X as Menu and no longer emits Wrist', () => {
  const left = questController('left');
  const buttons = [...left.buttons];
  buttons[4] = { pressed: true, touched: true, value: 1 };
  const actions = new XRInputRouter().route([{ ...left, buttons }], new Set(['global']));
  expect(actions).toContainEqual(expect.objectContaining({ action: SemanticXRAction.Menu, hand: 'left', pressed: true }));
  expect(actions.some((action) => String(action.action) === 'wrist')).toBe(false);
});

test('routes only the Quest left trigger as Select in the radial-wheel context', () => {
  const controllers = (['left', 'right'] as const).map((hand) => {
    const controller = questController(hand);
    const buttons = [...controller.buttons];
    buttons[0] = { pressed: true, touched: true, value: 1 };
    return { ...controller, buttons };
  });
  const actions = new XRInputRouter().route(controllers, new Set(['radial-wheel']));
  expect(actions.filter((action) => action.action === SemanticXRAction.Select)).toEqual([
    expect.objectContaining({ hand: 'left', pressed: true }),
  ]);
});

test('routes either Quest trigger as Select only in the world-prompt context', () => {
  const controllers = (['left', 'right'] as const).map((hand) => {
    const controller = questController(hand);
    const buttons = [...controller.buttons];
    buttons[0] = { pressed: true, touched: true, value: 1 };
    return { ...controller, buttons };
  });
  const actions = new XRInputRouter().route(controllers, new Set(['world-prompt']));
  expect(actions.filter((action) => action.action === SemanticXRAction.Select)).toEqual([
    expect.objectContaining({ hand: 'left', pressed: true }),
    expect.objectContaining({ hand: 'right', pressed: true }),
  ]);
});
```

- [ ] **Step 2: Write failing haptic tests**

```ts
test('pulses only the requested hand with clamped values', async () => {
  const leftPulse = jest.fn().mockResolvedValue(true);
  const rightPulse = jest.fn().mockResolvedValue(true);
  await new VRHapticFeedback().pulse(session(leftPulse, rightPulse), 'left', { durationMs: 20, amplitude: 0.15 });
  expect(leftPulse).toHaveBeenCalledWith(0.15, 20);
  expect(rightPulse).not.toHaveBeenCalled();
});

test('reports a rejected actuator once and never rejects the frame caller', async () => {
  const logger = { warn: jest.fn() };
  const feedback = new VRHapticFeedback(logger);
  await expect(feedback.pulse(sessionWithRejectedPulse(), 'right', { durationMs: 60, amplitude: 0.45 })).resolves.toBeUndefined();
  await feedback.pulse(sessionWithRejectedPulse(), 'right', { durationMs: 60, amplitude: 0.45 });
  expect(logger.warn).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run input and haptic tests and verify failures**

Run: `npx jest --runInBand --no-cache src/tests/xr-input-router.test.ts src/tests/vr-haptic-feedback.test.ts`

Expected: FAIL because Wrist still owns button 4 and haptic feedback does not exist.

- [ ] **Step 4: Update semantic profiles and implement haptic feedback**

Extend `XRBindingHand` with literal `left | right` roles so bindings that are
physically labeled for one hand do not change when the dominant-hand setting
changes. Remove `SemanticXRAction.Wrist`, remove it from required actions, bind
Quest `Menu` global/left to button 4, and add:

```ts
{ action: SemanticXRAction.Select, context: 'radial-wheel', hand: 'left', input: { kind: 'button', index: 0 } },
{ action: SemanticXRAction.Select, context: 'world-prompt', hand: 'either', input: { kind: 'button', index: 0 } }
```

`VRHapticFeedback` must find the matching handed `XRInputSource`, use `gamepad.hapticActuators?.[0].pulse`, clamp amplitude to 0-1 and duration to 1-1000 ms, and swallow/reduce optional API failures to one warning per session/hand.

- [ ] **Step 5: Write failing VRSpike wheel integration tests**

Cover these sequences in `vr-spike-xr-loop.test.ts`:

1. Left button 4 press calls `createActionWheel` once and presents at the captured head pose.
2. Left ray hover then left-trigger press emits activation once after the host clears; holding the trigger does not repeat it.
3. Right and left touch probes can activate; the held X state cannot reopen until release.
4. Center trigger cancels, no-target trigger does nothing, and `X` release never calls an engine action.
5. Opening does not call any pause hook or change engine state.
6. While open, `processLocomotionInput` still runs, but `processInteractionInput` and `processCombatInput` do not.
7. Session end and absent/unavailable tracking close without activation and dispose host resources.

- [ ] **Step 6: Replace the two old radial orchestration paths**

Delete `wristMenuController`, `wristMenuHost`, `wristPointerHost`, `processWristMenuInput`, pause callbacks, and the old dominant-hand pointer-vector/thumbstick path. Keep one controller and one host.

Read Menu from `global` and left-hand Select from `radial-wheel`, pass only `latestInputFrame.hands.left.targetRayPose` to `host.resolveRay`, and pass both tracked target-ray origins to `host.resolveTouch`. Process controller effects in order:

```ts
for (const effect of effects) {
  if (effect.type === 'activate') {
    VRSpike.radialMenuHost?.clear();
    try { effect.item.activate(); }
    catch (error) { console.error(`[VRSpike] radial action '${effect.item.id}' failed`, error); }
  } else if (effect.type === 'hover-haptic') {
    void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 20, amplitude: 0.15 });
  } else if (effect.type === 'confirm-haptic') {
    void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 35, amplitude: 0.35 });
  } else if (effect.type === 'negative-haptic') {
    void VRSpike.haptics.pulse(session, effect.hand, { durationMs: 60, amplitude: 0.45 });
  }
}
```

- [ ] **Step 7: Change frame ownership so locomotion continues during the wheel**

Call `processLocomotionInput` when no movie, keyboard, comfort-settings panel, or legacy panel owns input. A radial-open frame must still call locomotion but must clear/cancel world-interaction transient state and skip world interaction/combat. Preserve the existing blocking behavior for movie, keyboard, comfort, and foreground legacy panels.

- [ ] **Step 8: Run focused integration tests and type-check**

Run: `npx jest --runInBand --no-cache src/tests/xr-input-router.test.ts src/tests/vr-haptic-feedback.test.ts src/tests/vr-spike-xr-loop.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/vr/runtime/VRHapticFeedback.ts src/tests/vr-haptic-feedback.test.ts src/vr/runtime/XRTypes.ts src/vr/runtime/XRInputRouter.ts src/tests/xr-input-router.test.ts src/vr/VRSpike.ts src/tests/vr-spike-xr-loop.test.ts
git commit -m "feat: bind and orchestrate Quest action wheel"
```

---

### Task 7: Non-mutating world-use descriptions and prompt candidate/model logic

**Files:**
- Modify: `src/vr/runtime/VRWorldUseAdapter.ts`
- Modify: `src/tests/vr-world-use-adapter.test.ts`
- Modify: `src/vr/runtime/ModuleObjectInteractionTarget.ts`
- Modify: `src/tests/module-object-interaction-target.test.ts`
- Create: `src/vr/runtime/VRWorldActionPromptModel.ts`
- Create: `src/tests/vr-world-action-prompt-model.test.ts`

**Interfaces:**
- Produces: `VRWorldUseActionDescriptor`, `describeDirectVRWorldUse(actor: VRWorldUseActor, target: VRWorldUseTarget, logger?)`, `resolveVRInteractionAnchor(object: EngineInteractableObject, output: THREE.Vector3, fallbackMetres?: number)`, `VRWorldPromptCandidate`, `VRWorldPromptAction`, `VRWorldActionPromptModel`, `selectVRWorldPromptCandidate(candidates, headPose, currentCandidateId, aimedIds, isInFrustum)`, and `buildVRWorldPromptPages(actions: readonly VRWorldPromptAction[])`.
- Later tasks consume: prompt model/candidate APIs and direct-use descriptors.

- [ ] **Step 1: Write failing direct-use descriptor tests**

```ts
test('describes an in-range console without using it', () => {
  const target = placeable('Galaxy Map', 1.5);
  const descriptor = describeDirectVRWorldUse(actor(), target, quietLogger);
  expect(descriptor).toEqual(expect.objectContaining({ id: 'direct-use:42', label: 'Use: Galaxy Map' }));
  expect(target.use).not.toHaveBeenCalled();
  expect(descriptor!.revalidate()).toBe(true);
  expect(descriptor!.activate()).toEqual({ handled: true, feedbackLabel: 'Use: Galaxy Map' });
  expect(target.use).toHaveBeenCalledTimes(1);
});

test('returns null for unsupported or out-of-range direct-use targets', () => {
  expect(describeDirectVRWorldUse(actor(), creature())).toBeNull();
  expect(describeDirectVRWorldUse(actor(), placeable('Far', 1.5001))).toBeNull();
});
```

- [ ] **Step 2: Write failing candidate, priority, and four-action pagination tests**

```ts
test('prefers an explicitly aimed eligible object, otherwise view-center angle then distance then id', () => {
  const candidates = [candidate('near-off-center', 1, 20), candidate('center', 2, 2)];
  expect(selectVRWorldPromptCandidate(candidates, headPose(), ['near-off-center'], () => true)?.id).toBe('near-off-center');
  expect(selectVRWorldPromptCandidate(candidates, headPose(), [], () => true)?.id).toBe('center');
});

test('rejects candidates outside 55 degrees, frustum, range, or with no actions', () => {
  const base = candidate('door', 1, 0);
  expect(selectVRWorldPromptCandidate([{ ...base, position: new THREE.Vector3(10, 0, 0) }], headPose(), null, [], () => true)).toBeNull();
  expect(selectVRWorldPromptCandidate([base], headPose(), null, [], () => false)).toBeNull();
  expect(selectVRWorldPromptCandidate([{ ...base, inRange: false }], headPose(), null, [], () => true)).toBeNull();
  expect(selectVRWorldPromptCandidate([{ ...base, hasActions: false }], headPose(), null, [], () => true)).toBeNull();
});

test('paginates world actions in groups of four with previous/next controls', () => {
  expect(buildVRWorldPromptPages(actions(5)).map((page) => page.entries.map((entry) => entry.id))).toEqual([
    ['action-0', 'action-1', 'action-2', 'action-3', 'prompt:next'],
    ['prompt:previous', 'action-4'],
  ]);
});
```

- [ ] **Step 3: Run the focused tests and verify failures**

Run: `npx jest --runInBand --no-cache src/tests/vr-world-use-adapter.test.ts src/tests/vr-world-action-prompt-model.test.ts src/tests/module-object-interaction-target.test.ts`

Expected: FAIL because descriptor, prompt model, and exported anchor do not exist.

- [ ] **Step 4: Refactor direct use into describe/revalidate/activate**

```ts
export interface VRWorldUseActionDescriptor {
  readonly id: string;
  readonly label: string;
  revalidate(): boolean;
  activate(): VRWorldUseOutcome;
}

export function describeDirectVRWorldUse(
  actor: VRWorldUseActor,
  target: VRWorldUseTarget,
  logger: Pick<Console, 'info' | 'error'> = console
): VRWorldUseActionDescriptor | null {
  validateActor(actor);
  validateTarget(target);
  if (!isSupportedAndInRange(actor, target)) return null;
  const name = resolveDisplayName(target.getName?.()) || 'Object';
  return {
    id: `direct-use:${target.id}`,
    label: `Use: ${name}`,
    revalidate: () => isSupportedAndInRange(actor, target),
    activate: () => executeDirectVRWorldUse(actor, target, logger),
  };
}

export function tryDirectVRWorldUse(
  actor: VRWorldUseActor,
  target: VRWorldUseTarget,
  logger: Pick<Console, 'info' | 'error'> = console
): VRWorldUseOutcome {
  const descriptor = describeDirectVRWorldUse(actor, target, logger);
  return descriptor ? descriptor.activate() : { handled: false };
}
```

Keep the existing compatibility function until GameState prompt integration is complete. Preserve its exact logging and error outcomes.

- [ ] **Step 5: Export and test the interaction anchor**

Rename private `resolveTagHeight` to exported `resolveVRInteractionAnchor(object, output, fallbackMetres = 0.25)`, returning `output.copy(object.position).setZ(object.position.z + resolvedHeight)`. Use it in `createModuleObjectInteractionTarget` and world-prompt candidates so labels, object targeting, and prompt placement share one anchor.

- [ ] **Step 6: Implement prompt model validation, priority, stability input, and pagination**

```ts
export interface VRWorldPromptCandidate {
  readonly id: string;
  readonly name: string;
  readonly position: THREE.Vector3;
  readonly actorDistanceMetres: number;
  readonly hasActions: boolean;
  readonly inRange: boolean;
}

export interface VRWorldPromptAction {
  readonly kind: 'action';
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  revalidate(): boolean;
  activate(): void;
}
```

`selectVRWorldPromptCandidate` must take `currentCandidateId`, explicitly aimed IDs, a finite head pose, and an `isInFrustum(position)` callback. Preserve the current candidate while eligible unless a ray explicitly nominates another. Otherwise sort by horizontal angle, actor distance, then ID. Reject angles over `THREE.MathUtils.degToRad(55)`.

- [ ] **Step 7: Run tests and type-check**

Run: `npx jest --runInBand --no-cache src/tests/vr-world-use-adapter.test.ts src/tests/vr-world-action-prompt-model.test.ts src/tests/module-object-interaction-target.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/vr/runtime/VRWorldUseAdapter.ts src/tests/vr-world-use-adapter.test.ts src/vr/runtime/ModuleObjectInteractionTarget.ts src/tests/module-object-interaction-target.test.ts src/vr/runtime/VRWorldActionPromptModel.ts src/tests/vr-world-action-prompt-model.test.ts
git commit -m "feat: describe and prioritize VR world actions"
```

---

### Task 8: Static world-action prompt controller and host

**Files:**
- Create: `src/vr/runtime/VRWorldActionPromptController.ts`
- Create: `src/tests/vr-world-action-prompt-controller.test.ts`
- Create: `src/vr/runtime/VRWorldActionPromptHost.ts`
- Create: `src/tests/vr-world-action-prompt-host.test.ts`

**Interfaces:**
- Consumes: `VRWorldActionPromptModel`, `RoutedXRAction`, `SemanticXRAction.Select`, `XRHandRole`, `XRWorldPose`, and `VRPanelPointerHost`.
- Produces: prompt `presentation`, `process(model, hoveredByHand, actions)`, `VRWorldPromptEffect`, host `present`, `resolveRay`, `clear`, and `dispose`.

- [ ] **Step 1: Write failing prompt-controller tests**

```ts
test('activates the hovered action once on either-hand Select press edge', () => {
  const controller = new VRWorldActionPromptController();
  const model = promptModel('door', [promptAction('security')]);
  const effects = controller.process(model, { left: 'security' }, [select('left', true)]);
  expect(effects).toContainEqual({ type: 'activate', action: expect.objectContaining({ id: 'security' }), hand: 'left' });
  expect(controller.process(model, { left: 'security' }, [select('left', true)])).toEqual([]);
});

test('clears hover and press state when model eligibility disappears', () => {
  const controller = new VRWorldActionPromptController();
  controller.process(promptModel(), { right: 'use' }, [select('right', true)]);
  expect(controller.process(null, {}, [])).toContainEqual({ type: 'closed' });
});

test('navigation changes four-action pages without gameplay activation', () => {
  // Select prompt:next, verify pageIndex, then prompt:previous.
});
```

- [ ] **Step 2: Write failing host tests**

```ts
test('anchors 0.12m below the target name and billboards toward the head every frame', () => {
  const host = createPromptHost();
  host.present(modelAt(new THREE.Vector3(1, 2, 1)), headAt(new THREE.Vector3(1, 0, 1.7)), null);
  expect(host.object.position.toArray()).toEqual([1, 2, 1.2]); // model anchor includes name baseline; prompt subtracts 0.12 from label position.
  const firstQuaternion = host.object.quaternion.clone();
  host.present(modelAt(new THREE.Vector3(1, 2, 1)), headAt(new THREE.Vector3(3, 0, 1.7)), 'security');
  expect(host.object.quaternion.equals(firstQuaternion)).toBe(false);
});

test('maps both controller rays to rectangular action IDs and highlights one', () => {
  const host = createPromptHost();
  host.present(promptModel('door', [
    promptAction('security'), promptAction('bash'), promptAction('mine'),
  ]), headAt(new THREE.Vector3(0, 0, 1.7)), 'security');
  expect(host.resolveRay('left', rayAtRegion(0))).toBe('security');
  expect(host.resolveRay('right', rayAtRegion(2))).toBe('mine');
  expect(host.hoveredId).toBe('security');
});
```

- [ ] **Step 3: Run the focused tests and verify missing-module failures**

Run: `npx jest --runInBand --no-cache src/tests/vr-world-action-prompt-controller.test.ts src/tests/vr-world-action-prompt-host.test.ts`

Expected: FAIL because controller and host do not exist.

- [ ] **Step 4: Implement press-edge controller behavior**

Track `pressed` independently for left and right. Resolve at most one activation per frame in stable left-then-right order. Revalidate before emitting activation; emit a negative-haptic effect rather than another action if invalid. Navigation mutates page only. A model ID change resets page, hover, and pressed state; a same-model redraw preserves page.

- [ ] **Step 5: Implement the canvas prompt host and rectangular mapping**

Use a 1024x256 canvas plane with four equal action regions plus compact edge navigation regions when present. Draw KOTOR gunmetal/cyan styling, amber hover, white icon/label contrast, and no unavailable buttons. Position the prompt 0.12 m below the name-label baseline and face the head each frame. Use two `VRPanelPointerHost` instances so each hand has its own cyan ray/cursor; convert each returned GUI coordinate to the exact page-entry region.

- [ ] **Step 6: Run focused tests and type-check**

Run: `npx jest --runInBand --no-cache src/tests/vr-world-action-prompt-controller.test.ts src/tests/vr-world-action-prompt-host.test.ts src/tests/vr-panel-pointer-host.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/vr/runtime/VRWorldActionPromptController.ts src/tests/vr-world-action-prompt-controller.test.ts src/vr/runtime/VRWorldActionPromptHost.ts src/tests/vr-world-action-prompt-host.test.ts
git commit -m "feat: add static VR world action prompts"
```

---

### Task 9: Engine and XR integration for proactive world prompts

**Files:**
- Modify: `src/GameState.ts`
- Modify: `src/vr/VRSpike.ts`
- Modify: `src/tests/vr-spike-xr-loop.test.ts`
- Delete: `src/vr/runtime/VRContextActionPanelController.ts`
- Delete: `src/tests/vr-context-action-panel-controller.test.ts`

**Interfaces:**
- Consumes: Tasks 7-8 prompt selection/model/controller/host and GameState action-menu bridge from Task 5.
- Produces: `VRSpikeHooks.getWorldActionPromptContext()` and the complete automatic prompt flow.

- [ ] **Step 1: Write failing GameState/VRSpike integration tests**

Add tests proving:

1. An in-range, visible, in-front unlocked door yields `Use/Open` without calling `use` during model creation.
2. A locked door yields authored Security, tunneler, Bash, and Mine entries from `ActionMenuManager` and does not add direct Open.
3. A trap yields Disarm/Recover actions.
4. A galaxy-map placeable yields a direct Use action and only invokes its existing `use` route after prompt selection.
5. Either ray explicitly nominates an eligible object; otherwise center-angle priority applies.
6. The prompt clears immediately on range, frustum, 55-degree cone, line-of-sight/list, object, or action loss.
7. An open radial hides/suspends the prompt; closing the radial rebuilds eligibility.
8. Prompt Select skips combat/world-object direct activation and fires exactly once.

- [ ] **Step 2: Run the focused integration test and capture the current post-activation-panel failure**

Run: `npx jest --runInBand --no-cache src/tests/vr-spike-xr-loop.test.ts`

Expected: FAIL because current GameState executes direct use on interaction and opens the legacy context panel only after activation.

- [ ] **Step 3: Replace GameState context-panel state with prompt hooks**

Delete `vrContextActionPanelController`, `vrContextActionTarget`, route diagnostics tied to the post-activation branch, and the special context menu branch inside `getPanelContext`.

Add:

```ts
getWorldActionPromptContext: () => ({
  actor: GameState.getCurrentPlayer() ?? null,
  candidates: buildVRWorldPromptCandidates(
    GameState.getCurrentPlayer(),
    GameState.ModuleObjectManager.playerSelectableObjects
  ),
  createPrompt: (targetId: string) => buildVRWorldActionPrompt(targetId),
}),
```

`buildVRWorldActionPrompt` must resolve the exact live object, refresh `ActionMenuManager`, and snapshot target actions via source keys. For unlocked door/placeable objects, append `describeDirectVRWorldUse` only if it returns a descriptor. For locked objects, omit direct use and expose authored target actions. At activation, repeat live object/current-player/range/action-key validation before delegating.

- [ ] **Step 4: Build per-eye frustum visibility in VRSpike**

Use `renderer.xr.getCamera(VRSpike.camera)` and build a `THREE.Frustum` for every subcamera from `projectionMatrix * matrixWorldInverse`; a candidate is visible if its anchor is inside at least one eye frustum. Pass that callback, the captured head pose, current candidate ID, and both ray-nominated IDs to `selectVRWorldPromptCandidate`.

- [ ] **Step 5: Integrate prompt processing before generic world interaction/combat**

When no radial or blocking panel owns input:

1. synchronize the interaction target set;
2. compute left and right ray previews without activation;
3. resolve/persist the prompt candidate;
4. create or refresh the model only on candidate/model invalidation;
5. present and billboard the host;
6. route `world-prompt` Select actions;
7. execute prompt controller effects after clearing the host for menu-opening actions; and
8. skip generic world interaction and combat if prompt Select was consumed.

Set `interactionPreviewIndicator` from the chosen candidate so the existing `VRWorldTargetLabelHost` displays its name above the prompt even when no ray is aimed. Clear the prompt and label together on loss.

- [ ] **Step 6: Remove obsolete direct world activation ownership**

Keep `InteractionSystem.preview` for combat targeting and aimed candidate nomination. Stop using its `process` path to activate doors/placeables now covered by prompt actions. Do not remove combat's `resolveAimedTargetId` bridge. If a non-prompt interaction type remains, explicitly route it through an allowlisted interaction path rather than falling through to old door/placeable activation.

- [ ] **Step 7: Dispose and lifecycle-reset every prompt resource**

On session loss/end, module transition, dialogue/cutscene entry, tracking loss, or foreground menu takeover: clear prompt controller state, candidate/model IDs, both pointer hosts, prompt host, and label. On session teardown call `dispose` exactly once for the prompt host and both pointer hosts.

- [ ] **Step 8: Run all prompt/interaction tests and type-check**

Run: `npx jest --runInBand --no-cache src/tests/vr-world-action-prompt-model.test.ts src/tests/vr-world-action-prompt-controller.test.ts src/tests/vr-world-action-prompt-host.test.ts src/tests/vr-world-use-adapter.test.ts src/tests/module-object-interaction-target.test.ts src/tests/interaction-system.test.ts src/tests/vr-spike-xr-loop.test.ts`

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/GameState.ts src/vr/VRSpike.ts src/tests/vr-spike-xr-loop.test.ts
git rm src/vr/runtime/VRContextActionPanelController.ts src/tests/vr-context-action-panel-controller.test.ts
git commit -m "feat: surface proactive VR world actions"
```

---

### Task 10: Documentation, full automated gates, browser evidence, and headset handoff

**Files:**
- Modify: `DESIGN.md`
- Modify: `ROADMAP.md`
- Verify: all files changed in Tasks 1-9

**Interfaces:**
- Consumes: complete implementation.
- Produces: current design/roadmap truth and evidence separated by verification layer.

- [ ] **Step 1: Update the design decision**

Replace `Opening the radial pauses outright` with the approved behavior: the all-purpose left-`X` wheel leaves simulation/locomotion/turning active, owns conflicting combat/world/UI input, confirms left-ray selections on left-trigger press, supports either-hand touch, and delegates full-screen menu pause behavior to those menus.

- [ ] **Step 2: Update ROADMAP Phase 3.8 and 4.1**

Record that the old four-way contextual/wrist pair is replaced by one dynamic paginated wheel, and that doors/containers/mines/consoles use proactive world prompts. Leave headset acceptance unchecked until a real device run passes.

- [ ] **Step 3: Run focused radial and prompt suites together**

Run:

```powershell
npx jest --runInBand --no-cache src/tests/vr-radial-menu-model.test.ts src/tests/vr-radial-menu-layout.test.ts src/tests/vr-radial-menu-controller.test.ts src/tests/vr-radial-menu-host.test.ts src/tests/vr-action-wheel-model-builder.test.ts src/tests/vr-haptic-feedback.test.ts src/tests/vr-world-action-prompt-model.test.ts src/tests/vr-world-action-prompt-controller.test.ts src/tests/vr-world-action-prompt-host.test.ts src/tests/vr-world-use-adapter.test.ts src/tests/module-object-interaction-target.test.ts src/tests/xr-input-router.test.ts src/tests/vr-spike-xr-loop.test.ts
```

Expected: PASS with no leaked timers, unhandled rejections, or open handles.

- [ ] **Step 4: Run the complete automated suite**

Run: `npm test -- --runInBand`

Expected: PASS. If an unrelated pre-existing failure appears, stop and report its exact test/error; do not weaken or skip it.

- [ ] **Step 5: Run TypeScript and webpack gates**

Run: `npx tsc --noEmit -p tsconfig.kotorjs.json`

Run: `npm run webpack:dev`

Expected: both exit 0. Record webpack warnings separately rather than calling warnings a clean pass.

- [ ] **Step 6: Run browser verification before requesting headset time**

Use the existing browser asset-service/Chrome workflow from `C:\Users\allen\.codex\skills\kotor2-vr\references\workflow.md`. Verify a cold `101PER` load, wheel rendering, six-plus-navigation pagination, icon fallback, no pause on open, continued movement, menu takeover, prompt appearance/cleanup, and no uncaught console errors. This is browser evidence, not Quest evidence.

- [ ] **Step 7: Commit documentation and any evidence-only metadata**

```powershell
git add DESIGN.md ROADMAP.md
git commit -m "docs: record radial wheel and world prompt behavior"
```

- [ ] **Step 8: Perform the batched Quest 3 acceptance checklist**

After all prior gates pass, ask the user to start VDXR/Quest 3 once and verify in one battery-conscious session:

1. Hold left `X`; wheel spawns below eye level, stays world-fixed, and gameplay/movement continue.
2. Left-ray hover is geometrically accurate, amber/high-contrast, extrudes, labels correctly, and haptics once per hover change.
3. Left-trigger press confirms a hovered action; center trigger or `X` release cancels, and a no-target trigger leaves the wheel open without changing target, queue, menu, or party.
4. Either controller direct touch activates once and cannot reopen until `X` release.
5. Pages reset to page one; previous/next and nested Party work.
6. Attack/Force/self actions preserve target and d20/action-queue behavior.
7. Inventory, Character, local Map, Comfort Settings, and conditional Level-Up-to-Character pause/open correctly.
8. Approaching unlocked/locked doors, containers, mines, ordinary consoles, and the Ebon Hawk galaxy map shows the static prompt under the name; Security, tunneler, Bash, Mine, Disarm, Recover, and Use routes appear only when authored/available.
9. Either controller ray/trigger activates a prompt once; turning away or leaving range removes it immediately.
10. Session/menu/module/dialogue transitions leave no stuck wheel, prompt, ray, hover, haptic, pause, or input ownership.

Record headset observations separately from unit, type-check, webpack, and browser results. Do not mark ROADMAP device acceptance complete until all applicable checks pass.

---

## Final Implementation Review Checklist

- Every new non-trivial module has focused unit tests with an observed red-to-green transition.
- No code path pads unavailable actions or silently activates a default action.
- No radial open/close code writes `GameState.State`.
- No wheel or prompt path directly applies damage or bypasses `ActionMenuManager`.
- No radial route opens `MenuGalaxyMap` or the empty `MenuLevelUp` shell.
- Direct-use description does not mutate the target before prompt confirmation.
- Left-ray-only wheel selection and either-ray prompt selection are independently tested.
- Touch overlap and trigger press edges cannot double-fire.
- Async icons, haptics, tracking loss, target loss, session teardown, and resource disposal fail safely.
- Automated, browser, and Quest 3 evidence are reported as separate gates.
