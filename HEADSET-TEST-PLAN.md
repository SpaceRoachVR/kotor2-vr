# Headset test plan

The master list of things that need a human in a headset. Everything here is
implemented and passes automated checks; none of it is accepted.

**Why this list exists.** Phases 2–5 accumulated a large amount of VR work that
was only ever verified by unit tests, TypeScript, and — since 2026-08-22 — an
emulated Quest 3 (`tools/vr-emulator/`). The emulator settles logic. It cannot
settle comfort, cadence, or whether anything actually *reads* correctly through
lenses, because IWER renders through the ordinary page WebGL context. So every
item below still needs the device.

## Session 1 findings (2026-08-22)

The first device run ended early when the game glitched badly. Four root causes
came out of the console; three are fixed and want a retest:

| Was | Now | Retest |
|---|---|---|
| Player invisible in the med bay, fine in flatscreen | `MenuPartySelection` called `LoadModel` instead of `loadModel` — threw on every portrait build | J1, and look at the med bay PC |
| 2D UI stayed up after any interaction | TSL menus dropped their K1 click handlers; the journal's own Exit button was never wired | D9–D16, G4 |
| Map and Abilities threw when opened from the wheel | `MenuMap` touched a control TSL lacks; `GUIFeatItem` hit a `feats.2da` padding hole | D3, D11 |
| Interacting drags the avatar around | **Fixed.** Approach-walk is suppressed while a VR session owns the player's position — the avatar acts from where it stands | E9–E13 |

**Performance, first real numbers since Phase 0:** 32–36 FPS in stereo through
the busier Ebon Hawk rooms, p90 ~32 ms, 74–100% of frames over 20 ms; lighter
windows reached 52–54. Below the sustained-50 gate for much of the run. That is
H3, and it is now the largest open risk.

## Session 2 findings (2026-08-22)

The second device run got further but could not finish the scenario. Nineteen
issues came back. Status below; everything marked **fixed** was confirmed under
`npm run vr:check` against the real build before being called fixed.

### Fixed and emulator-confirmed

| Was | Cause | Retest |
|---|---|---|
| Activating from the edge of range still pulled the player | Only 2 of 13 actions had approach suppression. `ActionUnlockObject` (Security) — the most-used action — still walked. Now all 11 player-initiated actions, and scoped to the player so party/NPC movement is untouched | E9–E13 |
| Recenter still worked looking straight up | The guard only caught an *exactly* vertical forward vector; a real headset is a few degrees off. Now a ~75° pitch limit | A8 |
| Level Up did nothing | **Neither K1 nor TSL ever wired `BTN_LEVELUP`**; `MenuLevelUp` is a shell with no handlers. Routed to the working auto-level-up path | D5 |
| Left stick felt overloaded | Movement mode was on the offhand *trigger*, shared with wheel Select. Now Comfort Settings only | A2, A13 |

### Confirmed working

- Walk/run on the offhand stick click (**A2 in this document was wrong** and is corrected).
- Blink locomotion functions — but needs a ray to aim, see below.
- Comfort Settings opens from the wheel.

### Fixed in code, awaiting headset confirmation — the ray pointer

This was the single biggest usability gap and produced four separate reports
from one cause: every ray-driven surface hard-coded which controller it listened
to, and nothing on screen said which, so pointing with the other hand did
nothing and the surface read as broken rather than as listening elsewhere.

Resolution is now by hit rather than by role — whichever hand is actually on the
surface owns it, and the holding hand keeps it while both hands hit so the
highlight cannot strobe at a wedge seam.

- **Comfort Settings** — was right-hand only *and* drew no ray at all, so the
  player could neither aim nor see where they were aiming. Now either hand, with
  the same ray and cursor the legacy panels use.
- **Blink** — took its bearing from the stick and always travelled exactly its
  maximum range, drawing nothing. Now aimed by ray with a landing marker: hold
  the stick to aim, point to choose the distance, release to go. Marker colour
  carries validity.
- **Action wheel** — accepted the left ray only, while its *touch* path already
  accepted both. Now either hand on both paths.

Confirm in the headset: each surface responds to **both** hands, the ray is
visible before it hits anything, and blink lands where the marker sat.

### Open — other

- A full-size 2D UI persists after any interaction or cutscene, and shows combat entered after pausing
- Pause (B) has no indication beyond the freeze, and makes some room objects vanish
- Security skill and tunneler fail on containers that should accept them
- Doors with no Security option show Bash but not Use
- Active quest list renders blank
- Inventory slots show no icon for equipped items
- The lift offers its option after the cutscene, but selecting it does nothing
- Boxes sometimes lose their texture when used
- Opening **Screens** from the wheel appears to do nothing
- ~~Combat actions on the radial were a mistake and need a different route — a
  design conversation, not a fix~~ **Design agreed 2026-08-23**, not yet
  implemented. The route stays the wheel; the flat top-level dump of
  `targetActions`/`selfActions` becomes two filtered submenu wedges, and the
  eight menu wedges collapse into one. See `COMBAT-RADIAL-REDESIGN.md` and
  ROADMAP 4.8. **D1–D3 and D9–D15 below are scoped to the old layout and will be
  rewritten when 4.8 lands — do not spend headset time on them first.**

## Current focus: sections A and B only

21 checks, roughly half an hour. These are the items automation fundamentally
cannot reach — comfort is felt, not measured, and tracking loss cannot be
emulated honestly — and they gate the most design decisions, so they are worth
doing before more is built on top. The rest keeps for a later pass.

## Before you start

1. Bring up the VR runtime **first**: Virtual Desktop Streamer with VDXR
   selected as the OpenXR runtime. SteamVR need not run. Disable Synchronous
   Spacewarp and select 72 Hz — the configuration the sustained-50 gate was
   measured under.
2. Then one command, which starts the asset service and opens a browser with a
   fresh profile and DevTools already open:
   ```bash
   npm run vr:play
   ```
   The fresh profile is not cosmetic. A Chromium process caches "no XR device"
   from startup, so a window opened in an already-running browser reports
   `immersive-vr: false` forever and looks exactly like a broken runtime — that
   confound produced two wrong readings during Phase 0.
3. Accept the EULA, load a save, then press **Enter VR (spike)**.
4. Leave DevTools open. The console is the evidence several open roadmap items
   are still waiting on.

Record for each item: pass/fail, and if it fails, what it looked like. One
change per run where you can; confounding two fixes wastes a playthrough.

`npm run vr:check` runs the automated half of this against an emulated device —
session lifecycle, input routing, recenter maths, locomotion, texture
resolution. It is worth running before a headset session so you are not
spending device time on something already broken in logic.

## What this list cannot tell you

Nothing here is settled by the emulator, and nothing the emulator settles is
device evidence. IWER renders through the ordinary page WebGL context, so
frametimes measured there are not headset frametimes.

---

## A. Comfort and locomotion — highest risk

Comfort defects are the ones automation cannot see at all, and a bad one is
physically unpleasant rather than merely wrong.

| # | What to do | What "pass" looks like |
|---|---|---|
| A1 | Walk around `101PER` on the stick for two minutes | No nausea, no unexpected acceleration, no drift |
| A2 | Switch smooth vs blink in **Comfort Settings** (no longer on a button) | Mode changes; blink teleport lands where aimed. The offhand stick click is **walk/run**, not movement mode — the old wording here was wrong |
| A3 | Smooth turn, then snap turn (Comfort Settings → turnMode) | Snap turn pivots about **your head**, not the avatar's feet |
| A4 | Set snap turn to each of its degree steps | Each step matches its label |
| A5 | Enable the comfort vignette and move | Vignette closes on motion, opens at rest |
| A6 | **Recenter — hold the dominant thumbstick in for ~0.7s** | Fires once on the hold; your physical forward becomes the game's forward, head ends up over the avatar, **no vertical jump**. (The Meta button can't be used — the OS reserves it and WebXR never sees it) |
| A7 | Recenter repeatedly, including while turned by snap turn | Idempotent — no creeping drift, and deliberate turning is preserved |
| A8 | Recenter while looking straight up | Ignored rather than throwing you sideways. **Failed in session 2** — the guard only caught an exactly-vertical pose; now a real ~75° pitch limit |
| A9 | Walk into a wall physically (roomscale), not on the stick | Soft push-back, no fade, no hard stop, no falling through |
| A10 | Stand, then crouch, then stand | Eye height stays canonical; no sinking into the floor |
| A11 | Play seated | Everything above still reachable |
| A12 | **Turn hard with the dominant stick for a minute, clicking it accidentally** | No recenter. The ~0.7s hold exists specifically to stop this — a stray click must never be long enough to qualify. If one gets through, the hold needs lengthening |
| A13 | Toggle **walk/run** — click the offhand thumbstick | Movement speed visibly changes between the engine's walkrate and runrate. Confirmed working in session 2 |
| A14 | **Pause** — dominant B | Engine pauses and unpauses; VR view stays stable while paused |
| A15 | **Cycle party leader** — offhand Y | Control passes to the next party member; the wheel's Party submenu still picks a specific one |

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
| D9 | Wheel → **Screens** submenu | Opens; lists Equipment, Abilities, Journal, Messages, Options |
| D10 | Screens → **Equipment** | Opens and gear can actually be swapped — this had no VR route at all before |
| D11 | Screens → **Abilities** | Opens; powers and feats listed |
| D12 | Screens → **Journal** | Opens; quests readable |
| D13 | Screens → **Messages** | Opens; feedback log readable |
| D14 | Screens → **Options** | Opens; distinct from Comfort Settings, which stays on the top level |
| D15 | Look at every wedge icon on the wheel | Real KOTOR icons, **not** generic fallback shapes. All wheel icons were wrong names until this session |
| D16 | Queue some actions, then wheel → **Clear Actions** | Wedge appears only while something is queued or combat is live; clears the queue and drops combat |

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
| E9 | **Activate a prompt from the far edge of its range** (~2.5 m placeable, ~3 m door) | **You do not move.** The avatar acts from where it stands. Previously the engine walked it to 1.5 m and dragged you with it |
| E10 | Activate several things in a row without moving | No accumulated drift; you end where you started |
| E11 | Open a door from the far edge of its range | Same — no approach walk, door still opens |
| E12 | Watch the avatar as you activate | It may turn to face the object. That is expected and should **not** spin your view, since the rig follows the camera rather than the avatar's facing |
| E13 | Exit VR, then click something across the room with the mouse | Desktop click-to-walk still works — suppression must not leak out of the session |

## F. Combat (Phase 3.3–3.7)

| # | What to do | What "pass" looks like |
|---|---|---|
| F1 | Swing a lightsaber at an enemy | Every swing animates and connects visually |
| F2 | Watch the hilt round timer | Only on-tempo swings roll; timer reads clearly |
| F3 | Grab with the left hand **near the hilt** mid-swing | Promotes to two-handed. Then hold the dominant hand still and swing with the **left hand alone** — the blade should still register a swing |
| F9 | Hold the grip with your hands **far apart** | Does *not* promote — that isn't two hands on one hilt |
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
| G6 | Dialogue with a `[Persuade]`-style skill-check reply | The check is an ordinary reply row, not a panel — confirm you can point at it and pick it like any other line |
| G7 | The whole prologue's scripted sequences | **Comfort pass not done** — flag anything unpleasant |

## H. Rendering and performance

| # | What to do | What "pass" looks like |
|---|---|---|
| H1 | Look for white boxes / missing textures | Far fewer than before — a GUI-pack search bug was fixed, taking distinct failures from 20 to 14. The remaining 14 are genuinely absent from the install (several are K1 names), so note *where* any white box appears |
| H6 | Open the **galaxy map** | Its particle textures (`gui_galxy_1..3`, `gui_sun_1`) were among those fixed — this is the most likely resolution of the long-open 1.9 |
| H2 | Watch for menu mirroring artefacts | Never root-caused; a diagnostic is in place — capture the console |
| H3 | Run the perf window in `101PER` | Sustained ≥ 50 FPS, p90 ≤ 33.33 ms, p99 < 50 ms |
| H4 | Play ten minutes without reloading | Memory stable; no climbing load times |
| H5 | Load three modules in succession | No `Array buffer allocation failed` from the Bink decoder |

## I. Known-unfinished — confirm the gap, do not treat as a bug

- **3.3** Now genuine: the grip requires the hands within 0.35 m and the swing is
  measured 0.6 m along the blade. Thresholds may need tuning against real hand
  poses — swing events carry `gripSeparationMetres` for exactly that.
- **4.2** No distinct physical/3D inventory; the flat 2D one reprojects.
- **4.4** Resolved: skill checks are ordinary dialogue reply rows, not a panel,
  and the generic list adapter already covers them. Only G6 confirmation is left.
- **4.5** Audited this session. Every TSL menu extends its K1 counterpart with no
  empty overrides and no TODO markers, so the "TSL menus are frequently stubs"
  worry is retired. The real gap was reachability, now closed — see D9-D14.
  Remaining: the overlay's non-menu controls (action-queue clear, target
  cycling) still have no VR route, and the minigame menus (Pazaak, swoop) are
  unexamined.
- **5.3** No comfort pass over the prologue.
- All three formerly dead actions are now live — see A13-A15. `ToggleWalkRun`
  turned out to have engine walk/run rates behind it all along; `PartyCommand`
  was never actually bound, and now cycles the party leader.

## J. Flatscreen regressions to spot-check

Phase 1 is still open, and the studio-remediation stack touched the texture
loader, material routing, and module transitions heavily.

- J1 Peragus prologue starts as **T3-M4**, one entity, camera and UI agreeing.
- J2 Inventory slots equip, and the equipment persists across save/load.
- J3 Setting a mine completes.
- J4 `p_kreiastunt` renders as a corpse container, not a bind-pose figure.
- J5 No area audio under a movie.
- J6 Textures survive a module transition (the material-cache ownership work).
