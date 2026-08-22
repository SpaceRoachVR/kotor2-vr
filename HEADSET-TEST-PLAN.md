# Headset test plan

The master list of things that need a human in a headset. Everything here is
implemented and passes automated checks; none of it is accepted.

**Why this list exists.** Phases 2–5 accumulated a large amount of VR work that
was only ever verified by unit tests, TypeScript, and — since 2026-08-22 — an
emulated Quest 3 (`tools/vr-emulator/`). The emulator settles logic. It cannot
settle comfort, cadence, or whether anything actually *reads* correctly through
lenses, because IWER renders through the ordinary page WebGL context. So every
item below still needs the device.

## Before you start

1. Start the asset service and note the printed launch URL:
   ```bash
   node tools/asset-http/asset-server.js
   ```
2. Bring up the VR runtime **before** launching the browser: Virtual Desktop
   Streamer, with VDXR selected as the OpenXR runtime. SteamVR need not run.
3. Launch Chrome or Edge with a **fresh `--user-data-dir`**. A Chromium process
   caches "no XR device" from startup, so a window opened in an already-running
   browser reports `immersive-vr: false` forever and looks exactly like a broken
   runtime.
4. Disable Synchronous Spacewarp and select 72 Hz — that is the configuration
   the sustained-50 gate was measured under.

Record for each item: pass/fail, and if it fails, what it looked like. One
change per run where you can; confounding two fixes wastes a playthrough.

---

## A. Comfort and locomotion — highest risk

Comfort defects are the ones automation cannot see at all, and a bad one is
physically unpleasant rather than merely wrong.

| # | What to do | What "pass" looks like |
|---|---|---|
| A1 | Walk around `101PER` on the stick for two minutes | No nausea, no unexpected acceleration, no drift |
| A2 | Toggle smooth vs blink locomotion (offhand thumbstick press) | Mode changes; blink teleport lands where aimed |
| A3 | Smooth turn, then snap turn (Comfort Settings → turnMode) | Snap turn pivots about **your head**, not the avatar's feet |
| A4 | Set snap turn to each of its degree steps | Each step matches its label |
| A5 | Enable the comfort vignette and move | Vignette closes on motion, opens at rest |
| A6 | **Recenter** (dominant controller, button 3) — new this session | Your physical forward becomes the game's forward; head ends up over the avatar; **no vertical jump** |
| A7 | Recenter repeatedly, including while turned by snap turn | Idempotent — no creeping drift, and deliberate turning is preserved |
| A8 | Recenter while looking straight up | Ignored rather than throwing you sideways |
| A9 | Walk into a wall physically (roomscale), not on the stick | Soft push-back, no fade, no hard stop, no falling through |
| A10 | Stand, then crouch, then stand | Eye height stays canonical; no sinking into the floor |
| A11 | Play seated | Everything above still reachable |

## B. Session lifecycle

| # | What to do | What "pass" looks like |
|---|---|---|
| B1 | Enter VR from the main menu | Enters; menu is readable and not buried underground or above eye level |
| B2 | Enter VR already in-game | Same |
| B3 | Take the headset off and put it back on | Session resumes; input not stuck |
| B4 | Exit VR via the system menu, then re-enter | Clean re-entry; button text correct |
| B5 | Let tracking drop (cover the sensors) | No runaway input; wheel/prompt state clears without activating anything |
| B6 | Transition modules (`101PER` → `102PER`) in VR | No stuck prompts, no orphaned panels, party intact |

## C. The action wheel (Phase 3.8 / 4.1)

| # | What to do | What "pass" looks like |
|---|---|---|
| C1 | Hold left `X` | Wheel appears at a head-relative spot and stays **world-fixed** while held |
| C2 | Point with the left ray, confirm with left trigger | Highlighted wedge is the one that fires |
| C3 | Touch a wedge directly with either controller | Activates the touched wedge |
| C4 | Open a wheel with more than six available actions | Pagination works; nothing is silently dropped |
| C5 | Open the nested Party wheel | Party members listed; selecting one works |
| C6 | Open the wheel, then walk and turn | Locomotion and turning stay live while the wheel owns interaction |
| C7 | Open the wheel, then trigger a module transition or dialogue | Wheel closes **without activating** whatever was hovered |
| C8 | Release `X` without selecting | Closes, nothing fires |

## D. VR UI and panels (Phase 4.3)

| # | What to do | What "pass" looks like |
|---|---|---|
| D1 | Wheel → Inventory | Panel is readable, placed sensibly, scrolls |
| D2 | Wheel → Character | Same; stats legible |
| D3 | Wheel → local Map | Map renders and orients correctly |
| D4 | Wheel → Comfort Settings | Four rows cycle on Select |
| D5 | Level up available → wheel → Level-Up | Opens Character and its working Auto Level-Up route |
| D6 | Scroll a long list (inventory, dialogue) with the ray | List scrolls; the right row is picked |
| D7 | Open a panel, then move | Panel world-locks to its first placement |
| D8 | VR keyboard: name a character or a save | Keys register; done handoff latches once |

## E. Interaction and world prompts (Phase 3.9)

| # | What to do | What "pass" looks like |
|---|---|---|
| E1 | Approach an unlocked door | Prompt shows a direct `Use` |
| E2 | Approach a locked door with Security | Security route offered; direct Open **absent** |
| E3 | Approach a bashable door | Bash **and** Use both offered |
| E4 | Approach a key-required or plot-locked object | Fails closed — no direct use |
| E5 | Approach a container, a mine, and a trap | Correct authored routes (Disarm / Recover) |
| E6 | Walk out of range / break line of sight | Prompt clears immediately |
| E7 | Trigger a prompt with each controller's ray | Either works, activates **once** |
| E8 | Ebon Hawk galaxy map console | Opens via its world `Use` route, and is **never** on the wheel |

## F. Combat (Phase 3.3–3.7)

| # | What to do | What "pass" looks like |
|---|---|---|
| F1 | Swing a lightsaber at an enemy | Every swing animates and connects visually |
| F2 | Watch the hilt round timer | Only on-tempo swings roll; timer reads clearly |
| F3 | Grab with the left hand mid-swing | Promotes to two-handed. **Known partial** — the left hand's own pose does not contribute to the swing |
| F4 | Fire a blaster | Laser pointer aims; damage is stat-rolled; roll cooldown respected |
| F5 | Get shot at while wielding a saber | Automatic deflection fires per the Jedi Defense feats |
| F6 | Force push / pull flick | Gesture registers; targets the thing you are looking at, not a stale target |
| F7 | Cancel an attack mid-round | Cancel is not skipped when the target stops qualifying |
| F8 | Complete a Peragus encounter start to finish | d20 layer intact; **Phase 3 exit criterion** |

## G. Cutscenes and dialogue (Phase 5)

| # | What to do | What "pass" looks like |
|---|---|---|
| G1 | Watch the opening movie in VR | Theater screen placed comfortably; no world audio underneath |
| G2 | Enter VR **while a movie is playing** | No freeze. A previous report of this got a diagnostic, not a fix — capture the console if it recurs |
| G3 | Play a scripted camera sequence | Rig does not bury you underground; cuts are smoothed |
| G4 | Watch dialogue with camera cuts | Fade-to-black between shots |
| G5 | Hit an unskippable (`NodeUnskippable`) line | The VR abort still gets you out |
| G6 | Dialogue skill checks | **Unconfirmed** — may already work via generic reprojection, may need bespoke work |
| G7 | The whole prologue's scripted sequences | **Comfort pass not done** — flag anything unpleasant |

## H. Rendering and performance

| # | What to do | What "pass" looks like |
|---|---|---|
| H1 | Look for white boxes / missing textures | None on world surfaces or on inventory and ability icons |
| H2 | Watch for menu mirroring artefacts | Never root-caused; a diagnostic is in place — capture the console |
| H3 | Run the perf window in `101PER` | Sustained ≥ 50 FPS, p90 ≤ 33.33 ms, p99 < 50 ms |
| H4 | Play ten minutes without reloading | Memory stable; no climbing load times |
| H5 | Load three modules in succession | No `Array buffer allocation failed` from the Bink decoder |

## I. Known-unfinished — confirm the gap, do not treat as a bug

- **3.3** Two-handed saber is a mode flag, not dual-wielded tracking.
- **4.2** No distinct physical/3D inventory; the flat 2D one reprojects.
- **4.4** Dialogue skill-check panels unverified.
- **4.5** `gui/` has not been audited for unreachable controls, and TSL menus are
  frequently stubs where K1 is complete.
- **5.3** No comfort pass over the prologue.
- `Pause`, `PartyCommand`, and `ToggleWalkRun` are bound to buttons but consumed
  nowhere. `Pause`/`PartyCommand` have no defined intent; `ToggleWalkRun` has no
  walk/run distinction in the movement system to hook into.

## J. Flatscreen regressions to spot-check

Phase 1 is still open, and the studio-remediation stack touched the texture
loader, material routing, and module transitions heavily.

- J1 Peragus prologue starts as **T3-M4**, one entity, camera and UI agreeing.
- J2 Inventory slots equip, and the equipment persists across save/load.
- J3 Setting a mine completes.
- J4 `p_kreiastunt` renders as a corpse container, not a bind-pose figure.
- J5 No area audio under a movie.
- J6 Textures survive a module transition (the material-cache ownership work).
