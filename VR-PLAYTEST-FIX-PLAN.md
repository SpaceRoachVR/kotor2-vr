# VR Playtest Fix Plan — 2026-08-17 headset session

Twelve issues from the first real headset test of the VR stack. This plan groups them by
what blocks play, records the design decisions behind the gameplay-affecting ones, and
is honest about which items still need investigation versus which have a confirmed cause.

**Design decisions made by the user this round:**
- Out-of-range objects should **not show a label at all** until the player is close
  enough to actually interact. (Simpler and stronger than a "move closer" prompt — it
  removes the walk-to pull at its source, since an unlabeled object is never selectable.)
- Locked doors/containers get a **floating panel at the lock** with the valid options.
- The blaster laser sight shows **only during combat**.

---

## P0 — blocks playing at all

### 1. Trigger starts phantom, unstoppable combat

**Mechanism confirmed:** battle music is driven by `ModuleCreature.excitedDuration`
(`ModuleArea.updateMusic`, line 639-650) — set to `10000` by `resetExcitedDuration()` and
decaying by `1000 * delta` per frame, so ~10 seconds. "Never-ending" therefore means
something is *continuously* re-triggering it, not that it's set once.

**Root cause hypothesis (needs one diagnostic to confirm):** Stage 1.2 made VR combat
target whatever the interaction ray is aimed at, gated only on `isHostile`. Peragus has
hostile assassin droids (`g_assassindrd01`), so sweeping the ray past one and pulling the
trigger legitimately queues an attack. Because the target is out of engagement range, the
engine falls into its desktop behavior of walking the actor into range (the same root as
issue #6 below) — which never completes cleanly in VR, so the round never resolves and
`excitedDuration` keeps being refreshed.

**Fix:**
- Gate combat target nomination on the *same* range rule as interaction (see #6): a
  target that isn't legitimately engageable is never nominated.
- Melee weapon modes require proximity; blasters may engage at range (that is the point
  of a blaster) but must never queue a walk-to.
- Make the cancel path actually clear engine-side combat state (`clearActions()` alone
  isn't enough if an `ActionCombat` is still queued) — clear the queued combat action and
  let `excitedDuration` decay.
- Add a one-shot diagnostic naming what nominated the target and what queued the round,
  so the next run confirms or refutes the above rather than guessing again.

### 2. VR keyboard accepts no controller input

Renders correctly (user: "look perfect") but no key ever registers; the user had to leave
VR to type a name. Traced the call path — `processKeyboardInput` runs, the host is
constructed, and `keyAtRay` raycasts — but I could not identify the break by reading
alone, and I am not going to guess at a fix for the one thing that blocks character
creation.

**Two candidates worth checking first:**
- **UV row flip.** `VRKeyboardHost` draws its canvas with y=0 at the *top*, but raycast
  `hit.uv.y = 0` is the *bottom* of the plane. If `resolveVRKeyboardKeyAtUV` doesn't flip
  v, every hit resolves to the wrong row. (This would produce *wrong* keys, not *no*
  keys — so it may be a second bug rather than this one.)
- **First-frame visibility.** `keyAtRay` early-returns `null` when `!this.object.visible`,
  and `present()` is only called later in the frame from `renderKeyboard()`. If something
  keeps the host from ever being presented, every raycast silently returns null forever.

**Fix:** add targeted diagnostics at each stage (context present → host visible → ray
pose present → row/key resolved), run once, then fix what they name.

### 3. Selecting a distant object pulls the player across the map

Confirmed as the original game's walk-to-then-use behavior leaking into VR. Per the
user's decision, the fix is at the *targeting* layer rather than the action layer:

- `InteractionTargetRegistry`/`ModuleObjectInteractionTarget` gain a maximum interaction
  range; targets beyond it are not resolvable, so they produce **no label, no reticle,
  and no selection**.
- Range should match the engine's own use-distances already in `VRWorldUseAdapter`
  (2.0m doors, 1.5m placeables) so VR agrees with the rules the engine enforces anyway.
- Belt-and-braces: ensure no VR path can queue `ActionMoveToPoint`/walk-to. The direct-use
  adapter already avoids this; the `ActionMenuManager` fallback path does not and must be
  checked.

---

## P1 — playable but badly degraded

### 4. Interaction ray pointer is "way off"

**Confirmed, and it's my bug from last session.** The red ray in the screenshot is
`VRBlasterLaserHost`, which I attached to `controllerAnchorHost.getAnchor('right')` — the
**grip** anchor — instead of `getRayAnchor('right')`. Grip pose and target-ray pose have
substantially different orientations (grip follows the handle, target ray points where
the controller aims), which is exactly why the menu pointer looks right and this doesn't.

Compounding it: I defaulted `XRControllerAnchorHost`'s debug ray *off* last session, so
world interaction currently has **no aiming visual of its own at all** — the only ray on
screen during exploration is the misaligned laser, which reads as "the interaction
pointer is broken".

**Fix:**
- Move the blaster laser (and the hilt timer, same mistake) to the ray anchor.
- Show the laser only during combat (user's decision).
- Add a proper world-interaction aiming visual driven by `targetRayPose`, so exploration
  has a correct pointer. Reuse the existing reticle/label rather than inventing new UI.

### 5. Object labels leak internal metadata

`Blast Door{Impossible}`, `Body{Invis container} (Empty)` — raw authored names including
designer annotations. **Fix:** strip `{...}` annotations for display, and suppress labels
entirely for helper objects that were never meant to be seen (the "Invis container"
class). Keep the raw name in diagnostics.

### 6. Locked doors and containers have no real options

Currently defaults to bash or does nothing. Per the user's decision, build a **floating
panel at the lock** offering the valid options only (Security skill / Security Tunneler /
Bash), driven by the same eligibility rules `ActionMenuManager` already implements
(`canAttemptSecurityUnlock`, tunneler `baseItemId == 59`, `notBlastable`).

Note `ActionMenuManager.UpdateMenuActions` only populates target actions for placeables
and doors **when locked** — unlocked ones produce an empty panel, which is part of why
some interactions silently do nothing today.

### 7. Galaxy map not interactable

High priority per the user. Needs investigation — the galaxy map reprojects through the
generic `VRPanelHost` path like other menus, so the fact that it alone doesn't respond
suggests it uses custom hit-testing or a 3D sub-view (`LBL_3DView`) rather than plain GUI
controls. Investigate before proposing a fix.

### 8. Peragus exterior lift not interactable

Needs investigation. Likely either out of the new interaction range, not present in
`playerSelectableObjects`, or gated behind a script/trigger rather than a `use` route.

---

## P2 — cosmetic or environmental

### 9. Main menu spawns above eye level on VR entry

Only affects menus already open when entering VR; menus opened later are correct. Two
suspects, both in play: `syncRig`'s no-player fallback (`worldCamera` minus `eyeHeight`)
is unreliable at the main menu where no module is loaded, and `VRPanelHost` additionally
raises authored main-menu layouts by `MAIN_MENU_VERTICAL_OFFSET_METRES = 0.9`. Re-anchor
the rig sanely when there's no player, then re-check whether the 0.9m offset is still
warranted.

### 10. Some doors do not render

Needs investigation. Note the engine deliberately skips *open* doors in
`GetSelectableObjectsInRange`, so a door that is both invisible *and* still labeled is
closed-but-not-rendering — a model/load issue rather than a culling one. Add a diagnostic
naming the door and its model state.

### 11. SteamVR / MetaXR runtime support

WebXR in Chrome talks to whichever OpenXR runtime is active, so this is mostly
environmental rather than something the mod controls — our `requestSession` call only
asks for `local-floor`/`bounded-floor`, which every runtime supports. **I don't want to
claim a code fix here without evidence.** Plan: add a clear diagnostic reporting the
active runtime, what `isSessionSupported` returned, and the exact `requestSession`
failure, so the next run tells us whether this is a config issue (SteamVR not set as
active OpenXR runtime) or a real compatibility gap worth coding around.

---

## Sequencing

P0 first (1 → 2 → 3), since those block play outright and #1/#3 likely share the walk-to
root cause. Then P1 in listed order, with #4 early because a correct aiming visual makes
everything else easier to test. P2 last. Type-check and run the suite per change; rebuild
and restart the asset server before handing back for the next headset run.
