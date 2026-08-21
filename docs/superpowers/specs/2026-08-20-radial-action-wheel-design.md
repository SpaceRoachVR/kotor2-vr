# Radial Action Wheel Upgrade Design

**Date:** 2026-08-20

**Status:** Approved for implementation planning

**Mockup:** [KOTOR II VR radial action wheel](../../../output/imagegen/kotor2-vr-radial-action-wheel-mockup.png)

## Summary

Replace the two current four-way VR radials with one all-purpose action wheel
opened by holding `X` on the left controller. The new wheel supports dynamic
pie slices, pagination, a nested party wheel, left-controller ray selection,
either-controller direct touch, hover feedback, center/outside cancellation,
and release-to-confirm without pausing gameplay.

Move doors, placeables, mines, consoles, and other world-object actions out of
the radial. Their authored actions appear automatically in a compact,
world-anchored prompt when the object is in range, visible, and in front of the
player. This includes the Ebon Hawk galaxy map console; the radial's Map action
opens only the normal local area map.

## Current State

The current implementation has two `VRRadialMenuController` instances:

- The contextual radial is bound to the off-hand `Y` button.
- The wrist radial is bound to the off-hand `X` button.
- Each controller requires exactly four items.
- Missing actions are padded with inert `No action` entries.
- The presentation is a single canvas plane anchored near the left hand.
- The dominant/right-hand ray or right thumbstick chooses a quadrant.
- Releasing the hold button confirms the chosen quadrant.
- Opening either radial explicitly pauses the engine.
- World-object actions appear only after the player activates an object and
  the existing action-menu route decides that a contextual panel is required.

This design supersedes the radial-pause decision in `DESIGN.md` and ROADMAP
Phase 3.8. Full-screen legacy menus continue to own engine pause state after
the wheel closes and the selected menu opens.

## Goals

- Provide one discoverable `X` action wheel for all general gameplay actions.
- Preserve the engine's authored d20 actions, targeting rules, costs,
  cooldowns, and action queues.
- Keep wheel selection stable and readable while the game simulation runs.
- Support a dynamic number of available actions without inert placeholders.
- Make ray and direct-touch collisions agree exactly with rendered slices.
- Preserve full cancellation: cancel must not mutate an engine selection,
  target, queue, menu, party leader, or page outside the wheel itself.
- Surface world-object choices before activation, close to their object and
  below the existing object name label.
- Keep pure geometry, state transitions, engine-model assembly, rendering, and
  engine activation independently testable.

## Non-Goals

- Do not add thumbstick selection to the new wheel.
- Do not put doors, containers, mines, ordinary consoles, or the galaxy map in
  the all-purpose wheel.
- Do not execute combat damage directly from the wheel.
- Do not replace Inventory, Character, Map, or other legacy menus.
- Do not implement the engine's unfinished manual `MenuLevelUp` workflow. The
  conditional Level-Up slice opens the Character screen, where Auto Level-Up
  is currently functional.
- Do not make the wheel head-locked or hand-anchored after it opens.
- Do not pause or slow the game merely because the wheel is open.
- Do not add direct-touch operation to world-object prompts; those prompts use
  either controller ray and the semantic Select action.

## Player Experience

### Opening and placement

Pressing and holding left-controller `X` opens the top-level wheel on page one.
The wheel snapshots the available actions for this opening and remains fixed in
world space until it closes. It is placed 0.85 metres along the head's
horizontal forward direction and 0.25 metres below the current head position.
It faces the head pose captured at opening and does not follow later head or
hand movement.

The outer radius is 0.33 metres and the center cancel radius is 0.105 metres.
These values make the target large enough for Quest 3 ray and controller-touch
selection while leaving the upper sightline open. The host rejects non-finite
poses and closes safely rather than placing the wheel at an invalid transform.

### Slices and pages

Each page contains at most six gameplay/menu actions. A next-page wedge follows
the six actions when another page exists. A previous-page wedge precedes the
actions after page one. Middle pages can therefore contain eight outer wedges:
previous, six actions, and next. A page indicator appears below the wheel only
when more than one page exists.

The center cancel target is fixed on every page and nested menu. Unavailable
actions are omitted. The action set and its ordering do not change while one
opening is active, even if world state changes underneath it. Every action is
revalidated at activation time.

The stable top-level ordering is:

1. Available target-dependent combat actions for the currently nominated
   valid combat target.
2. Available self actions, including Force powers and consumable items.
3. Inventory.
4. Character.
5. Local Map.
6. Level-Up, only when the current player can level up; this opens the existing
   Character screen and its working Auto Level-Up route.
7. Party, only when at least one other selectable party member exists.

Duplicate engine entries with the same source panel, action index, and action
identity are included once. Invalid entries are omitted and logged once with
their source panel and action indices.

### Hover and confirmation

Only the left controller ray selects wheel slices. The ray intersects the
wheel's plane, converts the hit into wheel-local polar coordinates, and resolves
the same annular sectors used by rendering. A ray over the center resolves
Cancel. A ray outside the outer radius resolves no target.

Hovering a different target:

- changes the wedge from gunmetal to amber;
- moves it 0.025 metres toward the player;
- updates the action-name plaque above the wheel;
- displays a collision dot where the ray meets the surface; and
- requests one best-effort 20 ms haptic pulse at amplitude 0.15.

Releasing `X` confirms the currently ray-hovered action. Releasing over the
center or outside the wheel cancels. Navigation wedges change pages without
closing the wheel and do not call engine action callbacks. After navigation,
the hover is cleared until the ray resolves a slice on the new page.

### Direct touch

Either tracked controller can directly touch the wheel. The controller's
target-ray origin is the interaction probe. A touch begins when the probe
crosses into a wedge's polar bounds and comes within 0.06 metres of the wheel
plane. Entering an action wedge activates it immediately. Entering a navigation
wedge changes pages immediately. Entering the center cancels immediately.

One continuous overlap produces one event. After any touch activation closes
the wheel, the controller ignores further wheel-open presses until `X` has been
released. This prevents the held button from reopening the wheel.

### Visual language

The wheel uses a restrained KOTOR II/Peragus palette:

- normal wedge: `#13252c` at 92% opacity;
- normal border: `#3d9fb5`;
- hover wedge: `#9a6819` at 96% opacity;
- hover border: `#ffd15c`;
- primary text and icons: `#ffffff`;
- cancel disc: `#10191e`;
- cancel symbol: `#dc2027`.

Labels use short player-facing names inside slices. The full hovered label is
shown in a plaque above the wheel. The center contains the universal red
circle-with-diagonal-slash symbol and no `CANCEL` text. Engine icon resrefs are
preferred. A deterministic category fallback icon is used if a texture is
missing or fails to load; an icon failure never prevents interaction.

### Party submenu

Party opens a nested wheel built from the live selectable party list. It omits
the current leader and invalid or unavailable members. Each member slice shows
the member's portrait/icon and display name. Choosing a member delegates to
`PartyManager.SwitchLeaderAtIndex` after revalidating that member's current
party index. The nested wheel uses the same pagination, center cancel, hover,
ray, touch, and `X`-release rules. Cancel closes the entire wheel rather than
returning to the parent; previous navigation is reserved for page navigation.

## Architecture

### `VRRadialMenuModel`

Define discriminated item types for action, submenu, previous-page, and
next-page entries. Define an immutable opening snapshot containing the menu
title, pages, current page, menu depth, and engine revalidation/activation
callbacks. Model construction validates identifiers, labels, icons, and
callbacks before a controller receives the snapshot.

The model owns pagination but no THREE objects, controller poses, or engine
globals. Pagination accepts a maximum of six content items per page and adds
navigation entries deterministically.

### `VRRadialMenuLayout`

Calculate equal-angle annular sectors from the current page's outer item count.
Apply a two-degree visual/collision gap between adjacent sectors. Expose pure
functions for:

- sector generation;
- point-to-sector resolution;
- center/outside classification;
- ray-plane intersection conversion; and
- near-touch plane-distance and sector resolution.

Inputs must be finite. Counts outside 1-8, negative radii, an inner radius not
smaller than the outer radius, zero-length ray directions, or non-finite poses
produce explicit errors at the boundary and safe closure at the orchestration
layer.

### `VRRadialMenuController`

Replace the current four-item controller with a state machine whose externally
observable states are closed, open, and waiting-for-trigger-release. Open state
contains the immutable snapshot, current page, nested party snapshot when
applicable, ray hover, touch-overlap identities, and previous `X` state.

The controller consumes semantic input and resolved hit identities rather than
THREE objects. It emits typed effects for open, close, hover haptic, confirm
haptic, negative haptic, page change, submenu entry, cancel, and activation.
Engine callbacks are invoked through the model boundary only after controller
state has closed, preventing callbacks that open legacy menus from competing
with wheel ownership.

### `VRRadialMenuHost`

Render a world-fixed `THREE.Group` with one mesh per outer wedge, one center
mesh, icon/label planes, the action-name plaque, page indicator, and pointer
collision dot. Wedge meshes are generated from the layout sectors, so physical
presentation and collision share the same geometry. Hover changes material and
local depth without rebuilding unrelated meshes.

The host owns and disposes its geometries, materials, canvas textures, and
loaded icon references. Reopening with the same item/icon identity may reuse a
bounded icon cache; module/session disposal clears it. Asynchronous icon loads
must verify that the host still presents the same opening before applying a
texture.

### `VRActionWheelModelBuilder`

Move action extraction out of `GameState.ts`. Build the opening snapshot from
explicit dependencies: current player, optional nominated combat target,
`ActionMenuManager` panels, menu-opening functions, party members, and level-up
eligibility. Do not let the builder call an action while assembling the model.

Engine action callbacks continue to set the source panel's selected index and
delegate to `ActionMenuManager.onTargetMenuAction` or
`ActionMenuManager.onSelfMenuAction`. Static menu callbacks open
`MenuInventory`, `MenuCharacter`, or `MenuMap`. The Level-Up callback is present
only when `canLevelUp()` is true and opens `MenuCharacter`, whose existing Auto
Level-Up action is functional. It must not open the currently empty
`MenuLevelUp` shell.

### `VRSpike` orchestration

Map Quest Touch off-hand button index 4 (`X`) to `SemanticXRAction.Menu` and
remove the separate `Wrist` semantic route/controller/host. Preserve profile
abstraction so Index and Vive mappings remain semantic rather than hard-coded
inside wheel logic.

At the `X` press edge, obtain a model snapshot and capture a validated head pose.
While open, update the left ray hit, both touch probes, host hover, and haptic
effects. The wheel owns Menu, UI pointer, combat gesture, and world-use actions,
but not the engine clock, locomotion, or turning. Prompt interaction is hidden
and suspended until the wheel closes.

Tracking loss, XR session loss, module transition, dialogue/cutscene entry, or
another foreground menu taking ownership closes the wheel and clears all
transient state without engine activation.

## World-Object Action Prompts

### Eligibility and priority

Start with `ModuleObjectManager.playerSelectableObjects`, which already removes
the player, unusable/open objects, out-of-range objects, and targets without
line of sight. Add these prompt requirements:

- the object's anchor is inside the active camera frustum;
- its direction is within 55 degrees of the head's horizontal forward vector;
- it still satisfies `getVRInteractionRange` for its object type; and
- at least one direct-use or authored target action can be represented.

An eligible object currently hit by either controller ray wins. Otherwise,
choose the smallest angular distance from view center, breaking ties by actor
distance and then stable object ID. Keep the current candidate until it becomes
ineligible or a ray explicitly nominates another eligible object, preventing
prompt flicker between nearby objects.

### Prompt model and activation

Create `VRWorldActionPromptModelBuilder` to expose actions without executing
the object. Refactor `VRWorldUseAdapter` so it can describe a direct action
(`Open`, `Use`, `Access`, or another deterministic object-type label) separately
from activating it. Locked objects use the existing `ActionMenuManager` target
actions such as Security, Security Tunneler, Bash, Recover Mine, or Disarm Mine.
Unlocked direct-use objects expose the non-mutating direct-action descriptor.

Flatten valid target actions into a compact row of at most four actions. If an
object exposes more than four, add small previous/next controls and paginate in
groups of four. The prompt remains anchored to the same object during page
changes. Selection delegates to the same direct-use or `ActionMenuManager`
activation route used by flatscreen behavior.

### Prompt host and input

`VRWorldActionPromptHost` anchors a compact horizontal action row above the
object's validated interaction anchor and 0.12 metres below the existing name
label. It faces the head each frame because it belongs to a moving world object,
unlike the world-fixed radial. The host reuses the KOTOR palette and icon
resolver but uses rectangular targets suited to short action rows.

Either controller ray can hover. On the Select press edge, the hovered action
is revalidated and activated once. Hover requests the same light haptic pulse
on the corresponding controller. Losing range, visibility, front-cone status,
line of sight, the object, or all actions hides the prompt immediately and
clears pressed/hover state. World prompts do not use direct touch or `X`
release-to-confirm.

The Ebon Hawk galaxy map is handled through its world console's direct/authored
action and then opens the existing context-dependent galaxy-map UI. The wheel's
Map action always opens `MenuMap` and never `MenuGalaxyMap`.

## Engine State and Failure Handling

- Opening or closing the wheel never writes `GameState.State`.
- A legacy menu opened by an action retains its existing engine-state behavior.
- Cancel invokes no model callback and changes no engine-owned state.
- Activation revalidates actor, target, party member, menu availability, and
  source action identity immediately before dispatch.
- A failed revalidation closes safely and requests a 60 ms negative haptic at
  amplitude 0.45; it does not substitute another action.
- Haptic APIs are optional. Missing or rejected haptic promises are ignored
  after a once-per-session diagnostic and never affect activation.
- Icon failures use fallbacks and report once per resref.
- Model/layout validation errors close the affected UI and report the opening
  identity and error without crashing the XR frame loop.
- Engine callbacks are wrapped at the orchestration boundary. A thrown callback
  closes the UI, clears ownership, reports the action ID, and leaves recovery to
  the engine's existing error boundary rather than retrying a possibly
  non-idempotent action.

## Testing Strategy

### Unit tests

- Layout sectors for 1-8 outer entries, two-degree gaps, center hits, outside
  hits, boundary ownership, ray-plane intersections, and touch depth.
- Pagination for 0, 1, 6, 7, 12, and 13 content actions, including navigation
  ordering and reset to page one on every opening.
- Controller sequences for hold/open, hover, release confirmation, neutral
  cancellation, center cancellation, outside cancellation, page navigation,
  submenu entry, immediate touch, overlap debounce, and wait-for-release.
- Builder filtering, deterministic ordering, malformed/duplicate omission,
  conditional Level-Up routing to `MenuCharacter`, conditional Party, nested
  party revalidation, menu callbacks, and engine action delegation.
- World prompt eligibility, front cone, frustum/range loss, candidate stability,
  aimed-object priority, both-hand ray selection, pagination, and cleanup.

### Integration tests

- `VRSpike` opens from Quest left `X`, reads only the left wheel ray, and accepts
  both controller touch probes.
- An open wheel does not pause the engine and does suppress combat/world-use
  side effects while locomotion and turning remain routed.
- Menu activation closes the wheel before the legacy menu takes ownership.
- Tracking/session/module/menu transitions close without activation.
- World prompts are suspended during wheel ownership and rebuilt afterward.
- Direct-use doors/consoles and locked authored actions use their existing
  engine routes exactly once.
- All host resources are removed and disposed on session teardown.

### Browser and headset gates

Browser verification covers rendering, icon fallbacks, material contrast,
resource disposal, ray-to-sector alignment, and no uncaught console errors.

Quest 3 acceptance separately verifies:

- readable scale and unobstructed forward view;
- stable world-fixed placement;
- accurate left-ray hover and release confirmation;
- either-controller direct touch and reopen suppression;
- hover/confirm/negative haptics;
- continued gameplay and locomotion while open;
- pagination and nested party selection;
- combat/self-action queuing without direct damage bypass;
- Inventory, Character, local Map, and conditional Level-Up-to-Character route;
- door, container, mine, console, Security, Bash, and galaxy-map prompts; and
- cancellation leaving targets, queues, party, and menus unchanged.

Automated and browser results are not headset acceptance.

## Documentation Updates

- Update `DESIGN.md` so the radial no longer pauses gameplay and describes the
  all-purpose `X` wheel plus proximity world prompts.
- Update ROADMAP Phase 3.8 and Phase 4.1 to describe the replacement rather than
  retaining the four-way contextual and wrist radials.
- Keep the approved mockup as a design artifact. It communicates direction, not
  exact runtime texture fidelity or device acceptance.
