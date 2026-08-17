# VR Audit & Completion Plan

Written 2026-08-17 from a five-agent static-code audit of `src/vr/`, `src/GameState.ts`,
and the flatscreen systems it hooks into. Covers the five symptoms reported after the
latest headset playtest, plus a full completeness check against
[ROADMAP.md](ROADMAP.md) Phases 2-8. All root causes below are backed by file:line
citations found by reading the actual code — reasoning from static analysis, not device
logs, so a few (marked) are the best-supported hypothesis rather than a confirmed cause.

**Working agreement note:** the user will test after the full implementation pass rather
than per-change, so this plan does not gate each fix behind a playtest. Still type-check
(`npx tsc --noEmit -p tsconfig.kotorjs.json`) and commit locally per logical change per
the existing working agreement.

---

## Stage 0 — Diagnostics foundation (do first)

These don't fix symptoms directly but are currently *hiding* evidence needed to confirm
several of the fixes below. Doing them first means later stages can be verified against
real console output instead of guesswork.

- **0.1 — Un-share the VR error-suppression flag.** `VRSpike.interactionInputErrorReported`
  (`src/vr/VRSpike.ts:152`) is a single shared boolean reused across 7+ unrelated
  try/catch blocks (locomotion, interaction, combat, panel, label hosts — lines 582, 623,
  727, 770, 795, 1152, 1176). The first exception anywhere silences `console.error` for
  *all* of them for the rest of the session. Split into one flag per subsystem. This may
  by itself explain part of "nothing was selectable."
- **0.2 — Log XR interaction-profile mismatches.** `XRInputRouter.ts` only binds
  Select/Use/Grab for `oculus-touch-v3/v2/v1` profile strings (lines 76-97, bindings ~62-65).
  If the Quest 3's actual reported profile doesn't match, `route()` silently returns zero
  actions for everything. Add a one-time `console.warn` naming the actual profile string
  when no binding table matches.
- **0.3 — Log the `VideoManager.playMovie` stuck-`isPlaying` guard.** `VideoManager.ts:217-222`
  silently no-ops if `isPlaying` is already `true`. Add a diagnostic naming the movie that
  was requested and the movie currently (allegedly) playing.
- **0.4 — Log `syncRig`'s null-player fallback.** `VRSpike.ts:1187-1198` falls back to
  `worldCamera` when `getPlayerPosition()` is null. Log when this fallback fires and what
  `worldCamera` was, to confirm the cutscene-camera hypothesis in 3.1 below.

---

## Stage 1 — Fix the five reported symptoms

### 1. World objects not selectable (Galaxy Map, plasteel cylinder, computer terminal, door)

- **Confirmed:** `InteractionSystem`/`InteractionTargetRegistry` **are** wired into the
  frame loop (`VRSpike.ts:696-724` → `GameState.ts:925-959`) — not orphaned code.
- **Correction after deeper follow-up:** the first audit pass flagged `area.items`
  (`GameState.module.area.items`) as structurally excluded from
  `GetSelectableObjectsInRange` (`ModuleObjectManager.ts:743-749`) and treated that as the
  likely cause. Tracing where `area.items` is actually populated shows this isn't it:
  it's written only by the `CreateItemOnFloor` NWScript action (`NWScriptDefK1.ts:8586-8613`),
  whose own doc comment says it's "for items that have been created on the ground, and
  will be destroyed without ever being picked up" — decorative floor debris, not general
  ground loot. It's empty in practice outside that specific script call. The plasteel
  cylinder is almost certainly a `ModulePlaceable` like the Galaxy Map and the terminal,
  which already are included (line 745) — so building item-pickup infrastructure here
  would fix a symptom that isn't occurring. Not doing that.
- **Better-fitting root cause found:** `ModuleObjectInteractionTargetSet.synchronize()`
  (`ModuleObjectInteractionTarget.ts`, pre-fix) called `validateEngineObject()` on every
  object in the engine's live target list inside a loop with no try/catch, and threw on
  the *first* malformed object (bad id, non-`Vector3` position, missing `isUseable`/
  `onClick`) or the first duplicate id — aborting registration for every other object in
  the same call. Combined with Stage 0.1's error-masking bug (this exception landed in the
  same shared `interactionInputErrorReported` catch as everything else and got silenced
  after the first occurrence), this is a plausible single mechanism for "nothing
  responded to anything," matching all four failed object types uniformly rather than
  requiring four separate explanations.
- **Fix applied:** `synchronize()` now skips a malformed or duplicate-id object
  (warn-once, not per-frame spam) instead of throwing and dropping the whole batch.
- **Remaining fix:** apply 0.1 and 0.2, then re-test — if a specific object is still
  triggering the skip-warning, its name will now be in the console instead of hidden.

### 2. Right trigger starts combat with no target, can't be cancelled

- **Confirmed root cause:** VR combat's target nomination
  (`GameState.getCombatContext`, `GameState.ts:960-985`) reads
  `CursorManager.hoveredObject ?? CursorManager.selectedObject` — but `CursorManager` is
  **only ever written by the flatscreen mouse path** (`IngameControls.ts`,
  `CursorManager.ts`). Zero references to `CursorManager` exist anywhere under `src/vr/`.
  Once a WebXR session starts, mouse events stop firing, so this reference freezes at
  whatever was last hovered before "Enter VR" — and `isVRCombatTarget`
  (`GameState.ts:105-109`) never checks distance/LOS/staleness. A stale hostile reference
  stays "valid" forever, so trigger pulls always resolve to an attack.
- **Confirmed cancel bug:** `processCombatInput` (`VRSpike.ts:735-775`) bails out at
  line 739 (`if (!context.nominatedTargetId) return`) **before** reaching the Cancel
  check. Once the stale target stops qualifying, the entire block — including its only
  cancel path — stops running, orphaning an in-flight attack with no way to back out.
- **Confirmed blaster gap:** `processBlaster` (`VRCombatInputController.ts:99-116`) fires
  a roll-eligible swing on every trigger rising edge with **no cooldown gate** — `nextRollAt`
  is declared but never read/updated in this branch, unlike the melee path which correctly
  implements ROADMAP 3.4's "every swing animates, only on-tempo swings roll."
- **Fixed:**
  1. Replaced the `CursorManager`-sourced target with a live VR-native target:
     `getCombatContext`/`getForceContext`/`getRadialMenuContext` now take an
     `aimedTargetId` computed each frame from VRSpike's own right-hand
     interaction-ray preview (reused from `processInteractionInput`, which always
     runs first) and resolved against `playerSelectableObjects` — not frozen mouse
     state. All three hooks shared the identical stale-CursorManager bug, so all
     three were fixed together (`GameState.ts` `resolveVRAimedObject`, `VRSpike.ts`
     `resolveAimedTargetId`).
  2. Reordered `processCombatInput` so the Cancel check runs unconditionally, before
     the `nominatedTargetId` early-return.
  3. Added the same visual/roll cooldown gating to `processBlaster` that melee
     already has, with a locking test (`vr-combat-input-controller.test.ts`).
  4. "Trigger with no live hostile" now naturally does nothing, since
     `nominatedTargetId` is null and `onCombatSwing` never fires a round action.
  5. Not fixed (separate, lower priority, unchanged): `resolveVRCombatWeaponMode`
     defaults to `'unarmed'` (`GameState.ts:207`), which
     `VRCombatInputController.isMelee` excludes — unarmed VR combat is a silent
     no-op today.
  - Full test suite (276 tests) passes after this change.

### 3. Menu backward / keyboard unresponsive / three pointers / can't see typed name

- **Confirmed root cause (keyboard "unresponsive" + can't see input):**
  `K1_MenuSaveName.show()` activates the edit box immediately on open (no click needed),
  which makes `GameState.getKeyboardContext()` return non-null the instant the menu opens.
  `VRSpike.renderPanel()` (`VRSpike.ts:1111-1120`) unconditionally **hides the entire
  panel** (title, edit box, OK/Cancel) whenever a keyboard context exists — for this
  screen, that's the whole time it's open. Key routing itself
  (`VRSpike.ts:665-669` → `VRKeyboardInputController` → `GUILabel.onKeyDown`) traced as
  sound and is covered by `vr-spike-xr-loop.test.ts:353-381` — the perceived
  "doesn't respond" is very likely just "invisible," not actually broken input.
- **Confirmed separate bug (feels like "stuck"):** `GameState.ts:1080`'s
  `getKeyboardContext().cancel` calls `triggerControllerBPress()`, but TSL
  `MenuSaveName.ts:42/47` wires `_button_b = BTN_OK` / `_button_a = BTN_CANCEL`. Pressing
  what the user thinks is Cancel actually clicks **Save**.
- **Confirmed "three pointers":** `XRControllerAnchorHost.createRayAnchor()`
  (`XRControllerAnchorHost.ts:135-162`) draws an always-on debug ray per hand,
  independent of any panel/keyboard ownership state. `VRPanelPointerHost` has separate
  instances for the panel and the radial menu (`VRSpike.ts:169`, `:819`). There is no
  single pointer-arbiter — exclusivity is reimplemented ad hoc per-subsystem
  (input-side only, `VRSpike.ts:441-444`; not on the visual/render side at all).
- **Backward menu — inconclusive, narrowed:** `VRPanelHost.place()`'s basis construction
  (`VRPanelHost.ts:93-119`) was checked algebraically and is **not** mirrored (matches
  standard `lookAt` convention); the Z-up/Y-up conversion is a pure rotation and can't
  introduce a mirror either. Two remaining suspects outside this audit's file set:
  `GameState.camera_gui`'s orthographic bound signs, and whether `renderTarget.texture`
  needs `flipY` handling in `VRPanelHost.renderGui()` (`VRPanelHost.ts:121-146`). Also
  worth checking: the panel material is `DoubleSide` (`VRPanelHost.ts:47`), which shows a
  true mirror image with no UV flip if the player ends up behind the panel plane.
- **Fixed:**
  1. `renderPanel()` no longer clears/hides the panel while a keyboard context is
     active — it stays visible (live-rendered from the real GUI scene, so typed text
     shows as it's entered) and only the stale pointer/cursor is cleared, since that
     — not a broken keyboard — was the actual "third pointer stuck on the name":
     `latestPanelPointerPosition` was never reset once keyboard focus took over, so
     it kept getting reapplied at whatever position it was frozen at.
  2. Found and fixed the real B-button bug: it wasn't in the generic VR hook (which
     correctly assumed the codebase-wide convention `_button_a` = confirm,
     `_button_b` = cancel — confirmed true in ~30 other menus). `MenuSaveName.ts`
     itself had this backwards in **both** the K1 base
     (`src/game/kotor/menu/MenuSaveName.ts`) and the TSL override
     (`src/game/tsl/menu/MenuSaveName.ts`), so pressing what the player reads as
     Cancel actually clicked Save on this one screen. Swapped both.
  3. `XRControllerAnchorHost`'s always-on debug ray now defaults off
     (`showDebugGeometry` default flipped `true` → `false`) — it was redundant with
     the panel/radial-menu/keyboard's own purpose-built pointers and the
     world-interaction target label, and could show up to three ray-like things on
     one hand at once. Still available via the constructor flag for debugging.
  4. Lowered the keyboard's default vertical placement by 0.35m (`VRKeyboardHost.present`)
     so it sits below the now-always-visible panel instead of centered over it.
  5. Backward-menu bug: re-checked `camera_gui`'s orthographic bounds (not mirrored,
     standard `-w/2..w/2` / `-h/2..h/2`) and the panel placement math again (front
     face is correctly oriented toward the player) — found nothing further by static
     reading. Added a one-shot diagnostic (`VRPanelHost.place()`) logging head
     position/forward and the resulting panel position/normal/right vectors, so the
     next headset run empirically distinguishes a geometry bug (would show wrong
     vectors) from a texture/UV mirroring bug (vectors would look correct, only the
     rendered pixels would be flipped) instead of guessing further blind.
  - Full test suite (276 tests) passes after this change.

### 4. Cutscenes buried in floor / can't skip / automated move too close / movie doesn't trigger / VR-entry-during-movie freeze

- **Confirmed — buried in floor:** `syncRig` (`VRSpike.ts:1187-1198`) falls back to
  `worldCamera.getWorldPosition()` minus `eyeHeight` (1.75m) when `getPlayerPosition()`
  is null. During an animated cutscene, `worldCamera` is `camera_animated` (the
  dolly/stunt camera, already at normal eye height) — subtracting eye height again drives
  the rig underground. `getPlayerPosition()` returns null when `PartyManager.Player` is
  unresolved, which ROADMAP.md item **1.3** already documents as an open prologue bug —
  the two bugs compound.
- **Confirmed — can't skip:** `getCutsceneContext()` (`GameState.ts:1060-1069`) only
  exposes the gated per-line skip (mirrors flatscreen `DialogSkip`,
  `IngameControls.ts:583-593`, gated by `currentEntry.skippable`). Flatscreen also has an
  *unconditional* abort (`KeyMapAction.DialogAbort` → `CutsceneManager.endConversation(true)`,
  `IngameControls.ts:596-602`) with no VR equivalent — a `NodeUnskippable` entry
  (`DLGNode.ts:810-813`) is permanently stuck in VR today.
- **Confirmed — automated move too close:** same `syncRig` mechanism, primary path this
  time — it ties the VR rig 1:1 to the raw PC `ModuleObject.position` every frame in
  every engine mode, with no smoothing. A scripted `ActionMoveToPoint`/jump during
  cutscene setup is invisible on flatscreen (camera is overridden by
  `camera_dialog`/`camera_animated`) but directly yanks the VR headset position.
- **Movie doesn't trigger at all — likely separate bug:** `VideoManager.playMovie`
  (`VideoManager.ts:217-222`) silently no-ops if `isPlaying` is already stuck `true` from
  an earlier interrupted/failed movie — with zero visible symptom. All movie entry points
  (boot-time, NWScript `PlayMovie`/`PlayMovieQueue`) share this guard.
- **VR-entry-during-movie freeze — best-supported hypothesis, not proven:**
  `VRSpike.enter()` (`VRSpike.ts:307-369`) does zero coordination with `GameState.Mode` /
  `VideoManager.isMoviePlaying()` / `MovieModeOwnership`. `renderMovie`/`renderCutscene`
  (`VRSpike.ts:1008-1095`) both hard-require `latestInputFrame` non-null and silently
  `return` with no fallback/timeout if the XR reference space isn't ready yet — combined
  with `setAnimationLoop` fully replacing `requestAnimationFrame` while presenting
  (`GameState.ts:1604-1606`), a stall here presents as a genuine freeze recoverable only
  by leaving VR.
- **Also found (general correctness bugs, not VR-specific but affect cutscene reliability):**
  - `CutsceneManager.removeEventListener` (`CutsceneManager.ts:1340-1348`) has inverted
    logic — early-returns when the listener *is* found, and on the not-found path calls
    `splice(indexOf(listener), 1)` where `indexOf` is `-1`, removing the *last* element
    instead. Listener removal is effectively broken.
  - `CutsceneManager.updateCameraAngleSpeakerBehindPlayer` (`CutsceneManager.ts:1044-1054`)
    has dead code after an early `return` — the collision-based distance-scaling logic
    never executes.
- **Note:** contrary to ROADMAP.md calling Phase 5.1 "not yet done," a working
  theater-screen reprojection already exists (`VRSpike.renderMovie`/`renderCutscene`,
  wired through `GameState.UpdateMovie`/`getMovieContext`/`getCutsceneContext`, tested in
  `vr-spike-xr-loop.test.ts`) — it's exactly the code producing bugs 4a-4c. The roadmap
  entry is stale and should be reconciled once this stage lands.
- **Fixed:**
  1. `syncRig` no longer runs at all during a cutscene (`VRSpike.render()` now checks
     `getCutsceneContext()` before calling it) — the theater panel is positioned from the
     physical head pose, not from this sync, so skipping it costs nothing and stops both
     the buried-in-floor fallback and the raw position-snap in one change. (The
     null-`getPlayerPosition()` root cause itself is still ROADMAP 1.3, unfixed here —
     out of scope for a VR-specific pass.)
  2. Added a VR-native unconditional abort to `getCutsceneContext()` (`GameState.ts`),
     mirroring flatscreen's `DialogAbort` → `CutsceneManager.endConversation(true)`. Wired
     it into `processMovieInput` so the skip-family buttons call `abort()` instead of
     `skip()` whenever `canSkip` is false. Gated on `!currentEntry?.repliesShown` so it
     can't fire once real reply choices are on screen (that state also has `canSkip:
     false`, but pressing the button there must let the panel handle the reply, not end
     the conversation). Locked in with a new xr-loop test.
  3. Added a diagnostic (not a guessed fix) for the stuck-`isPlaying` movie-trigger
     report: the exception path already resets `isPlaying` correctly via `cleanup()`, so
     if it's genuinely getting stuck the cause is likely `BIKObject.play()` hanging
     without ever resolving or rejecting — Stage 0.3's diagnostic will name the rejected
     vs. stuck-current movie on the next run rather than guessing at a fix blind.
  4. Added a diagnostic (not a guessed fix) for the VR-entry-during-movie freeze too:
     traced the actual call order and found `updateTrackedInput` already runs
     unconditionally first every frame, which is more sound than the original audit
     assumed — so the "missing inputFrame" theory only plausibly explains a 1-2 frame
     stall, not a sustained freeze. `renderMovie`/`renderCutscene` now log once if they
     ever do bail on missing prerequisites, so a real sustained case is visible instead
     of silent, without risking a blind structural change to session-entry timing that
     the evidence doesn't actually support.
  5. Fixed `CutsceneManager.removeEventListener`'s inverted early-return (was removing
     the wrong element via `indexOf(listener)` evaluating to `-1`) and deleted the dead
     code after the early `return` in `updateCameraAngleSpeakerBehindPlayer` (the
     distance-scaling fallback it never reached) — both pre-existing, VR-independent
     correctness bugs found while reading this file for the theater-reprojection audit.
  6. Not done: reconciling ROADMAP.md's stale Phase 5.1 status — left for the housekeeping
     task at the end of this pass so it reflects the final state, not a mid-pass one.
  - Full test suite (277 tests, +1 new) passes after this change.

---

## Stage 2 — Close the highest-value roadmap gaps

Full status table (all of Phases 2-8) is in the audit notes; summarized here by what's
actually worth building next given what scaffolding already exists.

1. **2.4 — Soft-block on wall intrusion.** Zero code exists today. Safety-relevant and
   blocks the Phase 2 exit criterion ("without falling through geometry or leaving
   walkable space"). Needs a rig-vs-walkmesh collision check pushing the rig back, no
   fade/hard stop per the original design note.
2. **2.5/2.6 — Comfort options + settings surface. Mechanics done, UI surface deferred
   to 2.4.** Implemented as small, independently-tested modules rather than folded into
   `LocomotionController` (which stayed a pure continuous-smooth resolver):
   - `VRSnapTurnController.ts` — discrete fixed-increment turn with a standard
     engage/reset edge-detection gate, sharing state with nothing else.
   - `VRTeleportController.ts` — aim-while-deflected, commit-on-release, same edge shape.
     Landing point is clamped through `VRWallSoftBlock`'s `VRWalkmeshQuery` interface
     (`isPointWalkable`/`getNearestWalkablePoint`) so a teleport can't land inside
     geometry, reusing the same primitive 2.1 introduced. The actual relocation runs
     through `ModuleObject.JumpToLocation` — the same primitive the engine's own
     NWScript `JumpToLocation`/warp effects use — via a new `teleportPlayer` hook.
   - `VRComfortVignetteHost.ts` — a radial-gradient quad parented to the XR camera
     (so it needs no per-frame transform, only an opacity set), faded in by movement
     magnitude while `vignetteEnabled` and in smooth-locomotion mode; off during the
     discrete modes, which don't produce continuous vection.
   - `GameState.ts` owns the persisted `VRComfortSettings` (`locomotionMode`, `turnMode`,
     `snapTurnDegrees`, `vignetteEnabled`) behind `getComfortSettings`/`setComfortSettings`
     hooks; `VRSpike.processLocomotionInput` branches on it every frame and wires the
     already-bound `ToggleLocomotionMode` button (previously present but unread) to flip
     `locomotionMode`.
   - **Not done — a settings UI to reach `turnMode`/`snapTurnDegrees`/`vignetteEnabled`
     (`ToggleLocomotionMode` is reachable now; the others aren't yet).** Building a second
     bespoke panel now would duplicate the summon/host infrastructure 2.4 needs anyway —
     consolidating there instead of shipping two.
   - 6 new tests (unit + integration) covering toggle edge-detection, snap-turn firing
     once per deflection, and teleport committing a walkmesh-clamped point.
3. **3.5/3.6 — Diegetic hilt timer + blaster auto-deflection.** Both ride on state that
   already exists (`rollCooldownMilliseconds`/`nextRollAt` in `VRCombatInputController`).
   A world-space indicator following the same pattern as `VRWorldTargetLabelHost` closes
   3.5; an incoming-fire deflection check closes 3.6.
4. **4.1/4.3/4.4 — Wrist device + purpose-built panels.** `VRPanelHost` +
   `LegacyGUIVRPointerAdapter` already generically reproject any legacy menu (inventory,
   character sheet, galaxy map) into world space with working pointer input — what's
   missing is a deliberate summon UX. The `Wrist` semantic action is already bound to a
   button and completely unused (`XRInputRouter.ts:67`); wire it to open a wrist-anchored
   shell that launches these panels, which closes 4.1, 4.3, and most of 4.4 at once.
5. **5.2 — Fade-to-black between camera cuts.** The reprojection mechanism
   (`renderCutscene`) is done; only the transition is missing. `VRPanelHost.present()`/
   `clear()` already gate visibility — hook a fade in at that boundary.
6. Lower priority, do after the above: **4.2** physical inventory (beyond the generic
   panel reprojection), **4.5** a systematic `gui/` unreachable-control audit + TSL-vs-K1
   stub diff, **5.3** a comfort pass specifically over the prologue's scripted sequences.
7. **Housekeeping:** `XRSessionController.ts` and `XRFrameCoordinator.ts` are fully built
   and tested but unused — `VRSpike.ts` reimplements their responsibilities inline. Wire
   them in to remove the duplication, or delete them; leaving both increases maintenance
   risk with no benefit.

Phases 6-8 (Peragus VR slice, full campaign, release) are correctly not started — they're
gated behind the above and are session-sized in their own right. Not attempting them in
this pass.

---

## Sequencing for this implementation pass

Stage 0 → Stage 1 (in the order listed: world interaction, combat, menu/keyboard,
cutscenes/movies — interaction and combat first since they're likely blocking basic VR
playability entirely) → Stage 2 items 1-5 in the order listed. Commit locally per logical
change, type-check before each commit, and reconcile ROADMAP.md's phase status once the
Stage 1 fixes land.
