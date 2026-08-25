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

### 1.2 — Missing textures / white boxes ✅ named and explained (2026-08-22)
No longer blocked: `tools/vr-emulator/phase1-diagnostics.js` harvests
`TextureLoader.getDiagnostics()` from a real save. A Peragus load produces
**3,673 resolutions, 86 missing across 20 distinct resrefs**, and cross-checking
those names against the retail texture packs and the TSLRCM Override splits them
in two — which is exactly the "genuinely absent vs. parsing gap" this item asked
for.

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

### 1.3 — Player is an appearance-less human instead of T3-M4
`ModuleArea.loadPlayer()` finds `PartyManager.Player` unset and invents a placeholder
from `getPlayerTemplate()`, while the prologue spawns T3 separately by script. Two
entities result: a phantom human the camera follows, and the real T3 the UI reports on.
- **Done when:** the prologue player is T3-M4, one entity, camera and UI agree.
- **Files:** `src/module/ModuleArea.ts` (~line 1600), `src/managers/PartyManager.ts`,
  the `DoSpecialSpawnInT3M4` path.

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
  separated. Cycling reuses the same `SwitchLeaderAtIndex` route the wheel's
  Party submenu already calls, and the wheel stays the way to pick a *specific*
  member.

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
- **7.3** Remaining TSL-only opcodes — ~81 with no K1 counterpart. Influence trio
  795–797 is the most valuable cluster and needs a storage design decision first.
- **7.4** Full playthrough.
- **7.5** Optional AI-upscaled texture pack support — see below. Blocked on
  usage permission from the mod author.

M4-78 is out of scope.

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
- When a symptom is ambiguous, add a diagnostic that names the object and run again.
  Do not theorize from a log.
