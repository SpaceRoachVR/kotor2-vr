# kotor2-vr Roadmap

Phase plan for turning [KotOR.js](https://github.com/KobaltBlu/KotOR.js) into a
room-scale VR mod for KOTOR II. Design rationale lives in [DESIGN.md](DESIGN.md);
engine knowledge lives in `.claude/skills/kotor2-vr/`.

**Status: Phase 0 passed under the user-approved sustained-50 floor; Phase 1 is
active.** With Virtual Desktop Synchronous Spacewarp disabled and the headset at
72 Hz, a corrected 60-second raw-WebXR window delivered 51.82 FPS at a 4224 ×
2304 XR target, p90 31.0 ms, p99 46.1 ms, and a PASS verdict. Runtime cadence is
still reported separately and 72 Hz remains a stretch target. The older
31.96-34.96 FPS VDXR evidence remains retained rather than rewritten.

Tasks are sized for a single working session. Each states what "done" means, so a
cold session can pick one up without re-deriving context. Check off in place.

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

- **2.1** WebXR session lifecycle — enter/exit VR, session loss, resume.
- **2.2** Camera rig replacing the follower camera, with fixed canonical eye height.
- **2.3** Roomscale tracking with the rig coupled to the walkmesh.
- **2.4** Soft-block on wall intrusion — push the rig back, no fade, no hard stop.
- **2.5** Smooth locomotion + smooth turn as default; teleport, snap turn, vignette as
  options.
- **2.6** Comfort settings surfaced somewhere reachable in-headset.

**Exit:** walk around `101PER` in VR, roomscale, without falling through geometry or
leaving walkable space.

---

## Phase 3 — VR interaction

- **3.1** Controller input mapping for Quest 3 controllers.
- **3.2** Hand presence and grab.
- **3.3** One- and two-handed lightsaber; left-hand grab promotes to two-handed.
- **3.4** Swing detection feeding the d20 round — governor option (c): every swing
  animates and connects visually, only on-tempo swings roll.
- **3.5** Diegetic round timer in the lightsaber hilt.
- **3.6** Blasters: laser pointer, stat-rolled, automatic deflection.
- **3.7** Force gesture set — push/pull flicks. Keep it small.
- **3.8** Radial menu for everything else; pauses outright.

**Exit:** a Peragus combat encounter completable in VR with the d20 layer intact.

---

## Phase 4 — VR UI

Every button reachable in flatscreen needs a VR route.

- **4.1** Wrist-mounted holo device shell.
- **4.2** Physical inventory.
- **4.3** Summonable floating panels: character sheet, galaxy map.
- **4.4** Dialogue skill checks as floating panels.
- **4.5** Audit `gui/` for anything still unreachable — check `game/tsl/` against
  `game/kotor/` for stubs while doing it.

---

## Phase 5 — Cutscenes and dialogue

- **5.1** Theater-screen reprojection for movies.
- **5.2** Dialogue keeps engine camera cuts, with fade-to-black between them.
- **5.3** Comfort pass over the prologue's scripted sequences specifically.

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
