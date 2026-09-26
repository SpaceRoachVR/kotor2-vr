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

**2026-09-09 full audit inside a presenting VR session.** All 82 campaign
modules swept with `npm run vr:sweep -- --vr` - the first sweep run through the
VR frame path rather than flatscreen - then every major root cause fixed and the
sweep repeated. Clean modules 39 -> 70 of 82, findings 74 -> 23, majors 66 -> 15,
zero blocked and zero critical in either pass. Full write-up in
[AUDIT-2026-09-09-VR.md](AUDIT-2026-09-09-VR.md).

Two results are worth carrying forward. **The VR frame path introduced no defect
class of its own** - all 82 records carry `presenting: true`, and every finding
also occurs in flatscreen, with the pre-fix totals inside the flatscreen noise
band. And the two largest root causes were both silent: every merchant in the
game failed to load its blueprint (a GIT store names it `ResRef`, not
`TemplateResRef`), and lip-sync absence - ordinary retail data - was the single
largest console-error signature, burying the reports that meant something.

Still emulator evidence, not device evidence: comfort, cadence and reprojection
remain outside what any of this can see.

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

**2026-08-22 first headset session.** The first real device run of the VR stack.
It ended early when the game glitched badly, but the console was captured and it
named four distinct root causes — three fixed, one needing a design decision.
Partial pass/fail marks live in the tester's own copy of the plan.

- **Player invisible in the med bay, fine in flatscreen.** `MenuPartySelection`
  called `this.char.LoadModel()`; `ModuleCreature` defines only `loadModel`.
  The sole such call site in the codebase, throwing on every party-selection
  portrait build as an uncaught rejection, which leaves the character with no
  model. Fixed, with a test rejecting any `.LoadModel(` call site.
- **2D UI stays up after any interaction.** TSL menus call
  `super.menuControlInitializer(true)`; the `true` makes the K1 parent return
  before registering any listeners, and the subclass re-registers only some.
  `MenuJournal.BTN_EXIT` was declared and never wired, so the journal could not
  be closed from its own Exit button — with a mouse as much as a VR ray. Fixed,
  along with `MenuContainer.BTN_GIVEITEMS`. See 4.5 for the other 41.
- **Opening Map or Abilities from the wheel threw.** `MenuMap.show` touched
  `BTN_PRTYSLCT`, which TSL's map GUI does not contain, and `GUIFeatItem`
  dereferenced a padding hole in `feats.2da`. Both built fine and threw on use,
  so only opening them catches it — `vr:check` now does, and reports all eight
  wheel-reachable menus opening cleanly after the fix (18/18, page exceptions
  zero).
- **Interacting drags the avatar.** Fixed — see 3.10.

**Observed performance:** 32-36 FPS in stereo through the busier Ebon Hawk
rooms, p50 ~31 ms, p90 ~32 ms, 74-100% of frames over 20 ms, 250-720 draw calls,
heap 670-860 MB. Lighter windows reached 52-54 FPS. That is below the sustained-50
gate for much of the run and is the first real evidence for H3 since Phase 0.

**2026-08-22 second headset session.** Got further into the Ebon Hawk but could
not finish the scenario. Nineteen issues reported; four fixed and confirmed
under `npm run vr:check` (22/22) before being called fixed, per the standing
instruction that anything emulator-testable is proven there first.

- **Approach suppression was only applied to 2 of 13 actions.** Last session's
  entry claimed 3.10 fixed; it was not. `ActionUnlockObject` — Security, the
  most-used action of the session — still walked the player, as did mines,
  attacks, dialogue and lock/close-door. All eleven player-initiated actions now
  consult the policy, and the policy is **actor-scoped**: as written it was
  global and would have stopped party members and NPCs walking too.
- **Recenter's vertical guard never fired.** It relied on the facing conversion
  throwing, which only happens for an exactly-vertical forward vector. Replaced
  with a ~75° pitch limit.
- **Level Up was never wired in either game.** Not a TSL drop — K1 only calls
  `.hide()` on `BTN_LEVELUP`, and `MenuLevelUp` is a 48-line shell with zero
  handlers in both games. Routed to the working auto-level-up path; manual
  point-spend remains unimplemented.
- **Movement mode unbound** from the offhand trigger, where it collided with
  radial-wheel Select. Comfort Settings only.

**The ray-pointer theme is resolved in code** (headset confirmation pending).
Four separate reports shared one cause: every ray-driven surface hard-coded which
controller it listened to, and nothing on screen said which. `VRPointerHandResolver`
now picks the pointing hand by hit rather than by role, with the holding hand
keeping ownership while both hands hit so a ray on a wedge seam cannot strobe.
The Comfort panel draws the shared ray and cursor, and blink is aimed by ray with
a landing marker instead of travelling a fixed distance along the stick bearing.

**One design call is open, not a bug fix:** a locked bashable door offers Bash but
no plain Use, so the player cannot simply try it the way flatscreen allows. The
lock gate in `classifySafeDirectVRWorldUse` is a deliberate guard against VR
stealing ownership from locks, keys and authored actions, so loosening it is
Allen's call. Recorded as a `KNOWN GAP` test asserting current behaviour, beside
a sibling pinning the unlocked case that works.

**Tooling note:** `tsc -p tsconfig.kotorjs.json` does not cover `src/actions`.
It reported clean while esbuild rejected nine files a scripted edit had
malformed. Jest and webpack are the real gates for that tree.

Tasks are sized for a single working session. Each states what "done" means, so a
cold session can pick one up without re-deriving context. Check off in place.

The master list of what still needs a human in a headset is
[HEADSET-TEST-PLAN.md](HEADSET-TEST-PLAN.md).

**2026-09-01 → 2026-09-14 — numbered headset verification rounds (1–10).**
The two dated sessions above were one-shot: play until it breaks, read the
console after. Starting 2026-09-01 this became a repeatable loop instead — a
persistent checklist artifact Allen fills in the headset (pass/fail/note per
item), read back with `read_db`, against `npm run vr:play` with a live CDP
console tailer and in-page state queries
([[kotor2-vr-live-headset-debugging]] / [[kotor2-vr-headset-verification-rounds]]
in project memory). Each round removes what passed and carries failures
forward with their notes, so the list shrinks; ten rounds have run so far,
2026-09-01 through this morning.

**Confirmed working in the headset, not just the emulator, across rounds 1–9:**

- **Ray-pointer routing.** Every ray-driven surface (Comfort Settings, Blink,
  the action wheel) now resolves the pointing hand by which hand actually hits
  the surface, not a hard-coded role. Confirmed both hands work, the ray
  shows before it hits, and Blink lands where its marker sits.
- **Security lock "did nothing".** Not a lock-gate or action-parameter bug —
  each trigger press was re-triggering a fresh 1.5 s action ahead of the
  last, so holding/mashing the trigger looked like the lock never engaged.
- **Feat icons unselectable in chargen.** The icon's hit box was computed in
  world space while its row used the list's offset space, 162 units off from
  its own row.
- **Droid vs. human checks.** `racialtypes.2da` is 5 = Droid, 6 = Human, but
  TSL's equipment-icon gate and the VR hand-presentation code both read
  `getRace() == 6` as if it meant droid. Fixed in both places — T3-M4 now
  gets equipment icons and no floating hands.
- **Held weapons "invisible".** Weapon clones for two-handed grips were
  scaled 0.01 instead of 1.0 (Odyssey models are metres) — not a visibility
  or attachment bug.
- **Cutscene theater rendering.** "All movies show space with stars, audio is
  correct" survived five plausible source-level theories before pixel-reading
  the render target directly showed a healthy, animating image — the actual
  fault was geometry (gaze/panel angle), not the render path.
- **Lift / exterior "boundaries wrong, shaking".** A head-offset rig bug that
  only appears when the simulated play space is off-origin; hidden if the
  headset emulation sits at the play-space centre. Fixed.
- **"Door does nothing" on repeated tries.** Any thumbstick movement during
  the 1.5 s open action silently cancelled it (`clearAllActions`); holding
  still resolved it.
- **A session-long slowdown ending in a crash.** A leftover `console.log` in
  an NWScript action produced millions of lines (DevTools retains every
  logged object), so it was a memory leak, not just a frame-time cost.
- **"Black screen until I press a button."** An exception thrown every frame
  inside the XR frame callback was being swallowed after its first report,
  so nothing redrew. Now reported per distinct signature instead of once.
- **"Extra NPCs spawning in every area."** Not spawning — retail's own
  `DoSpecialSpawnIn` logs a party member's `OnSpawn`; expected behaviour
  misread as a bug.
- **Grenades / spell targeting.** `k_sup_grenade` "does nothing" was four
  stacked bugs found by wrapping the live NWScript action table on the page
  (wrong spell id, impact script never copied, target location dropped to
  `(0,0,0)`, and a stale-room exception in the test lab masking the real fix).
  Throw and damage now confirmed working.
- **Sustained performance floor (Phase 0 gate).** With Virtual Desktop
  Synchronous Spacewarp off and the headset at 72 Hz: 51.82 FPS raw WebXR,
  p90 31.0 ms, p99 46.1 ms — a PASS against the user-approved sustained-50
  floor. Still the only comfort/cadence-adjacent number with real device
  evidence; reprojection and comfort itself remain unmeasured.

**This morning's round (10), verified in the emulator, headset confirmation
pending as of this write-up:**

- **The plasma torch vs. the Damaged Door.** The torch was landing every
  time; the door is authored at 15 HP but was starting at 45 (three times
  its max), and its hardness-100 script gate — meant to require a
  door-cutting tool — was never enforced by the engine. Both fixed; the
  emulator now cuts it open in three hits.
- **Enemy combat math, several bugs at once.** Attack/defense tables were
  read one level too high for every creature including the player; a
  critical threat auto-confirmed as a hit with no second roll; the Mining
  Laser's −1 penalty was never applied; item/creature damage dice all rolled
  d8 regardless of what their table said; saves missed on a tie. All now
  match the values the in-game Combat log itself reports (cross-checked
  against [[kotor2-tsl-rules-reference]]).
- **Enemy level scaling.** TSL marks most enemies with an autobalance set
  that the engine never read; it does now, so enemies scale with the party
  leader's level on new-area entry (won't visibly change anything at
  level 1 on Peragus, but matters later).
- **Door sound effects were silent** because the archive lookup for
  `sounds.bif` entries was case-sensitive and the table asked for
  `dr_PER01` while the archive holds `dr_per01`.

**Confirmed still broken as of round 9/10, not yet fixed:**

- No grenade model shows in the off-hand while one is armed (the throw and
  damage themselves work).
- No autosave, and no way back to the main menu after a party wipe — Load
  Game still works as a route back in.
- Some Peragus NPCs (the Maintenance Officer, Atton) request textures by a
  base resref the installed packs only ship as numbered variants
  (`pmbamc01` etc.), so they may show untextured patches.
- No health readout is drawn in the headset view.
- Grenades leave from the character's hand rather than the controller.
- Security Tunnelers work even untrained — confirmed as intentional, not a
  defect.
- The sustained-50 floor is not yet re-confirmed in the busier Ebon
  Hawk/Peragus rooms since the first headset session's 32–36 FPS reading;
  still the largest open performance risk (H3).

Everything above is still **emulator or single-round device evidence, not a
closed phase exit** — Phase 1's own exit criterion (Peragus completable in
flatscreen) and the Phase 0 stereo floor under real play (not a fixed
90-second window) remain open. See [[kotor2-vr-headset-verification-rounds]]
for the full per-round detail this summary compresses.

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

### 0.3 — Characterise the memory growth ◑ characterised and reproducible; the retaining edge is still open (2026-09-09)

Measured with `tools/vr-emulator/probe-memory-growth.js`, which loads the same
two modules in a cycle and reads every candidate retainer after a forced
`HeapProfiler.collectGarbage` — so what it reports is retained, not merely
uncollected.

**The cost of revisiting one module, reproduced across four runs:**

| | per load |
|---|---|
| retained geometries | +304 (101PER), +293 (102PER) |
| retained textures | +46 to +80 |
| JS heap | +50 to +68 MB |

Those numbers repeat to the object between runs, so this is deterministic, not
drift. It matches what the sweep sees from the outside: the heap crosses 3 GB
in roughly 20-25 module loads and every full sweep today reloaded the page
three or four times, all heap-triggered rather than the module-count backstop.
A headset session has no reload.

**What it is not.** The engine caches are bounded — `TextureLoader.textures`
plateaus at 208 and the ResourceLoader scopes oscillate flat. The scene graph
is torn down correctly: node counts hold to within ±2 across a revisit, and the
Points count is identical (88 for 101PER, 231 for 102PER, unchanged). Shader
programs do not grow.

**What it is.** Whole `OdysseyModel3D` instances are retained after their owner
is destroyed. Counted live over three samples spanning two loads: 211 -> 265 ->
325 instances, of which **137 -> 259 -> 319 have no parent**. That is roughly 90
orphaned models per module load, and at three to four geometries each it
accounts for the ~300 geometries. `ModuleObject.destroy()` does call
`model.dispose()` and then sets `this.model = undefined`, so the owner has let
go — something else still holds each model.

**Retainer paths, from a real snapshot (2026-09-09).**
`tools/vr-emulator/probe-heap-retainers.js` tags every parentless model in the
page, takes a heap snapshot and walks it. The snapshot is 2.3 GB — past both
`JSON.parse` and Node's maximum string length — so `heapsnapshot-stream.js`
scans the members rather than loading the file.

Against a session six module loads in: 36.7M nodes, 98.5M edges, 194 orphaned
models tagged. **All 194 are retained from outside the orphan set; none are
collectable.** Their immediate retainers:

| edges | holder and field |
|---:|---|
| 1144 | `Object --textureOwnerModel-->` (a material back at its model) |
| 985 | `Object --odysseyModel-->` |
| 289 | `OdysseyLight3D --odysseyModel-->` |
| 194 | `OdysseyModelAnimationManager --model-->` (exactly one per orphan) |
| 83 | `native_bind --bound_this-->` |
| 12 | `ModuleTrigger --trapModel-->` |

These are back-references, and V8 collects cycles, so the immediate holder is not
the answer on its own — what matters is which holder is reachable from a GC root.
Climbing the graph found one real path, at depth 10:

```
GameState -> lightManager -> LightManager.fadingLights -> OdysseyLight3D
          -> odysseyModel -> ORPHANED MODEL
```

`clearLights()` resets every other light collection and missed that one, so it is
now cleared there too. **It is not the dominant retainer**: measured before and
after, +304/+293 either way.

Note for anyone re-running this: a snapshot taken over CDP always shows a
"DevTools console" global handle onto whatever the probe just inspected. That
root is the tool's own footprint, and the climb skips it — counting it reports
the measurement as the defect.

**Causal cuts (2026-09-09).** A retainer histogram cannot rank its own entries:
these objects point at each other, and V8 collects cycles, so an immediate
retainer is not evidence. `probe-retainer-experiment.js` tests it the other way
round — break an edge class in the live page, force a GC, count the parentless
models again. Run against a static heap (`probe-memory-growth.js --hold`, so no
module load moves the count between readings), 334 orphaned models, cuts applied
cumulatively in one session:

| cut | edges cleared | models freed |
|---|---:|---:|
| *(control)* | 0 | 0 |
| `odysseyModel` on lights, via LightManager | 233 across 291 lights | **0** |
| `userData.textureOwnerModel` | 158 | **0** |
| `animationManager.model` | 668 | **0** |
| *(control, after all three)* | 0 | **0** |

**1,059 edges cut and not one model freed.** Two things follow, and the second is
the more useful.

First: the path the heap snapshot reported — `GameState -> lightManager ->
fadingLights -> OdysseyLight3D -> odysseyModel` — is **not load-bearing**. Cutting
that exact edge on every light in every LightManager collection frees nothing,
which agrees with the earlier result that clearing `fadingLights` on unload left
growth at +304/+293 unchanged.

Second, and the reason to stop reaching for these two tools: **both of them
answer a question that is not quite the one being asked.** A backward BFS finds
*a* path to a root, but an object retained by several independent paths is not
freed by cutting one — so "found a path" does not mean "found the retainer", and
"cutting it changed nothing" does not mean the edge is innocent. The cut
experiment has the mirror flaw: it reaches edges by traversing each model, so it
systematically under-reaches any holder that is not a descendant — which is
exactly how the first `odysseyModel` attempt cleared zero edges and looked like a
clean elimination.

**The technique this actually needs is a dominator tree.** Computing dominators
over the snapshot answers "what keeps this alive" directly and correctly in the
presence of multiple paths, which is precisely where the BFS fails. That is a
standard algorithm over the node/edge arrays `heapsnapshot-stream.js` already
exposes, and it is where the next attempt should start rather than adding another
path heuristic.

**Practical note on the instrument.** Snapshots of this page run to 2.3 GB and
stall the renderer's main thread for minutes while V8 builds them. One capture in
three succeeded; another hung at zero bytes for thirteen minutes and had to be
killed. Never capture against a running sweep — the stall trips the sweep's 425 s
module ceiling, the sweep declares the module BLOCKED and reloads the page out
from under the capture. Use `probe-memory-growth.js --hold`, which parks an idle
page with nothing to time out.

**Fixed along the way, but not the cause.** Every creature builds a
`TextSprite3D` debug label in `load()` and nothing ever disposed it, for an
overlay that is off by default. Now disposed in `ModuleCreature.destroy()`.
Measured before and after: +304/+293 both times, unchanged — a real undisposed
resource, and not this leak. Recorded so it is not re-investigated as one.

Two further defects found by reading, neither measured as dominant:
`OdysseyModel3D.dispose()` guards its geometry release behind
`instanceof THREE.Mesh` while also matching `Points`, and `THREE.Points` extends
Object3D — so emitter geometry is never released. And `loadModel()` disposes the
outgoing model inside a silent `catch`, so a partial failure leaks the remainder
and reports nothing.

#### Original statement
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

### 1.1 — Mine parameter resolution ✅ resolves correctly; a silent-failure path closed (2026-08-25)

**The log arrived, and it clears the resolution.** A full playthrough plants a
mine end to end — step 31 opens the Engine Room Door with a recovered mine and
reports `opened: true`, mines `2 -> 1`, door `dead: true` — and the standing
diagnostic (`parameter 0 did not resolve to a ModuleItem`) fires **zero** times
across the whole run. Parameter 0 does resolve to the real `ModuleItem`, with
its `properties` array intact. The acceptance criterion is met.

**A real hole was found next to it and closed.** Two things can come back from
the id: the wrong object, or nothing. The wrong object was guarded — no
`properties` array, reported and failed. Nothing at all was not:
`if(this.oItem && !this.usedItem)` skipped the block entirely and fell through
to `return ActionStatus.COMPLETE`, so the action claimed success having added
no trap, queued no `OnTrapTriggered` event and consumed no charge, with nothing
logged anywhere. An unresolved item now fails and says so.

### 1.2 — Missing textures / white boxes ✅ named and explained (2026-08-22)
No longer blocked: `tools/vr-emulator/phase1-diagnostics.js` harvests
`TextureLoader.getDiagnostics()` from a real save. A Peragus load produces
**3,673 resolutions, 86 missing across 20 distinct resrefs**, and cross-checking
those names against the retail texture packs and the TSLRCM Override splits them
in two — which is exactly the "genuinely absent vs. parsing gap" this item asked
for.

**Reframed 2026-08-25 — these are requests retail never makes.** The retail
install is complete and renders correctly, textures included. Re-verified the
14 names against the whole install — `chitin.key`/BIFs, all four
`TexturePacks/*.erf`, and Override's 1,823 loose files: 13 are absent outright
and the 14th, `pmhc04`, exists only as an MDL/MDX **model**, not a texture.

Both facts hold together, and the conclusion is sharper than "decide whether
any need a substitute": if the shipped game draws these screens correctly
without these files, then every one of them is a name **this engine asks for
and the real game does not**. So each is an engine bug to trace back to its
requester, not an asset gap to paper over with a substitute. Treat a
missing-resource report as a lead, not as a limit of the data.

(Checked one candidate mechanism and cleared it: 30 K1 menus set
`background = '1600x1200back'`, but every TSL subclass overrides `background`,
so TSL menus do not inherit it. The requester is elsewhere.)

**Genuinely absent (14).** `pmhc04`, `po_no`, `bluefill`, `yellowfill`,
`po_pcarth`, `invent1/2`, `boxline3/4`, `confirm1/2`, `lbl_wupitems`,
`1600x1200back`, `uparrow`. In neither the packs nor Override. Several are K1
asset names — `po_pcarth` is Carth's portrait — so these are references the
engine makes to things TSL does not ship. Not a loader fault. Whether they
matter visually is a headset/flat observation, not a log question.

**A real loader bug (6), now fixed.** `innermenu`, `loadscreen3`,
`gui_galxy_1..3` and `gui_sun_1` all exist in `swpc_tex_gui.erf` and still
resolved as `missing-required-texture`: the GUI pack was searched only for the
`gui` and `font` semantics, and these arrive as `diffuse` and `particle`. TSL
genuinely ships non-GUI assets in that pack. The pack is now searched for every
semantic, with gui/font still preferring it and other semantics treating it as a
late fallback after `texture-pack`.

**Verified against the real install:** re-harvesting after the fix moved missing
resolutions from **86 to 78** and distinct failing resrefs from **20 to 14** —
all six formerly-unfound textures now resolve, and the remaining 14 are exactly
the genuinely-absent set.

- **Files:** `src/loaders/TextureResolution.ts`.
- **Still open:** confirm on screen that no white boxes remain, and decide
  whether any of the 14 absent names need a substitute.

### 1.11 — Console 404s that are probes, not faults ✅ explained (2026-08-22)
The harvest surfaced three read failures that are **not** bugs, recorded here so
the next reader does not chase them:
- `modules/001EBO.mod` — the install ships `001EBO.rim`, `001EBO_s.rim` and
  `001EBO_dlg.erf`; vanilla TSL has no `.mod` for this module. The engine probes
  `.mod` first and falls back to `.rim`, and the module demonstrably loads.
- `Saves/000001 - Game0/pifo.ifo` — an optional save sidecar.
- `swkotor2.ini` — absent; the engine falls back. Long-standing.

They are logged at error level despite being expected, which is why they read as
faults. Demoting these specific probes to a debug-level message would make the
console meaningfully easier to trust; not done, since it touches the shared
`GameFileSystem` error path.

### 1.3 — Player is an appearance-less human instead of T3-M4 ✅ not reproducible (2026-08-25)
The acceptance criterion is met in the current build. Every state dump across
the Ebon Hawk prologue reports `playerName: "T3-M4"`, `partySize: 1`,
`hasPlayer: true` — one entity, camera and UI agreeing, through consoles, the
footlocker bash, the security slice and the module transition.

`loadPlayer`'s placeholder branch is only taken when `PartyManager.Player` is
not already a `ModuleCreature`, which in the prologue it is, so the phantom is
never built. Both branches resolve the room explicitly.

### 1.3b — `Invalid Item Property Sub Type: undefined` on save load ✅ fixed (2026-08-25)

**Cause: the save writer used labels the loader cannot read.** `save()` emitted
`SubType` and `Usable`; `initProperties()` — and the retail blueprints — use
`Subtype` and `Useable`. An item loaded from a module was therefore fine and
the same item loaded from a save came back with `subType` undefined, which is
why the error only ever appeared after a load. `useable` was lost the same way
and never announced itself at all.

Confirmed against real data rather than inferred: `SAVEGAME.sav` contains
`SubType` seven times and `Subtype` not once, and dumping the `PropertiesList`
field labels out of `101PER`'s own `.uti` resources gives the retail spelling.

The writer now uses the retail labels; the reader accepts the old misspellings
as a fallback so the 581 saves already on disk — including the playthrough
checkpoints — keep loading. Both latent faults below are fixed too. The
regression test asserts the general property (every label `save()` writes is one
`initProperties()` reads) rather than the two instances found.

**This did not turn out to be related to 1.4** — see below.

<details><summary>Original report</summary>
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
</details>

### 1.4 — Inventory slots do not equip ◑ original symptom not reproducible; a different defect found and fixed (2026-08-25)

**The original symptom could not be reproduced, and the equip path checks out.**
The playthrough's slot survey reports all 11 TSL slot buttons `wired: true`,
each with the `None` row that the unequip branch needs, and `worn` correctly
reading "Mining Laser" and "Droid Shock Arm" off T3-M4. `updateSelected`
assigns `selectedItem` (fixed under 1.10), and `BTN_EQUIP` branches correctly.
The report predates several fixes and appears to have been overtaken by them.

**`offered: []` in that survey is not evidence of a fault.** It is correct: the
list is built by `InventoryManager.getInventory(slot, creature)`, whose
`isItemUsableBy` filter was checked against the retail 2DAs and is right —
`baseitems.2da` `droidorhuman` is 2 for droid-only and 1 for human-only, and
`racialtypes.2da` is 5=Droid, 6=Human, which is exactly the mapping the code
applies. T3's shared inventory genuinely held nothing droid-equippable at that
point (empty, then a Computer Spike).

**Not related to 1.3b.** Item properties were indeed failing to resolve, but
the equip filter reads `baseItem`, not item properties, so the two never met.

**A real defect was found instead, and fixed: the screen resolved two different
characters at once.** TSL's equipment screen switches party member with
BTN_NEXTNPC and overrode `updateSlotIcons`, `updateCharacterStats` and
`isSlotLocked` to follow `currentNPCIndex` — but `updateList` delegates to the
K1 base and `updateListHover` is not overridden at all, and both read
`party[0]`. Selecting a companion offered party[0]'s equippable items and
party[0]'s worn row, then equipped the choice onto the companion. Both classes
now resolve the character through one overridable accessor.

Latent for the whole prologue, where the party is one character. Live as soon
as Kreia and Atton join, which is the next slice.

- **Still open:** the original "clicking a slot does not equip" is unverified
  either way on a party of one with an equippable item to hand. The playthrough
  step is deliberately read-only — acting there polluted every later checkpoint
  — so confirming it needs either a unit test over the menu or a throwaway run.
- **Files:** `src/game/kotor/menu/MenuEquipment.ts`,
  `src/game/tsl/menu/MenuEquipment.ts`, `src/managers/InventoryManager.ts`.

### 1.5 — Movie audio bleed ✅ fixed in `84403a6a`, recorded here 2026-08-25
`PlayMovie` set MOVIE mode, then module init finishing called
`RestoreEnginePlayMode` back to INGAME while the video was still playing, so
area music and ambience resumed underneath the cutscene and bled into the
tutorial.

Fixed by giving movie mode an explicit owner: `MovieModeOwnership` lets
`playMovieQueue` claim MOVIE up front and restore the prior mode only when the
whole queue completes, rather than each individual movie doing it. Covered by
`src/tests/movie-mode-ownership.test.ts`.

**The design point is answered.** World audio is silenced by the video object
itself, not by engine mode — `BIKObject.play`/`playFromBuffer` mute every
channel and unmute MOVIE, and `stop()` reverses it. Nothing keys audio off
`EngineMode.MOVIE` at all.

**Watch item, not a demonstrated defect.** That mute is owned per BIK object,
not per queue — exactly the shape the engine-mode bug above had. At end of
video `stop()` unmutes every channel, and the next movie re-mutes only when its
`play()` runs. The gap is a few synchronous calls plus microtasks, so it is
sub-frame and almost certainly inaudible; it is recorded because the structure
invites the bug back, not because bleed was observed. If world audio is ever
heard between two queued movies, this is the place.

### 1.6 — `p_kreiastunt` missing walkmesh ◑ the walkmesh half is not a defect; the bind pose is still open (2026-08-25)

**The missing walkmesh is an absent asset, not an engine fault, and it is a
whole class rather than one model.** `p_kreiastunt` ships an `MDL` and an `MDX`
in `models.bif` and no `PWK` — in neither the BIFs nor Override. Checked across
the install: **all 34 `p_*` models have no PWK**, while the install ships 304
PWKs for ordinary placeables. The `p_*` set is character-appearance stunt
bodies used as placeables — Atton, Bastila, Carth, Kreia and so on — and a
character model legitimately has no placeable walkmesh.

So `loadWalkmesh` failing here is expected for every stunt body in the game.
Logging it at error level is noise of exactly the kind 1.11 catalogues, and the
placeable itself loads: the prologue survey lists
`Body{Kreia Placeable}` (tag `kreia_corpse`) among the nearest placeables.

- **Still open:** the *bind pose*. That is a separate question from the
  walkmesh — a stunt body rendering unposed means no animation is being
  applied, not that a walkmesh is missing — and it needs an on-screen
  observation to characterise. Do not chase the walkmesh error for it.
- **Files:** `src/module/ModulePlaceable.ts`.

### 1.7 — Re-verify content gated by the transit fix ✅ neither symptom reproduces (2026-08-25)
`SetDisableTransit` (opcode 860) gates the lift that let the player skip ahead.
Both symptoms suspected of being downstream of arriving before setup scripts
ran were re-checked on a clean run from a new save, and neither reproduces.

- **Empty containers — gone.** Every container the run opens has contents:
  three opened, all `wasEmpty: false`, all looted successfully.
- **Untriggered combat — gone.** The Peragus combat step enumerates four
  hostiles (`Damaged Mining Droid` ×3 plus `Damaged Mining Droid{Loot}`), so the
  encounter is spawned and flagged hostile. What fails is *reaching* them, which
  is 1.10's navigation stall, not content setup. The distinction matters: the
  creatures exist and are hostile; the actor cannot cross the room to them.
- The transit gate itself works — the run takes the authored Utility Lift both
  ways and the authored Galaxy Map route to Peragus.

Run: `tools/vr-emulator/evidence/phase1-reverify.stdout.log`, 76 steps, one
blocker (the 1.10 stall).

### 1.8 — T3-M4 spawn skips `getCurrentRoom()` ✅ premise stale; mitigation deliberately retained (2026-08-25)

**No spawn path omits the room resolve.** Every one of them was checked and
each resolves it explicitly: `ModuleArea.loadPlayer` in both branches,
`ModuleArea.loadCreatures`, `loadDoors`, `loadPlaceables`, and all three party
paths in `PartyManager`. T3-M4 in particular spawns through `loadPlayer` —
which calls `getCurrentRoom()` directly — not through a script `CreateObject`,
which is still `action: undefined` and therefore cannot be the path.

**The mitigation stays, on purpose.** `ModuleCreature.update()`'s `if(!this.room)`
guard costs one null check per frame and still covers a real hole:
`loadCreatures` resolves the room only *after* `await creature.loadModel()`,
with the whole body inside a `try`. A model that fails to load is caught and
logged, and that creature reaches the world with no room. Removing the guard
would turn an asset failure into a creature with no floor that rejects every
step. Revisit only if that ordering is fixed first.

### 1.9 — Galaxy map display ☐ retest after the 1.2 fix
The `invalid guitag null` ×4 warning is `planetary.2da` padding and not the fault.

**Likely cause found via 1.2.** The galaxy map's own particle textures —
`gui_galxy_1`, `gui_galxy_2`, `gui_galxy_3` and `gui_sun_1` — were among the six
that exist in `swpc_tex_gui.erf` but never resolved, because the GUI pack was
not searched for the `particle` semantic. That is a concrete mechanism for "the
galaxy map didn't display correctly" without needing the symptom described
first. Retest before chasing anything else here.
- **Blocked on:** what "didn't display correctly" actually looked like.

### 1.10 — Full Peragus playthrough ◑ medical-bay slice complete in VR (2026-08-24)

- **Done when:** a fresh save reaches the end of the Peragus arc with no progression
  blockers, and remaining issues are cosmetic and logged.

`node tools/vr-emulator/playthrough.js` now runs from a new game to the end of the
Peragus medical bay under the emulated headset, in a live immersive session, with
no scripted shortcuts: character creation, the T3-M4 Ebon Hawk prologue in full
(consoles, footlocker bash, security slice, garage, both Low Security Doors, the
exterior lift, disarming one mine and recovering the other, all five Parts caches,
mining the Engine Room Door, rigging the hyperdrive, Galaxy Map travel), then
Peragus — waking at the kolto tank, the medical bay door, looting, the medical
console and its morgue unlock, combat and kills, clearing the mining droids,
levelling, and an equipment change. It ends at the authored boundary below.

Six engine defects were in the way, each of which stopped the prologue outright:

1. **A mine could not be planted on a Plot door.** Mine placement was gated on
   `canBashObject`, which refuses anything Plot-flagged. `001EBO`'s Engine Room
   Door is Plot=1, NotBlastable=0 and is the only route to the hyperdrive.
   `canPlaceMineOnObject` is now its own rule.
2. **`NotBlastable` was never written back to a save**, so every door returned
   from a save blastable — which then offered "Mine" on Peragus's Blast Doors.
3. **A creature could not cross a walkmesh seam.** `101PER`'s kolto pad is a
   2.2m island 0.03m off the medbay floor, and every perimeter edge of an island
   reads as a wall, so the Exile was sealed on the pad it wakes on. Seams are now
   distinguished from walls, height-aware so a ledge stays solid.
4. **Nothing could be unequipped**, three defects deep: `updateSelected` never
   assigned the "None" row, `unequipSlot` threw on droids before clearing the
   slot, and nothing returned the item to inventory.
5. **The pathfinder handed back straight lines it had already rejected** — the
   origin's graph anchor was discarded, and closed doors did not block
   line of sight.

**The authored boundary, read out of the data rather than assumed.** The old
`module-102` target was wrong. `Emergency Hatch{102PER}` ships Locked=1,
KeyRequired=0, OpenLockDC=100, and `emrhatch.dlg` says "The explosions in the
mining tunnels below have sealed the emergency hatch. There is no way to open
it." The continuation is the 103PER turbolift, which is KeyRequired and opens
through the rest of `101PER` — Kreia, the detention block, Atton, the fuel
depot. That is the next slice, not a defect in this one.

**Exactly how far a single continuous run gets.** `node tools/vr-emulator/playthrough.js`
from a new game completes **50 of 53 steps**: the whole Ebon Hawk prologue
across both passes, and Peragus through the Morgue Door. The last three —
first kill, the droid sweep with levelling, and the boundary check — pass from
the `morgue-door` checkpoint (verified in four separate runs: 8/8 droids for
1125xp, level 1 -> 2 through the VR wheel Menu route) but not yet from the
position the continuous run leaves the Exile in.

**Known weakness carried forward:** long-range routing in `101PER`. Four
separate causes were found and fixed — the discarded origin anchor, the
search rejecting both injected anchors, the shortcut trusting a line-of-sight
test that cannot see most walls, and smoothing collapsing a route onto one
point — and long routes improved substantially at each. What remains is that a
30m+ cross-level approach still fails from some starting positions and
succeeds from others. This is a driver-visible limitation rather than a
player-facing one: a person steers with a thumbstick and does not ask the
engine to plan a 30m route.

**Localised: the actor sticks on walls, and the mechanism is named (2026-08-25).**
Resuming from `morgue-door` with the stall diagnostic active produced 13 stalls
with positions. Measuring each against `101PER`'s own perimeter (wall) edges,
rebuilt in world space from the retail WOKs:

| | median distance to nearest wall |
|---|---|
| ordinary walkable ground (829 face centroids) | **1.15m** |
| stall positions | **0.43m** |

Only 19.8% of walkable ground lies as close to a wall as the stall median, yet
10 of 10 stalls do, and 8 of 10 sit below the 25th percentile. Stalls are not
position-independent: the actor stops when pressed against geometry. Two further
signals agree — `queued: 0` at almost every stall, so no competing action is
fighting locomotion, and stalls arrive in pairs about 2cm apart, so the
`returnToGameplay` nudge does not clear it.

**The mechanism is `CollisionManager.applyCollideAndSlide`.** It works on
`object.forceVector`, and before projecting it against the edge normals it
applies a choke-point rule: where two edges have opposing normals
(`n1.dot(n2) < -0.3`) and the movement points into both, it does
`forceVector.set(0, 0, 0)` and returns — a full stop with no slide. VR
locomotion aims straight at the next waypoint and keeps aiming there, so in a
tight spot the vector points into both edges every frame and the actor is
pinned. This is also why it surfaced now: the adapter only began writing
`forceVector` in `9219b6ff`; before that the vector was zero and this code had
nothing to act on.

- **Next:** decide whether the choke rule should zero the vector or project it
  onto whichever edge still has a free direction. The rule is deliberate — it
  stops actors squeezing through walls — so this needs care, and a headset
  session would show whether a human steering out of it feels wrong at all.
- **Not player-facing.** A person steers with a thumbstick and slides off the
  wall; the driver cannot, because it re-aims at the same waypoint every sample.

**The measurement was in the log all along, disguised (2026-08-25).** The
driver's `line(text)` did `console.log(text)`, and the only bare `line()` call
in the file was the stall-recovery nudge — fired when a leg has not advanced
0.05m across six consecutive samples. So every stall printed the bare word
`undefined` and read as noise. **The last full run contains 163 of them.**

They cluster exactly on the targets that fail, all in `101PER`: Damaged Mining
Droid 71, Door 43, Damaged Mining Droid{Loot} 13, Emergency Blast Door{105PER}
12, plus Lift Controls 16 in `002EBO`. So the shape is not "the actor walks and
falls short" but "the actor repeatedly stops advancing mid-route, gets nudged,
and stops again until the leg times out". That is consistent with everything
else established here: sound routes, sound walkmesh data, a deterministic
end position.

The stall path now names the position it stopped advancing from, the remaining
distance and the queue depth, so the next run localises this without needing a
bespoke probe. Note also that the nudge fires on `stalledSamples === 6`
exactly, so a leg that never moves is nudged **once** and then spins to
timeout — worth revisiting once the cause is known.

**It is not the routing, and it is not the walkmesh data (2026-08-25).** The
`area.walkEdges` coverage suspicion recorded here previously was tested against
the retail data and does not survive. Two mechanisms were constructed and both
are refuted:

- **Edge/face index mismatch — refuted.** `OdysseyWalkMesh` attaches perimeter
  edges by looking up `edges` at `allFaceIndex * 3 + side`, while the WOK stores
  those keys as `walkableOrdinal * 3 + side`. Those agree only if walkable faces
  precede every non-walkable one. In all 66 of `101PER`'s room walkmeshes they
  do, exactly: zero misattached edges, zero unreachable. Not a vacuous pass —
  1,499 of 2,328 faces (64%) are non-walkable, spread across 63 of the 64 rooms
  that carry edges.
- **Coordinate space — refuted.** All 64 walkmeshes carry a non-zero header
  `position`, but the vertices are already world-space and the engine never
  applies `position` to them; it only writes it back on export.

All 849 perimeter edges are present and correctly attached. The routes are also
sound: `101per.pth` holds 133 points and 270 connections, and the logged routes
are genuine multi-node curves through it, not the two-point straight-line
fallback `traverseToPoint` returns on search failure.

**What the symptom actually is.** The actor walks about 2.7m from its origin —
which is path point 20 exactly — completes the first leg of a 16-point route,
stalls on the second, replans from the same node and repeats. Re-running the
full playthrough with the `forceVector` locomotion fix changed nothing: both
runs complete 76 steps and finish one centimetre apart, and all four hostiles
reproduce the same four shortfalls (20.1m, 22.5m, 36.0m, 39.6m) across three
approaches each, to within ±0.05m. Perfectly deterministic, so not a race or a
timing effect. The remaining suspects are the driver's per-leg arrival
threshold and a genuine engine stall at one walkmesh feature ~2.7m along.
Next probe: resume from `morgue-door`, attempt one approach, and sample player
position through leg 2.

**Found alongside, not yet acted on:**
- `101per.pth` splits into two components, 126 nodes and 7. Seven authored path
  points are unreachable from the rest of the level. Not the cause above — the
  origin and all four hostiles sit in the 126-node component — but a latent trap.
- `OdysseyWalkMesh`'s adjacency parse computes `diff[1]` and `diff[2]` from
  `adj1` instead of `adj2`/`adj3`. `adjacentDiff` does not appear to feed
  pathfinding, so this is recorded rather than fixed.
- The playthrough driver's failure message truncates mid-sentence
  (`"no closed door offered a "`), which makes these logs harder to read.

**Extended through the end of Peragus (2026-09-23 to 2026-09-25).**
`tools/vr-emulator/playthrough-peragus.js` continues the same driver from the
medical bay to the Ebon Hawk's loading ramp, under the emulated headset with no
scripted shortcuts: the administration level (vibroblade, security room,
administration computer, Atton's cell), T3-M4's errand through the hangar and
fuel depot, the emergency hatch and mining tunnels (containment fields, the
turbolift), HK-50, the airlock and the asteroid exterior, the dormitories and
the forced turbolift, the Harbinger (drift charts, crew quarters, Sion, the
engine hatch), the fuel line (T3-M4's rescue, the mines, the Emergency Field
Station and exit ramp), Hangar Control (possessing T3-M4 for the Repair and
Computer Use gates, replacing the conduit), the Decontamination Console and
the gassed tunnel, and the ramp trigger's `ebonhawk.dlg`, which loads `107PER`
- the turret minigame, the authored end of the arc (the minigame itself is
7.6). Every stage is a checkpoint (`--resume <name>`: `vibroblade` ...
`t3-rescued`, `exit-ramp-open`, `hangar-bay`, `hangar-door-open`); the last
run from `hangar-door-open` ends in `107PER` in engine mode MINIGAME.

Engine defects found and fixed on the way, each of which stopped the run:

1. `GetHasSkill` was a stub returning 0, so no skill-gated console reply was
   ever offered.
2. `SwitchPlayerCharacter` snapshotted the incoming member, so switching back
   to the Exile rebuilt her from the character-creation template.
3. Script locks (key-required doors with no key name) were refused by the VR
   use gate; the failure script is the only way through.
4. Room walkmeshes need not meet under a door (102PER: a 1.16 m gap); a
   perimeter edge inside a passable door's box is now a seam.
5. One dropped HTTP asset read stranded a module load; the backend retries.
6. `EffectDamage` wrote its amount into the typed slot and slot 14, so every
   scripted hit landed twice (102PER's steam vents killed a level-3 Exile).
7. `ModuleTrigger` gated OnEnter and OnExit on its one-shot latch, so OnExit
   never ran and every crossed vent kept hurting from anywhere in the module.
8. A scripted `ActionOpenDoor` on a placeable went through the lock check.
9. A movie mid-conversation flipped the engine out of DIALOG and the
   conversation hung on its continue node; deferred replies now resume.
10. `ActionAttack` refused placeable targets, placeables never ran
    OnMeleeAttacked or died, and embodied VR stopped swinging after one hit
    (105PER's turbolift console).
11. `showReplies` judged continue/end on the authored links rather than the
    replies whose conditions pass (hk50.dlg's two-way continue).
12. The first frame after a module load was handed the whole load as its
    delta (~5.6 s) with the pre-transition movement vector still set: one
    10.5 m step through the fuel pipe's wall (`clampFrameDelta`,
    `FrameDeltaRules`).
13. `AddPartyMember` never recorded the member on the roster or its npcId, so
    T3-M4 was lost at the first save or module load after rejoining.
14. Possessing a companion already in the party built a duplicate and
    switching back destroyed him; `SwitchPlayerCharacter` now folds and
    restores companions.
15. Followers never step aside; a party member in a 2.5 m strip pinned the
    leader for good. The controlled leader now walks through their own party.

16. The wheel's Party submenu only reordered the party; conversations always
    make the possessed body the speaker (`MakePlayerLeader`), so a companion
    could not work a skill-gated console from VR. Retail's leader switch is
    possession: the submenu now calls `SwitchPlayerCharacter` and, while a
    companion is in control, offers the Exile by name to switch back
    (`VRPartySwitchRules`). PartyCommand cycles through the same entries. The
    Hangar Control step drives this route. A leader switch also keeps the
    Exile in the world as a follower, as retail does, and switching back
    reinstates that same instance (`SwitchPlayerCharacter(npcId, true)`,
    `ReinstatePlayer`); the scripted switch (a_bet3m4, a_transformt3m4) still
    takes her out, as those scripts expect. `probe-exile-follow.js` shows her
    4.4 m behind T3 after a 10 m walk and back in control afterwards.

**Still open:** INSTANT effects accumulate in `object.effects`;
`ExportPartyMemberTemplates` warns for every empty slot on each save.

**Tooling that made it possible:** `probe-walkmesh-map.js` (1 m ASCII
raster plus a face dump), `walkmesh-plan.js` (height-aware face-graph
planner; hand-picked LYT vias were off the mesh in every module), and
`probe-eval.js <checkpoint> "<expr>"` for one-shot state questions; the
transition trace in `walkIntoTransition` caught defect 12 in the act.

### 1.12 — Breadth-first module sweep ✅ built and first-run verified (2026-08-29)

**The discovery loop was the bottleneck, not the fixing.** Every defect in
Phase 1 was found depth-first, by a 40-70 minute playthrough that must succeed at
step N to reach step N+1. That shape has three costs, and they compound: one
blocker shadows every defect behind it, so nothing past the blocker can be known;
reaching new ground means replaying ground that already passed; and defects arrive
in encounter order, so a fault breaking forty modules is fixed at the same
priority as one breaking a single door, because from inside one playthrough there
is no way to tell them apart.

Measured against the code, the imbalance is stark. Of the files touched by the
last 40 commits, **3 were VR and 61 were engine** — the work has been finishing
KotOR.js, not building a VR mod. And the campaign is **82 modules** (the 164
`.rim` files in `modules/` are 82 base plus 82 `_s` companions; counting files
overstates the game by three times). Two of those 82 have been walked.

`npm run vr:sweep` inverts the loop. It warps into each module in turn, runs a
fixed battery, records everything wrong, and moves on whether or not the module
passed. One run yields a whole-game defect inventory ranked by **how many modules
each root cause breaks**, so fixes go in blast-radius order.

- **Files:** `tools/vr-emulator/module-sweep.js` (driver), `module-probe.js`
  (the in-page battery), `module-list.js` (enumeration), `sweep-report.js`
  (ranking, coverage, ledger emission). 38 unit tests in `module-sweep.test.js`
  plus `src/tests/module-sweep-ledger.test.ts`, which proves emitted records pass
  the real `createDefectRecord` validator rather than a restatement of its rules.
- **Battery per module:** area load and identity, room/creature/door/placeable
  model presence, name resolution, template presence, item-property resolution
  across every inventory and equipment slot, declared-vs-resolved conversations,
  N rendered frames, and a console/page-exception diff attributed to that module.
- **Output:** `evidence/module-sweep.jsonl` (one record per module, written
  incrementally so a crash 60 modules in costs nothing), `-summary.json`
  (ranking + coverage), `-defects.json` (`DefectRecord`s).

**Two things it found about itself on the first run, both now fixed and pinned by
tests.** They are worth recording because both would have produced confident,
entirely wrong data:

- **Readiness was existence, not identity.** `loadingModule === false && module.area`
  is already true *before* a load starts, because the outgoing module is still
  resident. The first run passed that check in 1.7 s and reported an area with
  zero rooms, zero creatures and zero of everything else as a blocker — it had
  measured a module mid-teardown. The probe now holds a reference to the outgoing
  module and requires a *different* one with `readyToProcessEvents === true`, then
  settles, then verifies `filename` matches what was asked for.
- **`DLGObject` is not exported from the bundle**, and `FromResRef` is
  synchronous, not async. The dialogue probe assumed both and skipped itself on
  every module. It now tests what the engine *itself* resolved — a creature whose
  template declares a Conversation but whose `.conversation` is absent — which is
  a better probe anyway, and needs no unexported API.

**First verified run — 101PER and 001EBO, 128 s wall clock, both `ok`:**

| | 101PER | 001EBO |
|---|---|---|
| load | 33 s | 25 s |
| rooms / creatures / doors / placeables | 66 / 18 / 22 / 75 | 18 / 2 / 11 / 43 |
| objects missing a model | **0** | **0** |
| items inspected / faulted | 80 / **0** | 4 / **0** |
| conversations declared / resolved | 17 / **17** | 1 / **1** |
| probes skipped | **0** | **0** |

Both areas are in materially better shape than the depth-first evidence implied.
Two genuine findings across the pair: a `TypeError` in
`NWScriptInstance.getInstrAtOffset` (reading `get` of undefined) on 101PER, and
37 console errors there led by `Resource not found: ResRef: t_door01`.

**Throughput: about 64 s per module, so all 82 in roughly 90 minutes** — the whole
game inventoried in less time than one partial playthrough currently takes.

**One benign class is filtered, and counted rather than discarded.** A retail
install has no module-level `.mod` files, so the engine's `modules/NAME.mod`
probe 404s for every module (the ROADMAP 1.11 class). Unfiltered it would top the
blast-radius ranking at 82 of 82 modules and bury every real systemic fault
beneath it. `benignErrors` is reported separately so the filter cannot quietly
swallow a real regression in the same code path.

- **Done when:** all 82 modules have been swept at least once and the ranked
  root-cause list is the input to fix ordering. **Next:** run the full sweep.
- **Not a replacement for the playthrough.** The sweep cannot tell you a quest is
  unfinishable, that combat maths are wrong, or that a conversation dead-ends. It
  answers a narrower and cheaper question — of everything the engine must load,
  build and render for a module to be playable at all, what is broken?

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
- **3.3** ✅ implemented / ☐ headset-accepted — One- and two-handed lightsaber.
  The off hand now genuinely contributes. A two-handed grip requires the off hand
  to be *tracked and within 0.35 m* of the dominant hand, not merely the grip
  button held, and the swing is measured at a point 0.6 m along the blade with
  the blade direction taken from dominant-hand to off-hand. That is what makes
  the off hand matter: rotating the grip about the rear hand sweeps the blade
  through a wide arc while barely moving either hand, so the old dominant-hand
  sampling saw almost no speed. Double-bladed and dual-wield stances are never
  promoted. One-handed sampling and thresholds are untouched, so 3.4's governor
  tuning still holds. Swing events carry `gripSeparationMetres` for on-device
  tuning of the separation threshold.
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

- **3.10** ✅ implemented (twice) / ☐ headset-accepted — **world use no longer
  drags the avatar** (2026-08-22). *The first attempt covered only
  `ActionUseObject` and `ActionOpenDoor`; Security and eight others still walked
  the player and were caught by the second headset session.* Resolved by option (b): suppress the approach-walk for
  VR-initiated use, on the user's call that being pulled around felt unnatural.

  `ActionApproachPolicy` carries the rule as a session-scoped statement of
  intent — *the player positions themselves* — rather than a per-action flag,
  since that is the actual rule and cannot be forgotten at a call site.
  `VRSpike` sets it on immersive session start and clears it on session end, so
  desktop click-to-walk is unaffected the moment the headset is off.
  `ActionUseObject` (1.5 m) and `ActionOpenDoor` (2 m) both consult it.

  The prompt ranges stay at 2.5 m / 3 m — widening them was a deliberate
  playtest call and the walk, not the range, was the problem. Tests cover both
  directions, including that suppression does not leak out of a session, since a
  stuck flag would quietly break flatscreen play.

  One thing to watch on device: the now-reachable branch calls
  `setFacingObject`, so the avatar turns toward the target. That should not spin
  the view — rig yaw follows `FollowerCamera.facing`, not creature rotation —
  but it is E12 on the test plan.

  *Superseded:* the original open decision read — `ActionUseObject`
  enqueues an `ActionMoveToPoint` whenever the actor is more than **1.5 m** from
  the target, and `ActionOpenDoor` does the same beyond **2 m**. The VR prompts
  offer activation at 2.5 m (placeables) and 3 m (doors), so activations at
  1.97-2.25 m were observed queueing a walk. The rig is welded to the avatar, so
  the engine drags the player — reported as "glitches into different positions
  uncontrollably, and stays glitched".

  This is not a simple revert: those ranges were widened from 1.5/2 on the
  user's own playtest call (2026-08-21) precisely because tighter ones gave no
  prompt at a natural standing distance. The options are (a) narrow the prompt
  ranges back to what the engine will honour without walking, (b) suppress the
  approach-walk for VR-initiated use, since the player is physically adjacent
  already, or (c) reconcile the avatar to the player's own head position before
  activating. Needs a decision before implementing.

- **3.11** ✅ implemented (`codex/embodied-vr-combat`, merged `8872f4cf`) / ☐ headset-accepted —
  **superseded by Allen's 2026-09-12 call:** premade rigged hands (the MIT
  `@webxr-input-profiles` generic-hand GLBs, `src/vr/runtime/hands/`) rather than
  a clone of the avatar's own hand nodes. The analysis below is kept for the
  constraints it records. **Visible hands, and what they hold.** Nothing renders the
  player's hands. `XRControllerAnchorHost` tracks both controllers and both
  ray origins, but the anchors themselves are bare `THREE.Group`s: 3.2's "hand
  presence" is tracking presence, not visible hands.

  What already works, and should not be rebuilt: the **equipped weapon is
  already presented in the hand**. `setHeldVisual` mounts a presentation clone
  of the engine's held model on the grip anchor, honouring an authored grip
  node where the model has one and a per-class fallback transform where it does
  not. It shares geometry and materials rather than copying them, and is
  deliberately not an `Object3D.clone()` — three deep-copies `userData` through
  JSON, and every Odyssey node's `userData` refers back to its own meshes, so
  cloning an equipped weapon threw on the first XR frame with anything in hand.
  The diegetic hilt timer (3.5) and stance readout (4.8) mount on that same
  anchor.

  So the gap is the hands themselves, and it got more visible with `028410d1`:
  the avatar is now hidden for the first-person submission, because it was
  being drawn into the player's face. Correct, and it leaves a floating weapon
  with no hands and no body behind it.

  **Decisions this needs before implementation, not during:**

  1. **Where the geometry comes from.** No first-person hand assets ship with
     TSL, and none may be added to the repo — players bring their own retail
     install. The option that keeps that property is the one the held-item path
     already proves: build a presentation clone from the *avatar's own* hand
     and forearm nodes, generated at runtime from the player's install. It also
     gets equipment for free, since gloves and armour are already on those
     nodes. The alternative is authored generic hands, which would be original
     content and would ignore what the character is wearing.
  2. **How much arm.** Hands only, or hands plus forearms. Full arms cannot be
     right: the engine animates the avatar's arms from the d20 layer, so they
     will not match the player's real pose, and an arm that disagrees with your
     shoulder reads worse than no arm at all. Forearms need a decision on
     whether to bend them toward the body or leave them floating.
  3. **Whether the off hand shows the grip.** 3.3 already requires the off hand
     tracked and within 0.35 m of the dominant hand for a two-handed swing, and
     a visible second hand on the hilt is what would make that rule legible
     rather than invisible.

  **Constraint worth writing down.** A presentation clone is built with
  `traverseVisible`, so it must never be built while the avatar is hidden or it
  captures nothing — and caches that emptiness under its descriptor key. This is
  safe today only because the first-person hide and its restore are a
  synchronous pair around one `renderer.render` call, so no other code can
  observe the hidden state. Anything that widens that window breaks hand and
  weapon visuals together.

  - **Done when:** both hands are visible in the headset, track the controllers,
    carry the equipped weapon and its diegetic readouts, and reflect the
    controlled character rather than a fixed one after a party swap.
  - **Files:** `src/vr/runtime/XRControllerAnchorHost.ts`,
    `src/vr/runtime/VRFirstPersonBody.ts`, `src/vr/VRSpike.ts`.

#### Combat feel pass (audit 2026-09-23)

A source audit of VR combat and world actions, plus the round-11 headset
notes. The d20 layer was sound. What was missing is how the player *feels* it:
haptics are only called by world prompts and the action wheel, never by combat.
With the avatar hidden in first person, a hit, a miss, a critical, a parry and
taking damage all feel the same, which is nothing. Allen's calls on the audit:
**buffer off-tempo swings**, an **optional player-invoked pause is acceptable**
(it amends "no round pauses" only for a pause the player asks for), and
**haptics work on his rig** — the "haptics are unavailable on this rig" comment
in `VRSpike.applyWorldPromptEffects` is stale.

Rule for every item below: the stats still decide. Nothing here changes a roll,
a range, a cost or the 3-second round. It changes what the player feels and
sees, and which physical input counts. Items are in priority order; 3.12-3.14
belong together.

- **3.12** ✅ implemented (2026-09-23) / ☐ headset-accepted — **One-swing buffer plus a round-ready pulse.** `VRCombatSwingBuffer` holds the swing; `serviceVRCombatSwingBuffer` in `GameState.ts` drops or releases it each frame; `VRSpike.pulseRoundReady` plays the tick (25 ms, 0.25); the hilt ring turns full amber while a swing is armed. An engine pause (`EngineState.PAUSED`) empties the buffer. The TEMPORARY swing diagnostic stays until the headset settles it. Today a swing made while
  a round is running is refused by `VRCombatTempoGate` (`round-active`) and
  thrown away. That matches the round-5 report "rounds failed several times and
  did not register a swing". Instead, keep one pending swing or trigger pull
  (keep the latest; no stacking) and dispatch it through the normal
  `dispatchVREmbodiedCombatInput` path the moment the gate opens. It is the VR
  version of flatscreen letting you queue the next action. A soft haptic tick
  on the weapon hand marks the round opening, so the player knows when to swing
  without looking at the hilt.
  - The buffer clears on target death or invalidation, on a weapon change, on a
    party swap, and when combat ends. A stale buffered swing must never fire at
    a new enemy.
  - The hilt (`VRWeaponStanceHost`) shows an "armed" state while a swing is
    buffered.
  - Only a buffered **basic** attack, or the queue head's own required input,
    may fire. The buffer never changes which intent fires.
  - Once this settles the round-5 question, remove the TEMPORARY
    `reportVRSwingOutcomeOnce` diagnostic in `GameState.ts`.
  - **Done when:** in the headset, swinging continuously through a fight rolls
    once per round with no lost rounds, the ready tick is felt, and a swing
    buffered just before the target dies does not fire at the next enemy.
  - **Files:** `GameState.ts` (dispatch), `VRCombatTempoGate.ts`, a new
    buffer module beside `VRCombatIntentQueue.ts`, `VRWeaponStanceHost.ts`,
    `VRSpike.ts` (haptic).

- **3.13** ✅ implemented (2026-09-23) / ☐ headset-accepted — **Feel the roll.**
  Done as `VRCombatAttackResultObserver` (every landed roll, melee included),
  `resolveVRCombatFeedback` (pure mapping: miss 12 ms/0.1, hit 50 ms/0.55,
  critical two knocks 60+90 ms up to 1.0, parry clash 75 ms/0.75, deflect
  45 ms/0.6) and `VRBladeSparkHost`. A bolt the player deflected is drawn to a
  point 0.55 m along the weapon hand's aim from the grip, rebounds towards the
  shooter with scatter, and sparks when it arrives. The engine already plays
  the parry animation and colours deflected bolts; no clash *sound* yet — none
  was found in the engine's combat path, so it is left for the headset pass
  to judge whether one is needed. Original statement: When an attack result is calculated, pulse the weapon hand
  differently for hit, miss, critical and parried or deflected (8/9). The
  transition is already observed in `VRCombatVisualEvents`
  (`attackResultsCalculated`, `attackResult`), so add an event there rather
  than a hook in `CombatRound`. Parried: spark and clash sound where the blades
  would meet. Deflected: the bolt from `VRBlasterBoltHost` bounces off the
  player's blade instead of hitting the body. A spray of blade sparks is fine;
  a physics simulation is not the goal.
  - **Done when:** with eyes closed, Allen can tell a hit, a miss and a
    critical apart by feel, and a deflected bolt is visibly deflected.
  - **Files:** `VRCombatVisualEvents.ts`, `VRBlasterBoltHost.ts`,
    `VRHapticFeedback.ts`, `VRSpike.ts`.

- **3.14** ✅ implemented (2026-09-23) / ☐ headset-accepted — **Feel getting hit.** Triggered by the controlled creature's own hit points dropping (so mines, grenades and Force damage count too); the side comes from the last attack roll that hit the player within 2 s, else both edges faintly (`VRDamageFeedbackTracker`, `resolveVRDamageSide`). `VRDamageFlashHost` is a sibling of the vignette with one red edge per side; the comfort panel gained a **Damage Flash** row (on by default). The haptic pulse on that side's hand is not behind the toggle. Original statement: When the controlled creature takes damage, show a
  short red flash at the edge of the view on the side the attacker is on, and
  pulse the controller on that side. A critical gets a stronger flash and pulse.
  The vignette host already draws at the edge of the view, so extend it rather
  than adding a new overlay. Respect a comfort toggle.
  - **Done when:** in a fight with two enemies on opposite sides, Allen can
    tell from the flash and pulse which one hit him.
  - **Files:** `VRComfortVignetteHost.ts` (or a sibling), `VRSpike.ts`,
    `VRComfortSettingsHost.ts`.

- **3.15** ✅ implemented (2026-09-23) / ☐ headset-accepted — **Combat aim follows the dominant hand.** Fixed in all five places: combat aim, the interaction aim combat consults first, and the panel, overlay and keyboard pointers. Select already worked from either trigger. Original statement: Bug:
  `VRSpike.resolveAimedCombatTargetId` reads `hands.right` whatever
  `VRSpike.dominantHand` is set to, so a left-handed player swings with the
  left hand and aims with the right. The keyboard and overlay pointers at
  `VRSpike.ts` ~1413/1488/1699 also read `right`. Check whether they should
  follow the setting too.
  - **Done when:** with the dominant hand set to left, the target ring follows
    the left controller and a left-hand swing hits the ringed enemy. There is a
    unit test for both hands.

- **3.16** ✅ implemented (2026-09-23) / ☐ headset-accepted, ☐ tuned — **A swing must go toward its target.** A fast movement arms a 250 ms window; the swing counts when the weapon segment (hand to 0.9 m along the controller's pointing ray, 0.15 m unarmed, along the hands for a two-handed grip) comes within 0.75 m of the target's capsule (feet, 1.9 m tall, radius = appearance `perspace`, min 0.3, default 0.5). Target *nomination* still comes from the soft lock, not the sweep: a sweep that nominates would fight the lock's dwell and grace rules, and the lock already follows the weapon hand (3.15). A TEMPORARY log reports the first 12 swings that missed and by how much, so the slack can be tuned from Allen's play. Original statement: Today any movement faster than
  0.8 m/s counts as a swing at the locked enemy, wherever the blade actually
  goes. Require the blade sample point to pass through a generous volume around
  the target — its radius plus melee reach slack. Let the blade's sweep
  nominate the target, falling back to the soft lock. Keep it forgiving: it
  exists to make waving in the air stop counting, not to make hitting harder.
  Tune only from real headset traces (`VRInputRecorder`), never from synthetic
  probes.
  - **Done when:** swinging at empty air beside a locked enemy does not roll,
    and a real swing at an enemy still rolls every round in Allen's traces.

- **3.17** ✅ implemented (2026-09-23) / ☐ headset-accepted — **Bash with the weapon.** With no hostile locked, a melee or unarmed swing through a locked door or container the weapon hand points at (capsule on its bounds centre, 1.6 m tall, 0.6 m radius, same 3.16 contact rule) activates the world prompt's own `Bash` entry. It never invents one: 101PER's only locked object, the plot-held MorgueDoor, offers just `Use`, and the new `weapon-bash-route` emulator check proves the swing refuses there. A swing while already bashing that object does nothing, because the engine keeps Bash rounds going itself and re-activating would restart them. The *start* path is proven only by the XR-loop test; it needs a bashable object in the headset. Original statement: A melee swing at a locked door or container
  queues the engine's own Bash attack. `VRCombatVisualEvents` already knows a
  round aimed at a placeable is a Bash. The retail Bash rules and the plot/lock
  gates in the world-prompt model stay authoritative.
  - **Done when:** swinging at a lockable Peragus container bashes it with the
    same result as the prompt's Bash.

- **3.18** ✅ implemented (2026-09-23) / ☐ headset-accepted — **A pause that works for combat.** New `isPaused`/`setPaused` hooks report only a *player* pause (the comfort panel's own pause is excluded). While paused, `processCombatInput` stops before any swing, trigger, Force flick, grenade throw or presentation shot, but keeps the target ring and hilt queue up and latches the triggers so a held one does not fire on resume. `VRPauseIndicatorHost` dims the world under every VR surface and shows a PAUSED plate low in view. New comfort row **Unpause on Wheel Close** (off by default) resumes the game when the wheel closes back to the world, but not when a wheel entry opened a menu. The wheel was already processed while paused; the `wheel-builds-while-paused` emulator check proves it builds, though in 101PER only Menu and Comfort Settings are on offer, so queuing attacks and party orders while paused is for the headset. Original statement: A pause already exists: the dominant `B`
  (`SemanticXRAction.Pause`, button 5) calls `togglePause`, which sets
  `EngineState.PAUSED`. Make it useful mid-fight the way retail's is:
  - While paused, the action wheel opens and queues attacks, Force powers,
    items and party orders.
  - A clear sign that the game is paused, such as a dimmed or desaturated world
    or a wrist readout.
  - Swings and trigger pulls do nothing while paused. The swing buffer (3.12)
    is empty on resume.
  - Locomotion stays blocked while paused, as it is now.
  - An option to un-pause automatically when the wheel closes. Off by default.

  It must never engage on its own; auto-pause events stay a separate decision.
  - **Done when:** Allen can pause mid-fight, queue three actions and a party
    order, unpause, and watch them play out in order.

- **3.19** ☐ **One generic Force cast gesture.** Keep push and pull, and add one
  gesture: an off-hand open-palm thrust toward the target releases whatever
  Force power is at the head of the queue. This keeps the locked "small gesture
  set" at three, instead of one gesture per power. Force-point cost, range and
  saves stay with the spell. The flick detector in
  `VRForceGestureController` is the model to follow. It is also T3's route
  once it has a usable power or item (F14).
  - **Done when:** a queued non-push/pull power (e.g. Stun) fires on the palm
    thrust at the locked target, and does not fire with nothing queued.

- **3.20** ☐ **Physical consumables and hold-to-work.** Each of these routes to the
  same engine action it uses today:
  - A medpac or stim held to the neck or mouth uses it and spends the round's
    action, as in retail.
  - Security and mine disarm or recover become hold-to-work: the wrist or hilt
    ring fills over the engine's own action time. This also removes the
    re-press restart that made Security look broken (headset round notes).
  - A grenade can be thrown with a real arm motion; the target snaps to the
    hostile nearest where it lands, and retail's throw range is kept.

  Each part lands separately and is accepted in the headset before the next
  starts.

- **3.21** ☐ **Party: attack my target.** Point the off hand at an enemy and
  choose a wheel entry (e.g. "Party → Attack my target"). It goes into the
  party order queue, which already runs ahead of members' own attacks.
  - **Done when:** both companions switch to the pointed enemy on the next round.

Also open from round 11, tracked where they already live: F14 (the shock arm
has no audio or visuals), G2 (mine audio and explosion — retest after
`e54a1a3c`/`c34507d3`), K6 (the hilt stack in `21ce86ac` needs the headset).
F6's request for Security beside the tunneler was superseded the same day by
the retail rule: an untrained character sees only the tunneler.

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

  **Correction (2026-08-22 headset session).** The "no TSL menu is a stub"
  conclusion above was wrong in an important way. It came from checking class
  inheritance and empty method bodies, and this kind of stub is invisible to
  both: the override exists and is non-empty, it just registers a *subset* of
  the parent's listeners after calling `super.menuControlInitializer(true)`.

  A structural audit across every TSL menu finds **43 dropped click handlers
  across 15 menus**, and they are dead in flatscreen too — VR only made it
  obvious, because the ray has nothing to fall back on. Two that trapped the
  player in a UI are fixed (`MenuJournal.BTN_EXIT`,
  `MenuContainer.BTN_GIVEITEMS`); 41 remain, catalogued in
  `src/tests/tsl-menu-dropped-handlers.test.ts`, which fails on any new
  divergence and on any ledger entry that has since been fixed.

  Player-visible among the remainder: the Pazaak table is entirely unwired,
  character generation cannot go back or accept, the upgrade screens cannot go
  back, and saves cannot be deleted. Note the ledger records *divergence*, not
  necessarily *bug* — `MenuMap.BTN_PRTYSLCT` is listed, but TSL's map GUI has no
  such control at all, which is a different problem (it crashed `MenuMap.show`).

  *Still open:* the minigame menus (Pazaak, swoop) are unexamined beyond the
  handler audit.
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
  separated. Cycling reuses the same possession route the wheel's Party
  submenu calls (`SwitchPlayerCharacter`, since 2026-09-25; it used to be
  `SwitchLeaderAtIndex`, which only reordered the follow order), and the wheel
  stays the way to pick a *specific* member.

  `Pause` toggles the engine's own pause on the dominant B button.

- **4.8** ✅ implemented 2026-08-23 / ☐ headset-accepted — **Combat radial
  redesign** (jest 757/757, vr:check 24/24). Headset
  session 2 recorded that combat actions on the wheel "were a mistake and need a
  different route." The route is still the wheel — what was wrong is that
  `buildVRActionWheel` flat-dumps `targetActions`/`selfActions` at the top level
  beside Journal and Options, which guarantees pagination and freezes the target
  at wheel-open with no way to re-aim.

  Top level becomes exactly six items — Attacks, Force Powers, Menu, Party,
  Comfort Settings, Clear Actions — fitting one page with no pagination. Attacks
  and Force Powers are ordinary submenu wedges over the panels
  `ActionMenuManager` *already* filters by equipped weapon type and known
  powers. `Menu` collapses today's three static screen wedges plus the
  five-item Screens submenu into one route that opens `InGameOverlay` on its
  `BTN_CHAR` tab, since the overlay is one menu with a tab bar rather than eight
  destinations.

  Attack modes become a persistent stance, changed between rounds and applying
  to the next round, read out beside the diegetic round timer on the weapon —
  hilt for sabers, blaster body for ranged.

  **Superseded ordering note.** The frozen-target readout was to reuse
  `setVRSelectedObject` / `CursorManager`, whose plate and bar live in
  `InGameOverlay`. That defect was fixed by *removing* the overlay from VR
  entirely, so the readout has no surface there. It is now a **world-space
  highlight on the creature** instead.

  **Also implemented:**
  - Persistent attack-mode stance (`VRAttackStanceController`), changed between
    rounds and applying to the next one. The round boundary is *detected* — a
    `CombatRound.timer` that went backwards is a new round — so the engine needs
    no hook. Guarded against three quiet failures: Bash on a door is also
    `ActionPhysicalAttacks` in target panel 0 and must not be swallowed;
    `getFeats()` is not weapon-filtered, so the stance is re-resolved per swing
    against `getEquippedWeaponType()`; and a non-finite timer is ignored rather
    than coerced to 0, which would look like a round reset.
  - Stance readout on the weapon beside the round timer
    (`VRWeaponStanceHost`). The ring already covered both weapon types — it
    clears only for `unarmed` — so ranged needed no separate anchor.
  - World-space target highlight (`VRCombatTargetHighlightHost`): a flat ring at
    the frozen target's feet, replacing the name-plate route that the
    `InGameOverlay` removal took away.

  **Not settled by emulation:** stance-plaque legibility through lenses, and
  whether the round-queued stance *reads* correctly in a live fight. Both need
  the headset.

  Full spec, constraints, and wedge-geometry rationale: `COMBAT-RADIAL-REDESIGN.md`.

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
- **7.3** ◑ Remaining TSL-only routines. **Measured, not estimated (2026-09-22):**
  PyKotor decodes the 3,896 distinct compiled scripts in the retail install; counting
  ACTION instructions against the routine tables leaves **45 routines that retail
  scripts actually call and nothing implements, 286 call sites**, after `c2dcaa4a`
  (23 routines, influence trio on the parity branch) and `ec56e76b` (AddMultiClass,
  RemoveEffectByExactMatch, ForceHeartbeat, FaceObjectAwayFromObject, AngleToVector,
  SetMapPinEnabled). The uncommitted main-checkout work adds HasLineOfSight,
  RemoveEffectByID and the Force-point cost routines on top; missing from both
  trees: 40 routines, 133 call sites. Largest remaining:
  SetForfeitConditions/GetLastForfeitViolation (the dueling rings - a rules system,
  not a routine), EffectModifyAttacks, SpawnMine/DetonateMine (351NAR, 601DAN,
  603DAN - the engine can trap a door or placeable but has no way to lay a ground
  mine trigger at a location, so this is a feature, not a routine), ActionUseSkill, the
  Modify*SavingThrowBase trio (waits on the save-throw rewrite) and about a dozen
  Force-power effects used only by `k_sp1_generic`. Re-measure with
  `tools/parity/routine_usage.py` + `routine_coverage.js` (on
  `codex/parity-observability-spec`) before picking the next batch; decompile callers
  with `tools/dencs` (write to files, the CLI is very verbose on stdout).
- **7.4** Full playthrough.
- **7.5** Optional AI-upscaled texture pack support — see below. Blocked on
  usage permission from the mod author.
- **7.6** Swoop race (211TEL) playable in VR — see below. ☐ rewritten 2026-09-25, awaiting a captured headset ride; was ✗ still broken in the
  headset as of 2026-09-21.

M4-78 is out of scope.

### 7.6 — Swoop race playable in VR ☐ rewritten 2026-09-25, awaiting a captured headset ride

Status in one line: the controls were redesigned with Allen on 2026-09-25,
the engine underneath was found to be wrong in seven places that no VR
control could have worked around, and the whole thing now runs a clean race
in the emulator (`tools/vr-emulator/probe-swoop-vr.js`). Nothing here has
been ridden by a human yet; the next step is a ride with
`tools/vr-emulator/capture-swoop-ride.js` recording.

**The locked control scheme** (Allen, 2026-09-25; supersedes every earlier
one, including the hand-roll steering):

- Steering is the **left thumbstick** or **head lean**, both as a rate; a
  deflected stick overrides the lean. The lean neutral is the head's
  sideways offset across the seat, sampled through the countdown and frozen
  at the flag. Recentre takes the current posture as straight again.
- The hands do not steer. **Squeeze** takes hold of a handle and the hand is
  drawn on it. The handles are the two posts under the dashboard, measured
  from the live bike geometry at (+/-0.25, 1.25, 0.87) bike-local (y pulled back from the measured 1.40 in the headset).
- **Right trigger** is the throttle (hold to climb the gears, as retail's
  OnAccelerate script wants). **Left trigger** jumps, and only the left
  trigger.
- The bike carries sideways velocity (`SwoopLateralMotion`): LateralAccel is
  an acceleration, the road edge is a wall that stops the bike, and every
  moment of the ride - obstacle, mine, pad, wall, take-off, landing - pulses
  both controllers (`SwoopRideEvents` -> `VRSpike.pulseHand`).
- The rider's eyes sit 1.45 above the bike origin (the authored rider's 1.13 could not see over the windshield) and 0.6 forward, from the
  authored rider's head.

**Engine faults found and fixed on the way** (each one would have broken the
race whatever the controls were):

1. `ModuleMiniGame.loadMGTracks` never placed a track model at its LYT
   position. Every course object hangs off a track's modelhook whose offset
   is authored against that placement, so all 47 pads and mines were piled
   beside the start line at z 40 and the rider's own track (LYT z 41) ran
   forty units under the road. That was the "smeared floor", the missing
   pads and the missing obstacles in one.
2. `NWScriptStack.push` pushed a returned vector z-first; the compiler and
   the pop side are x-first. Scripts reading `.z` got `.x`, so 211TEL's
   onjump read the lateral offset as height and refused jumps right of
   centre.
3. The TSL routine table declared `SoundObjectFadeAndStop` with one
   argument; the script pushes two. Every stack-relative read after that
   call in a script was one slot off, which is how the mine script came to
   pass its gear counter to `SWMG_GetHitPoints` and end the race with 0%
   health.
4. `SWMG_GetHitPoints` / `SWMG_GetMaxHitPoints` excluded the player and
   `SWMG_SetFollowerHitPoints` set nothing, so the rider could not be hurt
   and the health percentage the heartbeat watches was garbage.
5. Contact with pads and mines was a point-in-sphere test in three
   dimensions. Pads sit four units under the hook and the bike covers four
   units a frame at gear 5, so a whole lap met nothing. It is now a swept
   test in the road plane (`SwoopCollision`), skipped while airborne so a hop
   clears a mine.
6. Only the player's OnHitFollower ran on contact; the mine's own
   OnHitFollower (`mine`, the explosion and the damage) never did. Enemies
   also had no name for `SWMG_GetObjectName`, which is how the accelpad
   script tells a mine from a pad.
7. The lane centre was a raycast that found the shoulder (+15); the course
   is authored about the hook line, x 0.

Also fixed: the flatscreen arrow keys wrote +/-300 straight into the position
each frame (that was the "janking"), the debug collision sphere was drawn
around the bike, obstacles with no Invince_Period re-fired every frame, and
the eye height resolver read the bike's meshes against a local origin.

**Retail's race end**, decoded from the heartbeat: y > 6000 (one lap of the
course), or health% <= 0, or GBL_QUIT_SWOOP; then a fade and
`StartNewModule('207TEL', '211TEL_Swoop_Return')` with the time in the
211TEL_SWOOP_MIN/SEC/MSEC globals. There is no result screen inside the
module; the "result" is the dialog back in 207TEL.

**Verified in the emulator, not the headset:** stick and lean steer both ways
and settle rather than snap; the wall holds the bike at +/-20 and reports a
bump only on impact; the left trigger jumps once per press and a press in the
air is refused; pads boost and die when taken, mines explode, are destroyed
and take 100 health each, the health percentage reaches the race dialog, the
gears climb to 5 and the race no longer ends early.

**First headset ride (2026-09-26):** steering, throttle, jump, pads, mines
and the race end into 207TEL all worked as described. Three things did not
and were fixed the same night: a pinned hand was drawn two units behind the
bike (the pin was taken before the engine tick; held hands are now re-pinned
after the rig sync), the rails across the road did not slow the bike (they are
room geometry - now three short rays at hull height against the rail meshes,
a hit running the module's obstacle script), and the eyes sat at the
calibrated baseline (now the live head height on the swoop, with the baseline
retaken on leaving). Eye height and grip depth were then tuned live.

**Still open, for the ride:** the feel of the lateral rate (retail's own
LateralAccel is slow at low speed and 300 at high), the lean dead zone and
full-lock distance, whether the seat and eye placement read right from the
saddle, and whether the k2_shield mesh (authored at alpha 0) shows.

### 7.5 — Optional AI-upscaled texture pack ☐ blocked on author permission

[Selphadur's Kotor Texture Redux](https://www.nexusmods.com/kotor/mods/1302)
(v1.1, 28 Dec 2019, 9.0 GB, 2,300+ textures) replaces vanilla textures with 4x
AI upscales, hand-cleaned, with alpha channels carried across. Vanilla Odyssey
textures are mostly 256²–512² and were authored for a camera several metres
back; in a headset the player's eye ends up centimetres from a wall panel, so
the resolution deficit is far more visible in VR than in flatscreen. That is
the case for pulling this in.

Allen has messaged Selphadur asking for usage permission. **Do not start
implementation, download the pack into the repo, or commit any of its files
until that permission is in hand and recorded here.**

**Two blockers before this is even worth planning in detail:**

1. **This pack is for KOTOR 1, not KOTOR II.** The Nexus page is under the
   `kotor` (K1) domain, the readme says `swkotor\Override`, and it ships a K1R
   compatibility patch. A search of the `kotor2` Nexus for "texture redux"
   returns nothing, and in the mod's own comments Selphadur says a K2 upscale is
   "a huge possibility" but never confirmed one. So the first task is not
   integration, it is **measuring the resref overlap**: extract the pack's file
   list, intersect it against the resrefs TSL actually requests, and find out
   what fraction of K2's texture set it can cover at all. The shared-Odyssey
   subset (generic placeables, some doors, VFX, a few body/head textures) is
   real but is nowhere near all 2,300. If the overlap is small, the honest
   answer may be that this pack is the wrong source and the pipeline below
   should be pointed at a K2-specific pack or at an upscale we run ourselves.
2. **The stated permissions are restrictive.** From the Nexus permissions block:
   upload elsewhere "not allowed … under any circumstances"; modification
   requires the author's permission; **conversion to work on other games "not
   allowed … under any circumstances"**; asset use allowed with credit;
   commercial use forbidden. Using K1 textures in a K2 project reads as
   conversion, which is exactly the clause that is a flat no by default — hence
   the ask. Whatever Selphadur replies, quote it verbatim in this entry, because
   the answer determines the distribution model.

**Distribution model (assume this even on a "yes"):** the pack is
user-supplied, never bundled. The user downloads it from Nexus themselves and
points the mod at it, or drops it into their own `Override`. 9.0 GB of TGA does
not belong in a git repo regardless of licence, and "no upload to other sites"
forecloses redistribution outright. Credit goes in the README and in an
in-game credits/settings panel.

**Implementation notes — a starting point, not a plan:**

- **Resolution already works.** `TextureResolution.resolveExact()` searches
  `override-tga` first, ahead of `override-tpc`, `active-module`,
  `texture-pack`/`gui-pack`, and `key-bif`
  ([TextureResolution.ts:288](src/loaders/TextureResolution.ts#L288)). Loose
  `.tga` files in `Override` therefore already win over the shipped packs with
  no engine change. A first smoke test is literally: copy a handful of matching
  upscales into `Override`, load `101PER`, and read
  `TextureLoader.getDiagnostics()` to confirm `source: 'override-tga'`.
- **The `.tga`-over-`.tpc` choice is deliberate on the pack's side.** Selphadur
  moved off TPC because of mip-map problems, and told a commenter converting
  back to TPC would reintroduce them. Do not "optimise" by converting to TPC.
- **VRAM is the real risk, and it is a VR risk specifically.** `TGALoader`
  decodes to uncompressed RGBA and sets `generateMipmaps = true`
  ([TGALoader.ts:42](src/loaders/TGALoader.ts#L42)). A 4x upscale of a 512²
  source is 2048² — 16 MB resident, ~21 MB with the mip chain, per texture,
  versus ~1.3 MB for the DXT-compressed original. That is a ~16x GPU memory
  multiplier applied to a build that Phase 0.3 already flags at ~8.9 GB
  renderer memory with load times climbing 41s → 47s → 65s across successive
  loads. **0.3 must be closed before this lands**, or the pack simply converts
  a known leak into an out-of-memory crash.
- **The likely answer is an offline transcode to KTX2 / Basis Universal.** Ship
  a tool under `tools/` that walks a user-supplied Override directory once,
  transcodes each `.tga` to KTX2 (UASTC for normal/bump, ETC1S for diffuse),
  and writes a side-directory the loader prefers. That keeps GPU-side
  compression, keeps the mip chain, cuts both VRAM and load time, and —
  usefully for the permissions question — produces an artifact that lives on
  the user's disk and is never redistributed. It needs a new
  `TextureResolutionSource` (`'hd-pack'`, ahead of `override-tga`) and a
  matching branch in `OdysseyTextureSourceProvider.load()`
  ([TextureLoader.ts](src/loaders/TextureLoader.ts)).
- **Budget and downscale, do not load blind.** Whatever the format, add a
  per-session texture memory budget and a max-dimension cap the user can set
  (2048 / 1024 / off) in the existing Comfort Settings panel route. A 3060 at
  the Phase 0 stereo target has no headroom for a naive 9 GB pack.
- **Alpha channels and TXI still have to survive.** The pack copies alpha
  across, and `override-tga` pairs each TGA with an `Override` `.txi`. Any
  transcode step must carry both, or transparency, environment mapping, and
  blending regress. Guard this with a test alongside
  `src/tests/texture-loader-routing.test.ts`.
- **Watch the known-bad file.** `PLC_FrcDist01.tga` crashes retail KOTOR 1 on
  Taris and the author removed it in v1.1. If any v1.0-era copy is in play,
  exclude it.
- **Done when:** the resref-overlap measurement is written up with a number;
  permission is recorded verbatim; a user-supplied pack loads through a
  documented path with `source` diagnostics proving it, at a measured VRAM cost
  inside budget and with no regression against the Phase 0 stereo FPS floor.
- **Files:** `src/loaders/TextureResolution.ts`, `src/loaders/TextureLoader.ts`,
  `src/loaders/TGALoader.ts`, `src/loaders/ResourceLoader.ts` (Override scan),
  new tooling under `tools/`.
- **Depends on:** 0.3 (memory growth), and realistically Phase 6.3 (the perf
  pass) for a baseline to regress against.

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
- Fix in blast-radius order, not encounter order. Before starting on a defect, check
  `npm run vr:sweep` output for how many modules its root cause touches.
- When a symptom is ambiguous, add a diagnostic that names the object and run again.
  Do not theorize from a log.
