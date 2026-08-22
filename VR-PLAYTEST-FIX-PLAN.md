# VR Playtest Fix Plan

Opened 2026-08-21 after the first in-headset playtest of the all-purpose action
wheel branch (`edbaf544`, merged to `spike/stereo-perf`). Run in Chrome over the
`tools/asset-http` loopback service with VDXR, in the **T3-M4 Ebon Hawk
prologue** (`001EBO`).

> **Read this first:** the playtest is the T3-M4 prologue, not the Exile. An
> empty inventory, zero credits, and an empty equipment grid are all plausible
> *correct* state for that character, so those symptoms are not on their own
> evidence of a bug.

---

## Status at a glance

| # | Issue | State |
|---|---|---|
| 1 | VR keyboard: no uppercase, DONE won't dismiss | ☐ not started (Phase C) |
| 2 | Cutscene black bars, captions in separate quad | ☐ not started (Phase E) |
| 3 | Containers/doors not interactable | ✅ fixed, headset-accepted |
| 4 | Right trigger attacks world objects | ✅ fixed, headset-accepted |
| 5 | Galaxy Map prompt rotated 90° | ✅ fixed, headset-accepted |
| 6 | Menus: blank map, no icons, Level-Up dead | ◐ partly diagnosed (Phase F) |
| 7 | Held blaster wrong orientation/attachment | ☐ not started (Phase D) |
| 8 | No reliable way to exit combat | ✅ root-caused + fixed, ☐ headset-accepted |
| 9 | Session-long fps decay and heap growth | ☐ not investigated |
| 10 | Bash opens doors that should be indestructible | ☐ reproduces flatscreen — engine-level, out of VR scope |
| 11 | Security offer vs. skill-check execution | ☐ needs verification |
| 12 | Lift plays wrong cutscene, then stops working | ☐ not investigated |
| 13 | Doors invisible in VR, normal in flatscreen | ☐ not investigated |

Two regressions were introduced and fixed within this effort; both are recorded
below under Phase A/B rather than hidden, because both came from changes that
were too coarse.

---

## Confirmed root causes (from reading code)

### C1 — World prompt panel rotated 90° (issue 5) — FIXED

`VRWorldActionPromptHost.present()` oriented the panel with
`this.object.lookAt(headPose.position)`. `Object3D.lookAt` derives its basis from
`Object3D.up`, which defaults to **Y-up**; this engine is **Z-up**. The panel
rolled onto its side, so prompt text read vertically.

`VRRadialMenuHost.placeAtOpeningHeadPose` already built an explicit basis with
`(0,0,1)` as up. The two hosts disagreed and the prompt host was wrong.

### C2 — The VR keyboard cannot produce a capital letter (issue 1a) — OPEN

- `VR_KEYBOARD_LAYOUT` (`VRKeyboardLayout.ts`) has letter rows, `SPACE`, `BACK`,
  `DONE`. There is **no SHIFT or CAPS key**.
- `VRKeyboardInputController.press()` hardcodes `shiftKey: false` on every
  dispatched event.

No code path can emit an uppercase character.

### C3 — Held weapon has a blanket orientation and scale (issue 7) — OPEN

`XRControllerAnchorHost.setHeldVisual()` applies the same `Math.PI / 2` X
rotation to *every* held model and normalizes all of them to a 28cm longest
dimension. There is no per-weapon grip transform and no grip-node alignment —
the anchor uses the model's bounding box. Hence the detached, wrongly-angled
blaster.

### C4 — Combat falls through from world interaction (issue 4) — FIXED

Two mechanisms:

1. **Fall-through.** `processInteractionInput` returns `promptSelectConsumed`,
   true only when a prompt is both hovered and pressed. The frame loop then runs
   `if (!interactionConsumed) processCombatInput(…)`. While issue 3 kept prompts
   from appearing, **every** right trigger reached combat.
2. **Discontinuous held state.** `VRCombatInputController` already edge-detects
   internally (`if (!weaponActionPressed || wasHeld) return []`), so passing a
   level was correct by design. The real defect: `weaponActionHeld` only
   advanced on frames combat ran, so a trigger held through a prompt activation
   read as a **fresh press** when combat resumed.

An earlier note in this document called this a "level read that should be an
edge". That was imprecise and is corrected above.

### C5 — Nested GUI render passes are dropped in VR (issue 6) — OPEN

`VRPanelHost.renderGui()` performs exactly one `renderer.render(guiScene,
guiCamera)` into the panel's render target. But `MenuMap.update()` renders the
map through a **nested sub-scene with its own orthographic camera** via
`LBL_MapView.render(delta)`, which that single pass never executes — so the map
area stays black. The same `update()` also drives the map from
`Mouse.positionUI` and `GameState.controls.camera.rotation.z`, both
flatscreen-only state that never updates during a WebXR session (the same class
of defect already documented for `CursorManager.hoveredObject`).

---

## Decisions taken

Locked in with Allen, 2026-08-21:

1. **Right trigger never attacks a non-hostile world object.** Attacking
   requires an actual hostile creature.
2. **Bash must remain present where applicable and behave as flatscreen does.**
3. **Held weapon: fix orientation and attachment only.** T3-M4 genuinely has an
   integrated blaster equipped, so rendering a weapon there is correct. No droid
   suppression rule, no default hand mesh in this pass.
4. **Cutscene captions composite into the theater texture.** One quad, no
   separate caption geometry.
5. **Interaction ranges widened by 1m** — placeables 1.5→2.5, doors 2→3.

---

## Plan

### Phase A — Z-up prompt orientation ✅ implemented / ✅ headset-accepted

Fixes C1. `lookAt` replaced with `faceHeadUpright()`, an explicit yaw-only
billboard building `makeBasis(right, worldUp, normal)` with world up as the
panel's local Y — matching the radial host's convention. Pitch is deliberately
dropped so an object below eye level does not tip its label away from the
reader, and a head directly overhead retains the last valid horizontal facing.

Three regression tests in `vr-world-action-prompt-host.test.ts`.

**Also fixed here:** `jest.config.js` had no `testPathIgnorePatterns`, so
`.worktrees/` test files matched `testMatch` and ran alongside main's. Because
`moduleNameMapper` resolves `@/` back to this rootDir, a worktree's stale
expectations were being run against main's source — surfacing as six phantom
failures. Every suite also ran twice (128 suites / 972 tests instead of 65 /
502). Any test count recorded before this fix was measuring a doubled, partly
stale run.

### Phase B — World interaction ✅ implemented / ✅ headset-accepted

Fixes issues 3, 4, 5. Four separate defects, only one of which was the original
hypothesis.

**B1 — Candidacy applied direct-use *safety* rules.**
`hasPotentialVRWorldPromptActions` answered the unlocked door/placeable case
with `isDirectVRWorldUseTarget(target) && isSafeDirectVRWorldUse(target, 0)`.
Those safety rules exist to stop the generic `use()` fallback stealing ownership
from locks, keys, and story state — but a plot-owned container still exposes
authored ActionMenu routes it gates itself. Candidacy now asks only
`isDirectVRWorldUseTarget(target)`; safety is re-applied unchanged at
prompt-build time where the real authored count exists.

**B2 — `plot` was a direct-use gate. This was the decisive fix.** In Odyssey,
`Plot` marks an object **indestructible, not unusable** — flatscreen opens
plot-flagged containers and consoles normally. Gating on it refused every
prologue tutorial object (Plasteel Cylinder, Communications Console) while the
Galaxy Map worked *only* because `classifySafeDirectVRWorldUse` returns early
for `'ebon-hawk-galaxy-map'` on a branch that skips the `plot` check. `plot` is
no longer consulted; `hasStoryFailureScript` (an authored `onFailToOpen`)
remains the real ownership guard, along with locks, keys, and authored actions.

**B3 — World objects are never combat targets.** `isVRCombatTarget` now requires
`objectType & ModuleObjectType.ModuleCreature`. This also closes H3 without
resolving it empirically: `FactionManager.GetReputation` returns `0` — read as
hostile, since `IsHostile` tests `<= 10` — on its type-check failure path, and
the creature gate makes that unreachable for world objects.

**B4 — Held-trigger fall-through.** New
`VRCombatInputController.synchronizeWeaponActionHeld()` plus
`VRSpike.captureWeaponActionLatch()`, called on every frame that skips combat —
the same latch pattern `captureRadialMenuButtonLatch` already established.

**Regression introduced and fixed: menus rendered as empty black quads.** The
first `EventOnResize` XR guard was a blanket early-return, which also skipped
`camera_gui` bounds and `MenuManager.Resize()`. `VRPanelHost` reprojects the
legacy GUI through `camera_gui`, so every summoned menu lost its layout. It is
now a **split**: the 3D chain (renderer/composer/depth target/world and cutscene
camera aspects) is skipped while presenting; the 2D GUI half always runs.

**Crash fixed:** `GameState.EventOnResize()` is wired to the browser `resize`
event and called `renderer.setSize()` — which three refuses outright while
presenting — plus composer, depth target, and every camera aspect. A window
resize is routine in VR, so this had to be ignored rather than merely warned
about.

**Step 4 — single-action auto-activate — NOT STARTED.** A prompt resolving to
exactly one action should fire straight from the trigger with no panel. Every
container and console currently shows a pointless one-action panel.

### Phase B-bis — Door actions ✅ implemented / ✅ headset-accepted

Doors initially offered only `Bash`. A raw `ActionMenuManager` dump
(`[VR prompt panels]`) proved nothing was being built and discarded — the engine
genuinely returned one action. Two distinct causes:

**The `Lockable` gate was wrong (engine-level, affects flatscreen too).**

```
Low Security Door ×3 : locked=1 lockable=false keyRequired=0 openLockDC=21
Blast Door           : locked=1 lockable=false keyRequired=1 openLockDC=100
Footlocker           : locked=1 lockable=false keyRequired=1 openLockDC=0
templateHasLockable=true templateLockable=0   (not a loading bug)
actor securitySkill=6
```

`canAttemptSecurityUnlock` required `lockable`. In Aurora/Odyssey that field
means *"can be re-locked"*, not *"can be picked"* — pickability is `Locked` plus
`OpenLockDC`. A door named "Low Security Door" with `OpenLockDC=21` facing an
actor with Security 6 is unmistakably authored to be picked. The rule is now
`locked && !keyRequired`; story-reserved locks stay excluded by `keyRequired`.
Confirmed in-headset: Low Security Doors now offer Security and it works.

**`Use` was suppressed by `Bash`.** `countVRWorldPromptTargetActions` counted
*every* authored action, and that count feeds `classifySafeDirectVRWorldUse`. A
locked bashable door always has exactly one authored action — Bash — so `Use`
was suppressed on every door. Bashing a door is not an attempt to open it, so
attack entries are now excluded from that count.

> Two tests were deliberately **inverted** rather than deleted, because both
> encoded the old behaviour: `does not add direct use for an unlocked
> plot-owned object` (now asserts the Plasteel Cylinder *does* get direct use)
> and `object-lock-rules.test.ts` (rewritten around the real 001EBO values).
> Flagged explicitly — changing a passing test to make a fix go green deserves
> scrutiny; the justification is Allen's flatscreen confirmation in both cases.

### Phase C — Keyboard ☐ not started

C2 (add a latching SHIFT, thread `shiftKey` through `press()`) and H2 below.

**Exit:** a mixed-case name can be entered, DONE dismisses the keyboard, and the
name-entry screen's own OK button is reachable.

### Phase D — Held visuals ☐ not started

C3. Per-weapon-class grip transform keyed off the item's base type, aligned to
the model's grip node rather than its bounding box, real-world scale per class.

**Exit:** an equipped blaster sits in the hand and points where the controller
points.

### Phase E — Cutscene theater ☐ not started

H4 below, then composite captions into the theater texture per decision 4.

**Exit:** the first cut video plays as a single quad with legible captions and
no floating bars.

### Phase F — Menus ◐ partly diagnosed

- **C5 is VR work regardless** — the panel path must drive nested render passes
  and feed menus a VR-sourced pointer instead of `Mouse.positionUI`.
- The Powers list showing raw `spells.2da` rows (including the retail debug
  entry `Super Duper Advanced Lightning`) with `?` icon fallbacks is a
  **content/filtering** problem in the TSL menu layer, not VR.
- **Missing item icons are probably an asset-service problem, not the VR panel
  layer** — see Deferred observations.
- "Level Up button does not respond" remains unattributed.

**Still owed:** the flatscreen comparison of these three menus, to split VR
defects from pre-existing TSL menu gaps.

---

## Open probes

### H2 — Keyboard stays head-locked after DONE (issue 1b)

DONE sets `keyboardDismissed`, clears the host, and returns input to the panel
next frame — that logic looks right. Two open threads:

- The grab branch does
  `if (keyboardDismissed && !keyboardGrabHeld) keyboardDismissed = false`, so any
  grip press instantly revives a dismissed keyboard.
- There is **no `present()` call inside `processKeyboardInput`**. Something else
  re-places the plane relative to the head each frame; that is the head-lock.

### H4 — Cutscene black bars and separate caption window (issue 2)

The movie path builds a `VRPanelHost` at 2.4m wide and renders the whole GUI
viewport into it. Letterbox bars baked into the source viewport, plus a
separately-reprojected subtitle panel, would produce the reported floating bars.
Confirm by inspecting what geometry is actually present during a movie.

---

## Issue 8 — No reliable way to exit combat ◐ partly fixed

Bashing a door starts combat rounds that never resolve: a door is not a creature,
so nothing can die to end them. `beginCombatRound`/`endCombatRound` then loop
indefinitely, through cutscenes and dialogue, and the player is repeatedly
pulled back to the engaged object.

**Fixed so far.** The cancel lived inside `processCombatInput`, which the frame
loop skips whenever a world prompt consumed input. Once prompts began appearing
on every nearby object, the escape hatch became unreachable exactly where it was
needed. Extracted to `VRSpike.processCombatCancel()`, which runs every gameplay
frame before any owner claims input and resolves the combat context with a
**null** target so it works when the originating target no longer qualifies.
Right controller **B**. Two tests cover it.

**Root cause found — an early-return guard in the cancel itself.** A queue trace
printing state either side of the call showed it byte-identical:

```
before = actions=1[ActionCombat] combatAction=CombatRoundAction combatState=true target="Blast Door{HK-50}"
after  = actions=1[ActionCombat] combatAction=CombatRoundAction combatState=true target="Blast Door{HK-50}"
```

Nothing changed at all — not even `combatRound.clearActions()`, the first line.
The cause was in `getCombatContext`:

```ts
cancel: () => {
  if (vrCombatIssuedTargetId === null) return;   // ← no-op, every time
```

`vrCombatIssuedTargetId` is assigned only in `onCombatSwing`, the VR *gesture*
path. Combat entered through the world prompt's authored **Bash** route goes via
`onTargetMenuAction` and never sets it. The guard — intended as "only cancel
combat VR itself started" — made cancel a silent no-op in exactly the case that
needs it most: an endless round against a door, which cannot die and so never
resolves on its own. Guard removed.

Two earlier theories are recorded as **wrong**, since both looked plausible from
static reading: that `cancelCombat()` failing to drain `combatData.combatQueue`
was the cause (the queue is empty throughout — `combatQueue=0`), and that
`ActionCombat` might carry `clearable = false` (it inherits the `true` default).

**Diagnostic flaw fixed at the same time:** `processCombatCancel` shared
`combatInputErrorReported` with `processCombatInput`, so a flag already tripped
there would have swallowed a cancel exception entirely — hiding the very failure
the method existed to diagnose. It now has its own flag.

**Design question, undecided:** should a round against an indestructible object
self-terminate, rather than depending on the player knowing a keybind?

---

## Issue 9 — Session-long performance and memory drift ☐ not investigated

Across one ~20 minute headset session:

```
44.40 fps | heap  906MB | 46%    over 20ms
42.92 fps | heap 1337MB | 49%    over 20ms
35.92 fps | heap 1668MB | 99.82% over 20ms
32.30 fps | heap 1182MB | 100%   over 20ms
```

Triangle counts stay flat (60k–127k), so this looks like a **leak**, not scene
complexity. Phase 0 set a 50Hz acceptance minimum; sustained 32fps fails it.
Worth a dedicated pass before more feature work — everything else is harder to
judge on a degrading frame budget.

---

## Issue 10 — Bash opens doors that should be indestructible ☐ engine-level, not VR

Every door in `001EBO` carries `plot=1`, which in Odyssey means indestructible,
yet bashing opens all of them — including the Blast Door with HK-50 behind it,
which is supposed to open later as a story beat.

**Flatscreen comparison done 2026-08-21: it reproduces identically in
flatscreen.** So this is not a VR defect and nothing in the VR layer should be
changed for it. `ActionMenuManager` gates the attack option only on
`!notBlastable` (all these doors have `notBlastable=false`), and the damage path
evidently does not honour `plot` / `Min1HP` for doors.

Belongs in its own engine-level item rather than this VR plan. Fixing it will
also change flatscreen behaviour, so it needs its own decision.

---

## Issue 13 — Doors invisible in VR but rendered normally in flatscreen ☐ not investigated

Reported 2026-08-21. Some doors do not render at all in the headset while
appearing normally in the same save in flatscreen. Notably they are still
*interactable* — they produce prompts, candidacy lines, and bash targets — so
this is a rendering/visibility problem, not a missing object.

Prime suspects, none verified:

- Room visibility (`ModuleArea.loadVis`) evaluated against the flatscreen
  follower camera rather than the XR rig, so a door's room is culled.
- The per-eye frustum predicate or `roomsVisible` bookkeeping — note the VR
  startup line reports `roomsVisible`/`roomsTotal`.
- Door mesh render order / depth interacting with the stereo path.

Worth pairing with **issue 9** (performance drift), since incorrect room
visibility would affect both what is drawn and how much.

---

## Issue 11 — Security offer vs. skill-check execution ☐ needs verification

Two separate things to keep apart:

- Whether Security is **offered** — now gated on `locked && !keyRequired`
  (Phase B-bis). Deliberately does not consult skill, since the engine rolls the
  check on execution.
- Whether the attempt **succeeds** against `OpenLockDC`.

Low Security Doors are DC 21 and T3-M4 has Security 6, so a fair roll should
mostly fail. If they open reliably, the roll is not happening and
`ActionUnlockObject` needs investigating.

---

## Issue 12 — Lift plays the wrong cutscene, then stops working ☐ not investigated

Reported in-headset. The log shows `lift_002` firing repeatedly with
`[VR interaction] target=52 … route=direct-use result=ok` re-triggering the same
conversation. Working suspicion — unconfirmed — is that direct-use re-fires
while the prompt is still up.

---

## Proposal — reuse the engine's own in-game overlay instead of rebuilding it

Raised by Allen 2026-08-21 from two screenshots: the flatscreen **target action
menu** (name plate + up-to-three action columns, drawn above the object) and the
flatscreen **Cancel Combat** button. Both already exist, already carry the
correct actions and labels, and are already wired to `ActionMenuManager`.

**Why this is attractive.** Our `VRWorldActionPromptHost` is a bespoke
re-implementation of the first of those. Every door/container/action defect in
this document — issues 3, 10, 11, plus the name-tag behaviour — came from
re-deriving what `InGameOverlay` already computes correctly. Reusing it would
make those classes of bug structurally impossible.

**The single gate, and it is small.** `InGameOverlay._canShowTargetUI()`:

```ts
return (
  !this.manager.MenuContainer.bVisible &&
  GameState.CursorManager.reticle2.visible &&                       // flatscreen mouse state
  BitWise.InstanceOfObject(GameState.CursorManager.selectedObject, ModuleObjectType.ModuleObject) &&
  !BitWise.InstanceOfObject(GameState.CursorManager.selectedObject, ModuleObjectType.ModuleRoom)
);
```

The whole target UI — name plate, health bar, `LBL_TARGET0..2` action columns,
and their up/down cyclers — is gated purely on `CursorManager.selectedObject`
and `reticle2.visible`. That is the same frozen flatscreen mouse state this
codebase already documents as never updating during a WebXR session. **If VR
drives those two from its aim/proximity resolution, the engine draws its own
menu, correctly, for free.** The same is true of `showCombatUI()` /
`BTN_CLEARALL` for Cancel Combat.

**The one real obstacle.** `GameState.ts:1797` deliberately excludes
`InGameOverlay` from VR panel reprojection:

```ts
const menu = foregroundMenu?.bVisible && foregroundMenu !== GameState.MenuManager.InGameOverlay
```

So the overlay is currently never presented in VR. It is also **screen-space
positioned** — laid out against the projected 2D position of the target, which
is meaningless per-eye in stereo. Reprojecting it as-is yields a flat HUD; to
keep the world-anchored, gaze-natural placement the current prompt has, the
reprojected panel would need anchoring per-target rather than per-screen.

**Two ways to take it:**

- **Full replacement.** VR feeds `CursorManager`, `InGameOverlay` is reprojected
  and world-anchored per target, `VRWorldActionPromptHost` and much of the
  bespoke prompt model/controller are deleted. Highest correctness ceiling, and
  it retires a lot of code — but it is a re-architecture of work that is
  currently passing in the headset.
- **Thin slice first.** Only surface the combat widgets (`showCombatUI` /
  `BTN_CLEARALL`) in VR, leaving the world prompt alone. Small, immediately
  useful, and it proves the CursorManager-feeding and overlay-reprojection
  mechanics before betting the interaction system on them.

I recommended the thin slice. **Allen chose full replacement, and to do it
before issue 13.** Recorded as Phase G below.

### Phase G — Replace the bespoke prompt with the engine overlay

Sequenced so there is always a working build; this ordering is safety within the
decision, not a hedge against it. The bespoke system is removed **last**, once
its replacement is confirmed in the headset.

- **G1 — VR drives `CursorManager` selection.** A hook that calls
  `CursorManager.setReticleSelectedObject(target)` from the VR aim/proximity
  resolution, and clears it when nothing qualifies. `CursorManager.update()`
  already maintains `reticle2.visible` and the reticle texture from
  `CursorManager.selected`, so this alone should satisfy `_canShowTargetUI()`
  and make the engine build its own target menu.
  *Watch:* `setReticleSelectedObject` calls `getCurrentPlayer().lookAt(object)`,
  which rotates the player. In VR that may fight the locomotion adapter.
- **G2 — Reproject `InGameOverlay` in VR.** Remove the `foregroundMenu !==
  InGameOverlay` exclusion at `GameState.ts:1797` and present the GUI scene
  through a panel host while the overlay is the only visible menu. Delivers the
  target action menu, name plate, health bar **and** `BTN_CLEARALL` (Cancel
  Combat) in one step.
- **G3 — ~~Anchor and trim~~ → Wire overlay input.** ✅ implemented.
  Superseded by playtest: Allen reported the head-relative full HUD read
  "perfect", so trimming and world-anchoring were dropped as solutions to a
  problem that did not exist. G3 became input instead: ray, pointer and click
  routing through `VRPanelPointerHost` + `VRPanelInputController` into the
  overlay. Deliberately does NOT claim blanket foreground ownership the way
  `processPanelInput` does — the HUD is up while walking, so it consumes the
  trigger only on the frame a select edge lands on a control the overlay
  accepts, leaving the trigger free for combat otherwise.
- **G4 — Delete the bespoke system.** ◐ disabled, not yet deleted.
  `VRSpike.BESPOKE_WORLD_PROMPT_ENABLED = false` suppresses the prompt's
  presentation and activation while leaving aim resolution (which feeds
  CursorManager) intact. Shipping the deletion together with untested overlay
  input risks a build with no interaction surface and no way back; the code
  comes out once the overlay is confirmed in the headset. Sequencing within
  the decision, not a hedge against it.
  *Also fixed here:* the engine cursor selection was being fed **after** the
  bespoke prompt model was built, so a candidate whose model failed to build
  never reached CursorManager and the overlay showed nothing for a perfectly
  selectable object. Hoisted above the model build.
- **G4 (deletion, pending confirmation).** `VRWorldActionPromptHost`,
  `VRWorldActionPromptModel`, `VRWorldActionPromptController`,
  `VRWorldPromptModelResolver`, and the candidacy/prompt plumbing in
  `GameState.ts` — plus the temporary instrumentation that served them.

**Exit:** approaching a door, container, or console shows the engine's own
action menu in VR with correct actions and name plate; Cancel Combat is visible
and clickable during combat; no bespoke prompt code remains.

---

## Deferred observations (logged, not chased)

- **GUI textures fail to resolve over HTTP**: `invent1`, `invent2`, `boxline3`,
  `boxline4`, `lbl_wupitems`, `po_no`, `po_pcarth`, `confirm1/2`, `bluefill`,
  `yellowfill`, plus the action wheel's own `inv_bag01`, `iattackr`, `imap`,
  `iopts`. Very likely the real cause of the missing item icons in issue 6, and
  it points at the asset service rather than the VR panel layer.
- **Haptics unavailable under VDXR**: `haptic actuator is unavailable` on both
  hands, so every hover/confirm pulse in the wheel and prompts silently does
  nothing. Not a code defect; do not judge haptic feedback on this rig.
- **Legacy dialogue GUI only partly clickable in VR**:
  `[LegacyGUIVRPointerAdapter] panel activation did nothing: no clickable
  control among [LB_MESSAGE…], [LB_REPLIES…], [LBL_COMP_SPIKES…]`. Relates to
  ROADMAP 4.4 (dialogue skill checks).
- **Audio/asset 404s**: `dr_per01.wav` across all three stream roots,
  `001seccon*` StreamWaves, `pifo.ifo`, `availnpc*.utc`. Cosmetic so far.

---

## Temporary instrumentation to remove

All marked `TEMPORARY` in source. Remove once the issues they serve are closed:

- `reportVRWorldPromptCandidacyOnce` (`GameState.ts`) — issue 3, now closed.
- `reportVRWorldPromptPanelsOnce` (`GameState.ts`) — door actions, now closed.
- `describeCombatQueue` hook + `[VR combat cancel]` tracing — issue 8, open.
- `reportWorldPromptStageOnce` / `tracked-input-unavailable` (`VRSpike.ts`).

---

## Suggested order

1. **Issue 13** — invisible doors. A rendering fault that makes the world
   unreadable in the headset outranks polish, and it may share a cause with
   issue 9.
2. **Issue 11** — verify the Security roll actually executes against
   `OpenLockDC`; cheap, and it gates whether Phase B-bis is really done.
3. **Phase B step 4** — single-action auto-activate; removes the pointless
   one-action panel now hit on every container and console.
4. **Phase C / D** — keyboard and held visuals, independent of each other.
5. **Issue 9** — performance pass, before Phases E and F add more per-frame work.
6. **Phase E / F** — cutscene theater and menus, the two largest remaining.

Nothing below Phase B has device evidence. Every phase exit needs the same
in-headset confirmation bar the rest of ROADMAP.md holds itself to.
