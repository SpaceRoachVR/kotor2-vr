# kotor2-vr Roadmap

Phase plan for turning [KotOR.js](https://github.com/KobaltBlu/KotOR.js) into a
room-scale VR mod for KOTOR II. Design rationale lives in [DESIGN.md](DESIGN.md);
engine knowledge lives in `.claude/skills/kotor2-vr/`.

**Status: Phase 0 passed under the user-approved sustained-50 floor. Phase 1 is
still open on its own items, but Phases 2-5 have substantial working
implementation — this entry was stale relative to the code for some time.**
With Virtual Desktop Synchronous Spacewarp disabled and the headset at 72 Hz, a
corrected 60-second raw-WebXR window delivered 51.82 FPS at a 4224 × 2304 XR
target, p90 31.0 ms, p99 46.1 ms, and a PASS verdict. Runtime cadence is still
reported separately and 72 Hz remains a stretch target. The older 31.96-34.96
FPS VDXR evidence remains retained rather than rewritten.

**2026-08-17 reconciliation:** a five-agent audit (see
[VR-AUDIT-AND-COMPLETION-PLAN.md](VR-AUDIT-AND-COMPLETION-PLAN.md)) found
`src/vr/runtime/` and the VR hooks in `GameState.ts`/`VRSpike.ts` already
implemented most of Phases 2-4 ahead of what this file reflected, plus five
concrete playtest bugs (menu mirroring, VR keyboard, cutscene placement, combat
targeting, world-object interaction — all root-caused and fixed except the
menu-mirroring visual, which got a diagnostic instead since static reading
couldn't confirm the cause) and several completeness gaps (wall soft-block,
comfort locomotion options, diegetic hilt timer, blaster laser pointer, the
all-purpose action wheel and its Comfort Settings panel route, cutscene
fade-to-black — all now implemented). Phase
statuses below are updated to match. **None of this session's VR work has been
verified in a headset** — the automated unit/integration suite and configured
TypeScript project pass,
but every phase exit below still needs the same device-evidence bar the rest
of this roadmap holds itself to before being called done.

**2026-08-22 integration and emulated-headset harness.** The
`codex/studio-remediation` stack (22 commits: QA controls, gameplay activation,
XR runtime lifecycle, material/texture routing, legacy panels, VR keyboard,
theater captions) fast-forwarded onto `spike/stereo-perf` with no divergence.
Verified before and after: `tsc --noEmit -p tsconfig.kotorjs.json` clean, 79
suites / 653 tests green, and `webpack:dev` compiles all five bundles.

`tools/vr-emulator/` now boots the browser build against an **emulated Quest 3**,
so VR behaviour can be exercised without a headset. The Immersive Web Emulator
Chrome extension cannot serve this: its control surface is a DevTools panel,
which cannot be driven programmatically, and until that panel is selected the
extension never injects — `navigator.xr` stays native and the engine sees no
device. The extension is a GUI over Meta's IWER runtime, so the harness injects
that runtime (`iwer`) itself over CDP, before page scripts, since `VRSpike`
builds its Enter VR button once at startup from a single `isSessionSupported`
probe. `installRuntime` needs `{ forceInstall: true }` because Chrome exposes a
native `XRSystem` even with no headset and no OpenXR runtime.

Confirmed end to end: EULA, engine boot, `immersive-vr` supported, Enter VR
enabled, session entry with two `meta-quest-touch-plus` sources (7 buttons,
4 axes, grip, haptics), 90 XR frames delivered, clean exit. `in-game.js` goes
further — loads a save, opens `InGameOverlay` to reach INGAME mode, enters VR,
and drives recenter, the action wheel, and stick locomotion against a live
module.

Two traps worth knowing when reading its evidence. Engine mode follows the
current menu, so a scripted load that clears menus without reopening
`InGameOverlay` leaves the engine in GUI mode with gameplay input suppressed —
locomotion and recenter then silently do nothing and the run looks flaky rather
than broken. And the harness must never `JSON.stringify` a logged argument:
stringify invokes `toJSON()`, THREE's `Texture.toJSON` warns on any texture it
cannot encode, and the engine logs texture-bearing objects constantly — that
alone produced ~30k warnings in one run, 98% of all console output, inside the
loop being measured. The console capture walks plain containers by hand instead.

**What the emulator does and does not settle.** It can exercise session
lifecycle, frame ownership, input routing, the action wheel, world prompts,
panels, and locomotion maths. It cannot speak to comfort, compositor cadence, or
reprojection: IWER renders through the ordinary page WebGL context, so
frametimes measured there are not headset frametimes. Every ☐ headset-accepted
item below still needs the headset.

Two defects it surfaced on its first run, both of which would occur on a real
headset too, now fixed and re-verified:

- The "one-shot" startup trace never terminated — `completeStartupTrace` is only
  reached on the fully-successful update path, but entering VR from the main
  menu leaves the engine in MOVIE/LEGAL mode, whose early return precedes it.
  Two console lines per frame for the whole session, measured at 603 lines per
  5 seconds; now 3.
- Entering VR always warned that controller topology was missing all nine
  required semantic actions, because entry validates once before the runtime
  delivers its first `inputsourceschange` (observed `topologyKey: "[]"`).

Tasks are sized for a single working session. Each states what "done" means, so a
cold session can pick one up without re-deriving context. Check off in place.

The master list of what still needs a human in a headset is
[HEADSET-TEST-PLAN.md](HEADSET-TEST-PLAN.md).

---

## Phase 0 — De-risk

One question decides whether the rest of this plan is worth writing: **can a
single-threaded JS renderer submit two eyes at rate on the target rig?** The GPU is
not the concern — an RTX 3060 has ample fill. The concern is draw-call submission on
the main thread, which stereo doubles.

Nothing in Phases 2+ should start before this answers.

### 0.0 — Make the browser build load game assets reliably ✅ functional gate passed
**New, and ahead of 0.1.** Electron cannot do WebXR — `immersive-vr` is
unavailable there and no flag changes it, the XR device service never spawns, and
it is upstream and long-standing ([electron/electron#35011](https://github.com/electron/electron/issues/35011)).
Chrome and Edge both work on this machine. So every phase from 2 on runs in a
browser, and "run it in Electron, never the browser" holds for engine work only.

That reopens exactly what Electron was chosen to avoid: the File System Access
API is slow here and throws `NotReadableError` on large reads. `src/server/` is
IPC plumbing, not an asset server, so there is nothing to fall back on.

**The approach is already de-risked.** `tools/asset-http/range-server-probe.js`
serves the game directory over local HTTP with Range support, measured in Chrome:

| Read | Result |
|---|---|
| `dialog.tlk` full 10 MB — the file that fails under File System Access | **60 ms, OK** |
| `dialog.tlk` Range 0–4095 | 4 ms, 206 |
| `data/models.bif` Range mid-file (866 MB file) | **5 ms**, 206 |
| `chitin.key` full | 5 ms |

60 ms against the 39 ms the same file takes from the shell. The slowness and the
`NotReadableError` are properties of the File System Access API, not of browsers.

This lines up well with the code: `GameFileSystem` is a single chokepoint that
already branches ELECTRON/BROWSER on every method, and its core read is
`read(handle, output, offset, length)` — random access, which maps directly onto
HTTP Range. So this is a third backend behind an existing abstraction, not an
engine change.

- **Accepted evidence (2026-08-11):** a fresh installed-Chrome profile authenticated
  through `/launch`, initialized the TSL profile from the real KOTOR II install,
  rendered `101PER`, wrote a complete save under the isolated user-data mount,
  loaded that save back into `101PER`, and transitioned to `102PER`.
- **Implementation:** `GameFileSystem` delegates HTTP work to a typed backend;
  the loopback-only service exposes ranged, read-only retail assets plus a
  separate writable `%LOCALAPPDATA%\Kotor2VR` mount. The service uses an
  HttpOnly per-launch cookie, strict origin/path checks, and typed directory
  listings. Root webpack bundles are authenticated and served with `no-store`.
- **Observed timing:** the diagnostic `101PER` load took about 82 seconds and the
  save reload/`102PER` transition about 62 seconds each. These are baselines,
  not performance passes; matched Electron timing has not been recorded.
- **Known follow-up:** the transition-time selectable-player exception is fixed;
  the final Chrome save-load and `101PER` → `102PER` run recorded zero console
  errors. TSL opcode 815 (`GetRandomDestination`) is now implemented as a bounded
  sampler over the creature's connected room walkmesh. A fresh installed-Chrome
  transition to `102PER` exercised it 50 times for `g_assassindrd01`: every result
  was finite and within the requested six-metre range, all 50 selected a new
  destination, and no missing-action warning was emitted.
- **Why it gates 0.1:** if assets cannot be read reliably in a browser, a stereo
  frametime number tells us nothing.

### 0.1 — Stereo perf spike on `101PER` ✅ measured; sustained-50 runtime gate passed
Enable WebXR on the THREE renderer, load Peragus `101PER`, and measure.
- **Harness:** `spike/stereo-perf` branch. `src/vr/VRSpike.ts` and
  `src/vr/PerfSampler.ts`; run procedure and results table in
  [PHASE0-STEREO-SPIKE.md](PHASE0-STEREO-SPIKE.md). Electron does not expose
  immersive WebXR; this measurement runs in Chrome/Edge through VDXR.
- **Already learned:** `EffectComposer` blits to the default framebuffer, not the
  XR one, so all post-processing must be re-plumbed for XR. Budget for it in Phase 2.
- **First device run (2026-08-11):** Quest 3/VDXR/Chrome on the RTX 3060 entered
  immersive WebXR and tracked the headset, but the headset compositor became
  unresponsive. A settled 15-second stereo-rest window at the runtime's 90 Hz
  delivered p90 16.5 ms, p99 27.5 ms, and 19.8% of frames over the 13.89 ms
  72 Hz budget. This is a measured failure, not a pass.
- **Bounded remediation:** startup was eagerly copying all 1,823 TSLRCM Override
  files (7.66 GiB) into the JS heap. Override now builds a path-only index and
  lazily caches requested resources. Fresh Chrome evidence fell from 7.86 GiB
  pre-menu heap to 118 MB at the menu and 889 MB in `101PER`; only 52 Override
  resources were resident, and `.vis` left 13 of 66 rooms visible. Automated
  tests and a fresh browser render pass; headset rest/walking and ten-minute
  memory measurements remain required.
- **Remediated device result:** the black/unresponsive failure is gone. The user
  described the 90 Hz VDXR image as looking "amazing" and walked 85.55 metres
  through four `101PER` rooms during a 182-sample traced window. The trace ended
  at p90 16.6 ms, p99 16.8 ms, and 800 MB heap. That is a strong perceptual and
  functional success, but p90 remains above the written 13.89 ms floor.
- **Corrected cadence result:** the duplicate desktop/XR animation sources and
  one queued browser callback were fixed. Clean headset reports are trustworthy
  but deliver only 31.96-34.62 FPS, with p90 31.4-32.7 ms. CPU p90 is 0.3 ms for
  simulation and 4.1-4.8 ms for renderer submission.
- **Bounded optimization:** 0.7 XR framebuffer scale plus maximum foveation
  produced 33.01 FPS and p90 32.0 ms, no material improvement, so it was reverted.
- **Decision report:** [PHASE0-ENGINE-PIVOT-REPORT.md](PHASE0-ENGINE-PIVOT-REPORT.md)
  compares THREE restructuring, worker/offscreen, alternate WebXR engines, and
  native OpenXR, and defines the recommended isolated renderer benchmark.
- **Renderer isolation (2026-08-11):** raw WebXR reached 34.96 FPS, THREE r149
  34.70 FPS, and THREE r185 34.72 FPS at an identical 4224 × 2304 XR target.
  GPU p90 was 0.06-0.09 ms. The THREE upgrade path is rejected as the current
  remedy; VDXR half-rate/spacewarp and Edge/SteamVR comparisons are next.
- **Accepted continuation result (2026-08-11):** after Synchronous Spacewarp was
  disabled and 72 Hz selected, the final corrected raw-WebXR window delivered
  51.82 FPS for 60 seconds, p90 31.0 ms, p99 46.1 ms, and GPU p90 0.05 ms. The
  user revised the hard floor to sustained 50 FPS and directed Phase 1 to begin.
- **Next after 0.0.** WebXR itself works on this rig now (VDXR runtime, Chrome and
  Edge both report `immersive-vr: true`), but not in Electron — see 0.0.
- **Done when:** frametimes are captured in stereo on the 3060 over Virtual
  Desktop, the isolated runtime path sustains at least 50 FPS for 60 seconds,
  and the written decision records runtime cadence separately.
- **Also record:** draw calls per frame, triangles, and renderer memory at load and
  after ten minutes.
- **Files:** renderer setup in `GameState.ts`, a throwaway spike branch is fine.
- **Note:** this is a measurement, not the VR layer. Do not build the rig here.
- **Cadence audit harness:** XR timestamps now independently reconcile XR
  callbacks, browser callbacks, engine updates, and XR renders. Reports also
  contain missed-frame estimates, visible/total rooms, and a 500 ms sampled
  player path. Stock WebXR does not expose compositor reprojection telemetry;
  native delivery must be corroborated with runtime evidence.
- **Locked continuation gate:** sustained 50 FPS minimum on Quest 3/VDXR/RTX
  3060, p90 at most 33.33 ms, p99 below 50 ms, trustworthy one-update/one-render
  ownership for delivered XR frames, active room culling, and stable memory.
  Runtime refresh and missed runtime frames remain diagnostic evidence rather
  than blockers. The complete VR stack must rerun this floor before release.

### 0.2 — Confirm `.vis` room culling applies in stereo
`ModuleArea.updateRoomVisibility()` drives room culling. If it is not applied per-eye
per-frame, stereo submits the whole level twice and 0.1's numbers are meaningless.
- **Done when:** verified culling is active in stereo, with before/after draw counts.
- **Files:** `src/module/ModuleArea.ts`.

### 0.3 — Characterise the memory growth
The renderer has been observed at ~8.9 GB with load times climbing 41s → 47s → 65s
across successive loads, and the Bink decoder has already failed with
`Array buffer allocation failed` during `permov01`. This corrupts content today and
will drop frames in a headset.
- **Done when:** the dominant retainer is identified from a heap snapshot across two
  or three module loads, and either fixed or written up with a specific hypothesis.
- **Suspects:** textures not disposed on `UnloadModule`, per-module listeners, the
  Bink worker.

**Phase 0 exit:** a written go / no-go on stereo feasibility, which now also
requires the browser build to be viable at all (0.0). If no-go, revisit the
engine choice before spending further effort.

---

## Phase 1 — Flatscreen Peragus completable

Get the prologue and Peragus playable start to finish in 2D. VR bugs and engine bugs
are indistinguishable on an unstable base, so this comes first.

Ordered by whether it blocks progression.

### 1.1 — Mine parameter resolution ☐ blocked on user log
`ActionSetMine` parameter 0 is set from a `ModuleItem` but resolves via
`GetObjectById` to something without a `properties` array. A guard and a diagnostic
are already in place; the next mine attempt names the culprit.
- **Done when:** setting a mine completes and the object resolves to the real item.
- **Files:** `src/actions/ActionSetMine.ts`, `src/actions/Action.ts`,
  `src/managers/ModuleObjectManager.ts`.
- **Watch for:** id `0` being mapped to `OBJECT_INVALID`, and inventory items not
  being registered in `ObjectList`.

### 1.2 — Missing textures / white boxes ☐ blocked on user log
White boxes appear in fixed world locations and on inventory and ability icons. The
shared `TextureLoader` path explains both. A once-per-name warning is in place.
- **Done when:** the failing texture names are known and either loaded correctly or
  explained (genuinely absent vs. a TPC/TXI parsing gap).
- **Files:** `src/loaders/TextureLoader.ts`, `src/loaders/TPCLoader.ts`.

### 1.3 — Player is an appearance-less human instead of T3-M4
`ModuleArea.loadPlayer()` finds `PartyManager.Player` unset and invents a placeholder
from `getPlayerTemplate()`, while the prologue spawns T3 separately by script. Two
entities result: a phantom human the camera follows, and the real T3 the UI reports on.
- **Done when:** the prologue player is T3-M4, one entity, camera and UI agree.
- **Files:** `src/module/ModuleArea.ts` (~line 1600), `src/managers/PartyManager.ts`,
  the `DoSpecialSpawnInT3M4` path.

### 1.3b — `Invalid Item Property Sub Type: undefined` on save load ☐ new evidence
The emulator run supplied the log that 1.2/1.4 were waiting on: loading a
Peragus save emits `Invalid Item Property Sub Type: undefined` **36 times**
(`src/engine/ItemProperty.ts:65`). `this.subType` is `undefined`, so
`subTypeDef.rows[undefined]` misses — the 2DA resolves fine, the template's
subtype field does not.

Two latent faults sit in the same constructor and are worth fixing alongside it,
since both turn a data gap into a harder failure:
- the `row` miss is logged and then used anyway — `SWSubTypeBase.From2DA(row)`
  runs on `undefined` rather than bailing out;
- the cost-table `else` branch dereferences `this.costTableLookupDefinition.name`
  on the path where that value is falsy and `costTable <= -1`, which throws
  instead of reporting.

- **Possible relation to 1.4:** item properties failing to resolve is a
  plausible cause of equipment behaving oddly. Worth checking before treating
  1.4 as independent GUI logic.
- **Files:** `src/engine/ItemProperty.ts`.

### 1.4 — Inventory slots do not equip
Clicking an equipment slot does not equip. Unknown whether this shares a cause with
1.2 or is independent GUI logic.
- **Done when:** items equip and persist across a save/load.
- **Files:** `src/game/tsl/menu/` equip menu, `src/managers/InventoryManager.ts`.
- **First check:** diff the TSL menu against `src/game/kotor/` — TSL menus are
  frequently stubs where K1 is complete.

### 1.5 — Movie audio bleed
`PlayMovie` sets MOVIE mode, then module init finishes and `RestoreEnginePlayMode`
clobbers it back to INGAME while the video is still playing, so area music and ambience
resume underneath the cutscene and continue into the tutorial.
- **Done when:** no world audio during a movie; audio resumes cleanly after.
- **Files:** `src/managers/VideoManager.ts`, `src/GameState.ts` engine-mode handling.
- **Design point:** decide who owns engine mode during a movie. The startup queue
  already mutes channels explicitly; the in-game path has no equivalent.

### 1.6 — `p_kreiastunt` missing walkmesh
Kreia's stunt-body placeable fails `loadWalkmesh` and renders in bind pose.
- **Done when:** the corpse container loads and reads as intended.
- **Files:** `src/module/ModulePlaceable.ts`.

### 1.7 — Re-verify content gated by the transit fix
`SetDisableTransit` (opcode 860) now gates the lift that let the player skip ahead.
Empty containers and untriggered combat training may have been downstream of arriving
before setup scripts ran — or of the wedged action queue.
- **Done when:** a clean run from a new save confirms each, or files a fresh bug.

### 1.8 — T3-M4 spawn skips `getCurrentRoom()`
The lazy room resolve in `ModuleCreature.update()` is a mitigation, not a fix. Find
the spawn path that omits it.
- **Done when:** the spawn sets the room directly and the mitigation can be removed.

### 1.9 — Galaxy map display ☐ needs a description of the symptom
The `invalid guitag null` ×4 warning is `planetary.2da` padding and not the fault.
- **Blocked on:** what "didn't display correctly" actually looked like.

### 1.10 — Full Peragus playthrough
- **Done when:** a fresh save reaches the end of the Peragus arc with no progression
  blockers, and remaining issues are cosmetic and logged.

**Phase 1 exit:** Peragus completable in flatscreen. This is the baseline every VR
change is measured against.

---

## Phase 2 — VR foundation

First light in the headset. No interaction yet.

- **2.1** ✅ WebXR session lifecycle — enter/exit VR, session loss, resume.
  `VRSpike.enter/exit/onSessionEnd/onVisibilityChange`.
- **2.2** ✅ Camera rig replacing the follower camera, with fixed canonical eye height.
  `VRSpike.syncRig`, `eyeHeight = 1.75`.
- **2.3** ✅ Roomscale tracking with the rig coupled to the walkmesh (`local-floor`
  reference space; the rig anchors to the tracked-selectable player position each frame).
- **2.4** ✅ Soft-block on wall intrusion — push the rig back, no fade, no hard stop.
  `src/vr/runtime/VRWallSoftBlock.ts`, wired into `syncRig`.
- **2.5** ✅ Smooth locomotion + smooth turn as default; teleport, snap turn, vignette as
  options. `VRSnapTurnController`, `VRTeleportController`, `VRComfortVignetteHost`,
  `GameState.getComfortSettings`/`setComfortSettings`.
- **2.6** ✅ implemented / ☐ headset-accepted — Comfort settings have an in-headset
  route. The smooth/blink
  locomotion toggle was already reachable (`ToggleLocomotionMode`); `turnMode`,
  `snapTurnDegrees`, and `vignetteEnabled` are now reachable through a "Comfort
  Settings" item on the all-purpose `X` action wheel (4.1), opening
  `VRComfortSettingsHost` — a
  four-row cycle panel (point at a row, press Select to cycle its value).

**Exit:** walk around `101PER` in VR, roomscale, without falling through geometry or
leaving walkable space. **Not yet verified on-device** — implemented and
unit/integration-tested only.

---

## Phase 3 — VR interaction

- **3.1** ✅ Controller input mapping for Quest 3 controllers (`XRInputRouter`,
  `quest-touch` profile).
- **3.2** ✅ Hand presence and grab (`XRControllerAnchorHost`).
- **3.3** ☐ partial — One- and two-handed lightsaber; left-hand grab promotes to
  two-handed. Real mode-flag promotion exists (`VRCombatInputController`), but it's a
  mode flag on a single-hand swing detector, not physically dual-wielded tracking —
  the left hand's own pose doesn't contribute to the swing.
- **3.4** ✅ Swing detection feeding the d20 round — governor option (c): every swing
  animates and connects visually, only on-tempo swings roll. Fixed this session: combat
  targeting no longer reads stale flatscreen-mouse state, Cancel no longer gets skipped
  once a target stops qualifying, and blaster fire now has the same roll-cooldown gate
  melee already had.
- **3.5** ✅ Diegetic round timer in the lightsaber hilt. `VRHiltTimerHost`, reading
  `VRCombatInputController.getRollReadiness()`.
- **3.6** ✅ Blasters: laser pointer (`VRBlasterLaserHost`), stat-rolled (routes through
  the same d20 combat path as melee), and automatic deflection (`CombatRound.tryBlasterDeflection`
  + `combat/resolveBlasterDeflection.ts`, verified against the KOTOR 2 wiki's Jedi
  Defense feat pages and the engine's own NWScriptDef comments for opcodes 469/470/252 —
  applies to flatscreen combat generally, not just VR).
- **3.7** ✅ Force gesture set — push/pull flicks (`VRForceGestureController`). Fixed
  this session: also no longer reads stale flatscreen-mouse target state.
- **3.8** ✅ implemented / ☐ headset-accepted — One dynamic, paginated all-purpose
  action wheel replaces the fixed four-way contextual radial. Hold left `X` to
  capture a head-relative placement that remains world-fixed; the left ray hovers
  and left-trigger confirms, while either controller may directly touch a wedge.
  Up to six available actions appear per page with dedicated navigation and a
  nested Party wheel. Unavailable/malformed actions are omitted and every action
  is revalidated before it delegates to the existing d20/action-menu/menu/party
  route. Opening the wheel leaves simulation, locomotion, and turning active but
  owns conflicting combat, world-use, and UI activation until it clears itself
  before dispatch. `VRRadialMenuController`, `VRRadialMenuHost`,
  `VRActionWheelModelBuilder`, and `VRSpike` own the separated state, rendering,
  model, and lifecycle boundaries.
- **3.9** ✅ implemented / ☐ headset-accepted — Proactive world-action prompts replace
  the post-activation contextual panel for doors, containers/placeables, mines,
  and ordinary consoles. Eligible objects expose only available authored
  Security/tunneler/Bash/Mine/Disarm/Recover routes or a safe direct action;
  either controller ray/trigger can activate once, and loss of range, line of
  sight, visibility, front-cone eligibility, object, or actions clears the prompt
  immediately. Locked/key-required/plot/story-owned direct use fails closed. The
  exact Ebon Hawk Galaxy Map console exception delegates to its existing world
  `Use` route; it is never added to the all-purpose wheel.

**Exit:** a Peragus combat encounter completable in VR with the d20 layer intact.
**Not yet verified on-device** — implemented and unit/integration-tested only.

---

## Phase 4 — VR UI

Every button reachable in flatscreen needs a VR route.

- **4.1** ✅ implemented / ☐ headset-accepted — The former wrist/contextual pair and
  obsolete `Wrist` semantic route are replaced by the single left-`X` action wheel.
  Its dynamic static-menu routes include Inventory, Character, local Map, Comfort
  Settings, and conditional Level-Up-to-Character; full-screen menus retain their
  existing pause/foreground ownership after the wheel closes. Tracking/session
  loss, module transition, dialogue/cutscene entry, and foreground takeover clear
  wheel/prompt state, rays, hover, press/touch latches, and ownership without
  activation. Already-issued optional haptic pulses are best-effort and are not
  cancellable through the current WebXR haptic port.
- **4.2** ☐ Physical inventory. The existing flatscreen 2D inventory reprojects into
  world space generically (see 4.3) but there is no distinct physical/3D inventory.
- **4.3** ✅ implemented / ☐ headset-accepted — Summonable floating panels: character
  sheet, galaxy map (and inventory).
  The wheel opens `MenuInventory`, `MenuCharacter`, and local `MenuMap`, plus
  `VRComfortSettingsHost`; conditional Level-Up also opens `MenuCharacter` and its
  working Auto Level-Up route rather than the empty `MenuLevelUp` shell. Galaxy Map
  remains a context-dependent static popup reached only through the Ebon Hawk console's
  proactive world prompt and existing `Use` route; no radial route opens
  `MenuGalaxyMap`. The existing generic `VRPanelHost` +
  `LegacyGUIVRPointerAdapter` reprojection handles legacy panels — no new rendering
  infrastructure needed.
- **4.4** ✅ resolved by inspection / ☐ headset-accepted — **Dialogue skill checks
  need nothing bespoke.** The premise behind the question was wrong: KOTOR has no
  skill-check panel. A check is authored in the DLG as a conditional script that
  gates whether a reply node appears, with the `[Persuade]`-style marker baked
  into the reply string. So a skill check is an ordinary row in `InGameDialog`'s
  `LB_REPLIES` list box, not a distinct screen.

  That reduces 4.4 to "can VR pick a row in a `GUIListBox`", which
  `GUIListBoxVRPointerTargets` already answers generically — it takes any list
  implementing the structural contract, not a named menu, and yields row and
  scroll-arrow targets at the ray position. No new rendering or routing work.

  What remains is confirmation that a reply is actually selectable in a live
  dialogue, which is a device/emulator test rather than a code question.
- **4.5** ✅ audited / ☐ headset-accepted — **Reachability audit (2026-08-22).**

  *The TSL-stub worry is retired.* All 63 K1 menus have TSL counterparts, every
  one of them `extends` its K1 class, and none contains an empty override or a
  TODO marker. TSL files are smaller because they override only what differs,
  not because they are stubs.

  *The real gap was reachability.* `InGameOverlay` offers eight screens —
  Messages, Journal, Map, Options, Character, Abilities, Inventory, Equipment —
  and the wheel routed **three**. Equipment, Abilities, Journal, Messages, and
  Options had no VR route at all; Equipment is where gear is swapped, so that
  was a functional hole, not a convenience one. All five now open through a
  nested `Screens` submenu, keeping Inventory/Character/Map a single press.

  *Every wheel icon was also a wrong resref.* `inv_bag01`, `iattackr`, `imap`,
  `iopts`, `iparty`, `ilevelup` — none exist. Verified against the retail
  `swpc_tex_gui.erf` key list: TSL names these `lbl_icn_<screen>2`
  (`lbl_icn_inv2`, `lbl_icn_equ2`, `lbl_icn_que2`, `lbl_icn_prty2`, …) plus
  `lbl_levelup`. Every wedge was logging a load failure and drawing the generic
  fallback. Fixed, and VR-only entries (Comfort Settings, the Screens submenu)
  now omit the icon so they take the fallback deliberately and silently.

  *Non-menu controls, resolved.* `BTN_CLEARALL` now has a VR route — a
  conditional `Clear Actions` wedge that appears only when the queue is
  non-empty or combat is live, and performs the same three steps the button
  does (`clearAllActions`, drop `combatState`, `cancelCombat`).

  Its sibling `BTN_TARGETUP`/`BTN_TARGETDOWN` controls are deliberately **not**
  ported. They do not cycle targets — they cycle *which action a target panel
  shows*, one at a time, because the flat panel has room for one. The wheel
  already enumerates every action from every panel at once, so porting them
  would add a control that steps through a list the player can already see in
  full.

  *Still open:* the minigame menus (Pazaak, swoop) are unexamined.
- **4.6** ✅ implemented / ☐ headset-accepted — **Recenter** (2026-08-22). Was the
  one "bound but dead" action deferred specifically because a bad recenter is a
  real comfort hazard and there was no way to verify it without a device; the
  emulated-headset harness closed that gap. Routed with locomotion, edge-triggered
  so holding the button does not pin the head to the origin.

  The first attempt was wrong in a way the tests caught: it aimed the head at the
  rig's *current* forward, but rotating the rig turns the head with it, so that
  target is unreachable. The reachable one is the game's natural forward — the
  rig's bearing with the recenter offset removed (`facing + 90° + turnYaw`), which
  preserves deliberate in-game turning and cancels only the physical offset.
  Because `rigFacing` already carries the previous offset the correction is a
  direct assignment rather than an accumulation, so repeat presses are idempotent
  and cannot drift; position is set the same way, horizontal only, leaving the
  canonical eye height alone. A pose with no horizontal forward (looking straight
  up) is ignored rather than recentred on a degenerate reading.
  `src/tests/vr-recenter.test.ts` asserts the invariants — not the feel.

  **Now a long press** (~700 ms), matching how recentring works on the Meta
  platform. The system's own recenter is a long press of the Meta button, but
  that button is reserved by the OS for the universal menu and is never
  delivered to WebXR — the right controller exposes only trigger, squeeze,
  thumbstick, A, B, and thumbrest — so the gesture lives on the dominant
  thumbstick click. The hold is not only convention: that stick is also Turn, so
  a press-triggered recenter would fire on any stray click mid-turn.
  `VRRecenterHoldGate` owns the timing.

  **Verified under the emulator (2026-08-22):** with the emulated head yawed
  0.9 rad off-axis in a loaded `101PER` save, pressing the dominant thumbstick
  moved `yawOffset` from `0` to `-0.9000000060058315` — an exact cancellation of
  the physical yaw, reproduced identically across two runs. Locomotion in the
  same runs moved the avatar 7.85 m, the action wheel opened and loaded its real
  `lbl_icn_*` icons (texture *resize* notices, no load failures), and the whole
  session's console came to 397 lines with the startup trace at 8 — one frame. Comfort still needs the headset; see A6-A8 and A12 in the test
  plan. **A12 matters:** Recenter shares the dominant thumbstick with Turn, and
  implementing it made a previously inert stray click able to cause a comfort
  event.
- **4.7** ✅ implemented / ☐ headset-accepted — **The last dead actions**
  (2026-08-22). Two of the standing claims about them were wrong.

  *`ToggleWalkRun` had something to toggle all along.* `ModuleCreature` already
  reads walkrate and runrate from `creaturespeed.2da` and already picks between
  them in `getMovementSpeed()` via `isWalking()`. What "always applies full
  force" described was `CreatureLocomotionAdapter` pinning `force = 1` — which
  is acceleration, not speed, and a separate axis. VR simply had no route to the
  `walk` flag. It now toggles on the offhand thumbstick click, the binding that
  was already declared.

  *`PartyCommand` was not bound at all*, despite being listed as bound. Quest
  puts Menu on left X, so left Y was free and it now lives there; it stays
  unbound on profiles whose Menu already occupies offhand 5, since a collision
  would be worse than the action staying unreachable.

  Its meaning is a judgement call: it cycles the party leader rather than
  opening the party wheel. The wheel is a state machine keyed on the Menu button
  being held, with no imperative open-this-submenu entry point, so forcing one
  open would mean surgery on the ownership boundaries 3.8 deliberately
  separated. Cycling reuses the same `SwitchLeaderAtIndex` route the wheel's
  Party submenu already calls, and the wheel stays the way to pick a *specific*
  member.

  `Pause` toggles the engine's own pause on the dominant B button.

---

## Phase 5 — Cutscenes and dialogue

- **5.1** ✅ Theater-screen reprojection for movies (`VRSpike.renderMovie`/
  `renderCutscene`, wired through `GameState.UpdateMovie`/`getMovieContext`/
  `getCutsceneContext`). Fixed several bugs found by playtest this session: the rig
  fallback that could bury the view underground during an animated camera, the rig
  snapping the headset straight into a scripted shot with no smoothing, and an
  authored `NodeUnskippable` line having no way out (added a VR-native unconditional
  abort mirroring flatscreen's `DialogAbort`). A movie-trigger stuck-guard and a
  VR-entry-during-movie freeze report got diagnostics rather than guessed fixes —
  static reading found the code more sound than initially suspected and couldn't
  confirm a root cause without device logs.
- **5.2** ✅ Dialogue keeps engine camera cuts, with fade-to-black between them.
  `VRCutsceneFadeHost`/`VRCutsceneFadeEnvelope`, triggered when the authored per-shot
  camera reference changes between frames.
- **5.3** ☐ Comfort pass over the prologue's scripted sequences specifically. Not done.

---

## Phase 6 — Peragus VR slice

First shippable artifact.

- **6.1** Hand-fix geometry across the ~12 distinct Peragus geometry passes.
- **6.2** Full VR playthrough of the arc.
- **6.3** Perf pass against the 3060 / Virtual Desktop floor.
- **6.4** Install instructions and a release build.

**Exit:** someone else can play Peragus in VR.

---

## Phase 7 — Full campaign

- **7.1** TSLRCM integration and compatibility.
- **7.2** Per-area geometry passes for the rest of the game.
- **7.3** Remaining TSL-only opcodes — ~81 with no K1 counterpart. Influence trio
  795–797 is the most valuable cluster and needs a storage design decision first.
- **7.4** Full playthrough.

M4-78 is out of scope.

---

## Phase 8 — Release

- **8.1** Quest 3 native port evaluation.
- **8.2** Upstream: decide what, if anything, goes back to KotOR.js as engine fixes
  independent of VR.
- **8.3** Public release, docs, issue triage.

---

## Working agreements

- Commit locally on a topic branch. No upstream PR without being asked.
- Type-check before every commit: `npx tsc --noEmit -p tsconfig.kotorjs.json`.
- Never run `npm run dev` — it black-screens Electron. See the skill's workflow file.
- One change per test run. The user tests each change individually and confounding two
  fixes wastes a playthrough.
- When a symptom is ambiguous, add a diagnostic that names the object and run again.
  Do not theorize from a log.
