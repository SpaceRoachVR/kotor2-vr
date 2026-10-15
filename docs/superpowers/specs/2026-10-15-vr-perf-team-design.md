# VR performance team — design

Date: 2026-10-15. Branch at design time: `spike/stereo-perf` (`af4b117f`).
Status: approved in conversation section by section; awaiting written-spec review.

## Goal

Native **72 Hz with no dropped frames in real play**, on the RTX 3060 → Quest 3 over
Virtual Desktop/VDXR with Synchronous Spacewarp off. This means breaking the ~31 ms
plateau recorded in perf round P1, not shaving it.

### Where we start

- P1 (2026-09-26): clean play quantizes to ~15 ms / ~31 ms frames and sits on the
  31 ms plateau (~32 FPS). Busy Ebon Hawk rooms ran 32–36 FPS.
- Phase 0 isolation (2026-08-11): raw WebXR with an almost empty scene reached only
  34.96 FPS, and 51.82 FPS after the runtime change, with p90 31.0 ms. Part of the
  ceiling may therefore sit below the game.
- Performance audit 2026-10-14 (`PERFORMANCE-AUDIT-2026-10-14.md`, measured at
  **90 Hz**): Telos `231TEL` ran at 21–29 FPS. Render CPU p50/p90 was 12–14 / 18–24 ms
  and simulation CPU 9–11 / 13–16 ms, so it is clearly CPU-bound there. Its ranked
  hypotheses:
  - Grass wind: landed as `435aed95` (see `GRASS-WIND-OPTIMIZATION.md`).
  - Gravity-particle transforms: not landed.
  - Static matrices and render batching: not landed.
  - Duplicate VR pose processing: not landed.
- The audit also reported a visual-correctness defect on Telos (characters invisible
  or untextured; Bao-Dur's arm drawn as green particles). This design does not fix
  it, but Telos cannot serve as a visual-identity baseline for those characters.

### Constraints

- **No visual trade-offs.** Resolution, render scale, shadows, LOD, grass density,
  post-processing, authored animation and lighting stay as they are. The game must
  look identical.
- Allowed: engine and renderer internals, runtime and stack changes (Electron/Chromium
  version and flags, WebXR path, VDXR vs SteamVR, Virtual Desktop codec and settings),
  and big architectural bets (OVR_multiview2, workers, WebGPU/offscreen).
- **Only headset numbers count as proof.** Emulator and desktop traces generate and
  refute hypotheses but never confirm a fix (see the probes-vs-headset rule in the
  `kotor2-vr` skill).
- Other Claude sessions and Codex edit the main checkout. All team work happens in
  worktrees, and in-flight branches (e.g. `codex/grass-wind-perf`) are rebased onto,
  never overwritten.
- **Headset refresh rate is set to 72 Hz for every round.** The 2026-10-14 audit ran
  at 90 Hz, so its numbers are not directly comparable to the target.

### Acceptance (done)

1. Every benchmark set meets **p90 ≤ 13.9 ms and p99 ≤ 20 ms** over 60 s unprofiled
   windows, at 72 Hz with SSW off.
2. This holds in **two consecutive** headset rounds.
3. Visual identity: screenshot diffs at fixed poses pass, and Allen sees no change.
4. No regressions on the playthrough checkpoints or the validation gates.
5. All confirmed flags are on by default and merged to `spike/stereo-perf`, and the
   ROADMAP Phase 0 caveat is replaced with the new numbers.

### Benchmark suite

| Set | Scenes |
|---|---|
| Peragus | Medbay, hangar and 105/106PER: 30 s stand plus 60 s walk (existing perf-round checkpoints) |
| Ebon Hawk | The interiors from the 32–36 FPS reading |
| Conversation/theater | One Kreia dialogue plus one theater cutscene |
| Combat + minigames | An effects-heavy fight, the swoop, and the 107PER turret |
| Telos outdoor | `231tela` / `231telc`, the worst scene on record (grass, 1,100+ draw calls). Added from the 2026-10-14 audit. |

Every set needs a saved checkpoint, so `perf-round.js stop <checkpoint>` reaches it
without manual play. The Peragus checkpoints exist already; the others are created
during Phase 0 prep.

## Team

| Role | Owns |
|---|---|
| Lead / integrator | Tooling, the ledger, wave planning, merges, and the headset-round driver |
| Trace & frame-pacing | The 15/31 ms quantization: vsync misses, and whether frames are late because of submit timing or because they run over budget |
| GPU/WebGL renderer | Draw calls, state changes, overdraw, shaders, batching, instancing, multiview |
| JS/CPU & GC | Main-thread tasks, matrix work, per-frame allocators (e.g. `updateAnimationNode`), cursor raycasts, moving work to workers |
| XR runtime | Electron/Chromium flags, VDXR vs SteamVR, VD codec/bitrate/encode latency, OpenXR frame timing |
| Adversarial critic | Builds nothing. Plays the affected scenes in the emulator on its own port and attacks every claim on evidence, retail parity and visual identity |
| Retail/visual guard | An analysis-phase helper. Defines what must not change visually, so the critic can reject trade-offs |

## Phase 0 — bisect round

### Prep (no headset; lead)

1. **`perf-round.js bisect`.** Adds launch options that switch off one layer each, with
   no code forks:

   | Rung | What renders |
   |---|---|
   | L0 | Empty cleared XR frame |
   | L1 | One static room |
   | L2 | All module rooms with culling |
   | L3 | Plus creatures and animation |
   | L4 | Plus effects, grass, emitters and lights |
   | L5 | Real play: movement, cursor, audio, UI |

2. **Stage-timing collector.** Records per-frame:
   - simulation CPU and render CPU, using `PerfSampler`'s paired timings
   - GPU time via `EXT_disjoint_timer_query`. The engine defaults to WebGL1
     (`RendererOptions.ts:117`); the `_webgl2` variant applies only under `?gl=webgl2`.
   - XR callback deltas and cadence integrity (one update and one render per XRFrame)
   - VD timing (game, encode, network, decode, headset latency), scraped if possible,
     otherwise read off the overlay by Allen at fixed moments
   - runtime missed-frame counters where available
3. **Fix `perf-trace.js`.** Its generic animation-callback selector mis-measures the XR
   engine callback (2026-10-14 audit), and its budget must follow the configured
   refresh rate instead of a hardcoded 72 Hz.
4. **Checkpoints.** Create save checkpoints for every benchmark set.
5. **Dry run.** Run the full ladder and suite in the emulator. Following the P1 trap,
   the driver runs via Bash `run_in_background`, and a Monitor only ever tails its log.

### Headset round (~30 min, Allen)

- Rungs L0–L5 on Peragus.
- L3–L5 on each other set.
- A 60 s unprofiled window per rung, plus one profiled CDP CPU-profile window per set,
  kept separate from the unprofiled ones.
- Output: `tools/vr-emulator/evidence/perf/bisect-<date>.jsonl` and a round artifact
  page, as P1 had.

**Phase 0 output:** an attribution table showing, per scene, the first rung over
13.9 ms and which stage is responsible (CPU sim, CPU render, GPU, runtime or encode).

**Early branch:** if L0 can't hold 72 Hz, the XR-runtime track becomes wave 1 before
any game-side work.

## Phase 1 — analysis workflow (7 roles, ≤10 agents)

**Input packet**, given to every agent:
- the attribution table and raw bisect JSONL
- headset traces and CPU profiles
- P1 findings and the open ROADMAP items
- `PERFORMANCE-AUDIT-2026-10-14.md`
- the list of in-flight branches

**Stage 1: domain analysis.** The five specialists (trace, GPU, JS/CPU, XR runtime,
plus the visual guard) analyze in parallel, each in their own domain. Each returns
hypotheses with this schema:
- claim
- evidence (trace or code references)
- expected ms saved, per scene
- confidence
- build cost
- a cheap falsification test
- whether it is an upstream candidate

The audit's three unlanded hypotheses enter as seeds, not as accepted items.

**Stage 2: verification.** The critic gets each hypothesis. It checks the evidence and
runs the falsification test in the emulator where that test means anything, then
returns *survives*, *weakened* or *refuted*. The emulator can refute but never confirm.

**Stage 3: ranking.** The lead merges duplicates and resolves conflicts, then ranks by
ms saved × confidence ÷ cost. One extra weight applies: a fix counts only if it moves a
scene below 13.9 ms, or unblocks one that will.

**Outputs**
- `docs/perf/ledger.md`: the single source of truth, covering ranked items, verdicts,
  owner, status, headset results and upstream-candidate tags.
- A proposed wave 1 of 2–4 fixes that don't touch overlapping files.

**Allen reviews** the ledger and wave 1 before any fix code is written.

## Phase 2 — fix waves

### Per fix (its own worktree session)

1. **Baseline.** Run the falsification test, plus a microbenchmark where one is
   meaningful (draw calls, allocations per frame, main-thread ms).
2. **Implement behind a launch option** `perf.<name>=on|off`.
3. **Local gates:**
   - unit tests, including old/new output-parity tests for any changed math
   - `npx jest --ci --silent` and the TypeScript gate
   - a fresh `npm run webpack:dev`
   - `npm run vr:check`
   - an emulator smoke test of the playthrough checkpoints (no new exceptions,
     modules load)
   - a screenshot diff via `screenshot.js` / `mirror.js` at fixed poses
4. **Critic approval**, after it has played the affected scenes.
5. **Merge** into `perf/integration`, cut from `spike/stereo-perf`.

### Wave headset round (~20–30 min)

1. Run the whole suite with all new flags on.
2. On the worst scene, toggle each flag off one at a time, as A/B/A windows at the same
   save, position, view, refresh rate and SSW setting.
3. A fix is **confirmed** if its headset stage time drops within ±30% of the
   prediction and nothing regresses.
4. A fix is **rejected** if it shows no headset gain. It stays merged with its flag off,
   the ledger records why, and its code is removed two waves later unless revived.

### After each round

- The lead updates the ledger with headset numbers, re-ranks, and proposes the next
  wave.
- Confirmed fixes merge from `perf/integration` into `spike/stereo-perf` with their
  flags defaulting on.
- Merges sync with the current base first.

### Big bets

Multiview, workers and WebGPU are never part of a normal wave. They first get a
throwaway spike session, measured in the headset at the bisect rungs. A spike becomes a
fix item only if it shows the gain.

## Stop rules (the lead stops and asks Allen)

1. **Stack ceiling.** L0 can't hold 72 Hz after the XR-runtime track is exhausted. The
   lead reports the measured ceiling and its cause. Allen chooses between SSW, a lower
   target or something else. Visuals are never changed as a workaround.
2. **Diminishing returns.** Two waves in a row move no scene closer to 13.9 ms. The
   lead re-runs the bisect round before planning more.
3. **Failed big bet.** A spike shows no headset gain. It is dropped and recorded,
   never quietly built out.
4. **File conflict.** A fix needs files another session or Codex is actively editing.
   It waits or is re-scoped.

## Allen's touchpoints

| When | What | Time |
|---|---|---|
| Before Phase 0 | Approve this spec and the plan | — |
| Phase 0 | Bisect headset round | ~30 min |
| After Phase 1 | Review the ledger and wave 1 | ~10 min |
| Each wave | Headset round | 20–30 min |
| At a stop rule | Decide | — |

**Visibility:** a live round artifact page (per-scene, per-stage timing against the
13.9 ms line), `docs/perf/ledger.md`, and the linked sessions in the Code tab.

## Out of scope

- visual trade-offs
- gameplay changes
- fixing the Telos character-rendering defect (tracked separately)
- the 90 Hz mode (a later push once 72 Hz holds)
- posting anything upstream: candidates are only tagged in the ledger
