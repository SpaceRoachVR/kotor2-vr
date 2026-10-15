# VR Performance Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the measurement and team machinery for reaching native 72 Hz:
- a bisect ladder and per-stage frame timing
- a headset attribution round
- an 8-agent analysis workflow that produces a ranked ledger
- a repeatable fix-wave loop

**Architecture:**
- **App side:** two new launch options read through `readLaunchOption`. `perflayer`
  (L0–L5) switches whole engine layers off at existing switch points. `perf.<name>`
  turns individual fixes on or off.
- **PerfSampler:** gains a GPU timer and a per-frame user-timing mark.
- **Tool side:** `perf-round.js` gains `bisect`, `note`, `checkpoint` and `wave`
  subcommands. They are built on pure helper modules tested with `node:test`.
- **Team:** Phase 1 is a Workflow script. Phase 2 fixes are worktree sessions that
  merge into `perf/integration`.

**Tech Stack:**
- TypeScript (KotOR.js fork, three.js r149, WebGL1)
- Jest (`src/tests/*.test.ts`)
- Node CDP tools under `tools/vr-emulator/`, tested with `node --test`
- the Claude Code Workflow tool

**Spec:** `docs/superpowers/specs/2026-10-15-vr-perf-team-design.md`

**Repo:** `C:\Users\allen\source\repos\kotor2-vr`. Execution happens in a worktree
cut from `spike/stereo-perf`, because other sessions and Codex share the main
checkout. `docs/` is gitignored, so docs need `git add -f`.

## Global Constraints

- **Target:** p90 ≤ 13.9 ms and p99 ≤ 20 ms over 60 s unprofiled windows, at 72 Hz,
  with SSW off. The same target must hold in two consecutive headset rounds.
- **No visual trade-offs.** Resolution, render scale, shadows, LOD, grass density,
  post-processing, authored animation and lighting are unchanged. With
  `perflayer` absent and every confirmed `perf.*` flag on, the game must render
  identically to today.
- **Proof:** only headset numbers confirm a fix. The emulator may only refute one.
- **Launch-option naming:** `perflayer=l0..l5` (absent means `l5`, i.e. normal play),
  and `perf.<name>=on|off`.
- **Headset rounds run at 72 Hz.** `vr.perf.targetHz` is the 50 Hz acceptance floor,
  not the refresh rate. The driver records `refreshHz`: the runtime's
  `runtimeReportedHz` when reported, else the `--refresh-hz` (default 72) the lead
  declares after Allen confirms 72 Hz with SSW off in Virtual Desktop (Chrome/VDXR
  reports null). `refreshHzSource` says which (R20).
- **Gates for every code task:**
  - `npx jest --ci --silent`
  - `npx tsc --noEmit -p tsconfig.kotorjs.json`
  - `npm run webpack:dev`
  - `node --test tools/vr-emulator/*.test.js`
  - `npm run vr:check`, never at the same time as `vr:play` (both bind port 8479)
- **Shared-tree rules:**
  - Never overwrite another session's or Codex's branch; rebase onto
    `codex/grass-wind-perf` if it lands first.
  - The round driver runs via Bash `run_in_background`, and a Monitor only ever
    tails its log.
  - Reboot the page between rungs and between checkpoints.

## Review Focus

1. **A bisect rung leaking into normal play.** `readLaunchOption` falls back to
   `localStorage`, so a stray `kotor2vr.perflayer` would silently strip the game in
   a later manual session. Expectation: `perflayer` is read from the URL only.
   Pinned by Task 1's `ignores localStorage for perflayer` test.
2. **The GPU timer extension missing, or a disjoint event mid-window.**
   Expectation: `gpuMs` is `null` or the window is flagged, never a crash or a
   bogus 0 ms. Pinned in Task 3.
3. **A checkpoint name that matches no save.** Expectation: `bisect` aborts that
   set, prints the available names, and appends no record for it. Pinned in
   Task 5's `bisectPlan rejects unknown sets` test, and in Task 5 Step 6, which
   checks before any window.
4. **An untrustworthy cadence window** (`xrCadence.integrity.trustworthy === false`,
   e.g. a duplicate engine update). Expectation: it is excluded from attribution
   and marked, not averaged in. Pinned by Task 5's
   `attributeRungs skips untrustworthy windows` test.
5. **A flag-off A/B window recorded at a different position or view.**
   Expectation: `wave` stands at the checkpoint pose with no walk, and records the
   `before`/`after` STATE player position. Attribution flags a pair whose
   positions differ by more than 0.5 m. Pinned in Task 9.

---

## Phase 0 — tooling (no headset)

### Task 1: `perflayer` and `perf.<name>` launch options

**Files:**
- Modify: `src/utility/RendererOptions.ts`, adding the parsers after
  `parseXRFramebufferScale` (around :150)
- Test: `src/tests/renderer-options-perf.test.ts`

**Interfaces:**
- Produces:
  - `export type PerfLayer = 0 | 1 | 2 | 3 | 4 | 5;`
  - `export function parsePerfLayer(search: string): PerfLayer`. It reads the URL
    only. Valid values are `l0`..`l5` (case-insensitive); anything else, or absent,
    returns `5`.
  - `export function readPerfFlag(search: string, name: string, defaultOn: boolean): boolean`.
    It reads `perf.<name>` through `readLaunchOption`, so the localStorage fallback
    is allowed for fix flags. `on`/`1`/`true` return true, `off`/`0`/`false` return
    false, and anything else returns `defaultOn`.

- [ ] **Step 1: Write the failing tests.**

  ```ts
  test('parsePerfLayer reads l0..l5', () => {
    expect(parsePerfLayer('?perflayer=l0')).toBe(0);
    expect(parsePerfLayer('?perflayer=L3')).toBe(3);
  });
  test('parsePerfLayer defaults to 5 for absent or garbage', () => {
    expect(parsePerfLayer('')).toBe(5);
    expect(parsePerfLayer('?perflayer=l9')).toBe(5);
  });
  test('ignores localStorage for perflayer', () => {
    localStorage.setItem('kotor2vr.perflayer', 'l0');
    expect(parsePerfLayer('')).toBe(5);
    localStorage.removeItem('kotor2vr.perflayer');
  });
  test('readPerfFlag honours on/off and default', () => {
    expect(readPerfFlag('?perf.batching=off', 'batching', true)).toBe(false);
    expect(readPerfFlag('?perf.batching=on', 'batching', false)).toBe(true);
    expect(readPerfFlag('', 'batching', true)).toBe(true);
  });
  ```

- [ ] **Step 2: Run `npx jest src/tests/renderer-options-perf.test.ts`.**
  Expected: FAIL, the functions are not exported.
- [ ] **Step 3: Implement both functions in `RendererOptions.ts`.**
  `parsePerfLayer` uses `new URLSearchParams(search).get('perflayer')` directly,
  not `readLaunchOption`, wrapped in try/catch like the existing parser.
- [ ] **Step 4: Re-run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(perf): perflayer and perf.<name> launch options`.

### Task 2: Apply the bisect layers at the engine switch points

**Files:**
- Create: `src/vr/PerfLayerGate.ts`
- Modify:
  - `src/vr/VRSpike.ts`: read the layer in `install` (~:969); the L0 clear at the
    world submission (~:4281); skip the UI passes (:4252-4259) below L5
  - `src/module/ModuleArea.ts`: one room in `updateRoomVisibility` INGAME
    (~:960-990); skip creature, party, placeable and door updates in `update`
    (~:441-456)
  - `src/module/ModuleRoom.ts`: skip grass in `update` (:192-207) and in the
    grass visibility in `show` (:215)
  - `src/three/odyssey/OdysseyModel3D.ts`: skip the emitter tick (:671-673)
  - `src/game/GameState.ts`: skip `updateWorldSystems` lights and wind
    (:5888-5894); skip audio (:6490) and `MenuManager` cursor work (:6441) below
    L5; hide the creature and party groups below L3, and the emitter, grass and
    light groups below L4
- Test: `src/tests/perf-layer-gate.test.ts`

**Interfaces:**
- Consumes: `parsePerfLayer` (Task 1).
- Produces: a `PerfLayerGate` with these static members:

  | Member | Meaning |
  |---|---|
  | `layer: PerfLayer` (default 5) | The active rung |
  | `configure(search: string): void` | Reads the layer from the URL |
  | `rendersWorld()` | `layer >= 1` |
  | `allRooms()` | `layer >= 2` |
  | `characters()` | `layer >= 3` |
  | `effects()` | `layer >= 4`: emitters, grass, lights, wind |
  | `playLayer()` | `layer >= 5`: cursor, audio, VR UI passes, desktop mirror |
  | `active()` | `layer < 5` |

  The ladder is cumulative: each rung includes everything below it.

- [ ] **Step 1: Write a failing table test** asserting every predicate for each of
  layers 0–5 (6 × 6 expectations), and that `configure('')` leaves layer 5.
- [ ] **Step 2: Run it.** Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `PerfLayerGate.ts`.** Then add one guard at each listed
  switch point.
  - Each guard is a single `if (PerfLayerGate.x())` around the existing call.
    Never restructure the call site.
  - At L0, `VRSpike.render` calls `renderer.clear()` instead of
    `renderer.render(scene, camera)`, but still calls `perf.recordXRRender`.
  - At L0, `hooks.update` still runs so cadence integrity stays meaningful;
    `Module.tick` is not skipped.
- [ ] **Step 4: Run the table test plus all the gates.** Expected: PASS, and
  `vr:check` is green with `perflayer` absent.
- [ ] **Step 5: Smoke-test every rung in the emulator.**
  1. Run `node tools/vr-emulator/perf-round.js reload perflayer=lN` for N=0..5.
  2. Run `load medbay-swept`, then `state`.
  3. Take a `screenshot.js` image per rung into `evidence/perf/bisect-dryrun/`.

  Expected: L0 is an empty clear, L1 one room, L2 the linked rooms, L3 adds
  characters, L4 effects, and L5 is identical to today's baseline screenshot. No
  page exceptions.
- [ ] **Step 6: Commit** `feat(perf): perflayer bisect gates at engine switch points`.

### Task 3: GPU frame timer and per-frame user-timing mark in PerfSampler

**Files:**
- Create: `src/vr/GpuFrameTimer.ts`
- Modify:
  - `src/vr/PerfSampler.ts`: add `gpuMs` to `PerfWindowReport` (:23-55); fill
    it in `report()` (:267); create the timer in `attach(renderer)` (:172)
  - `src/vr/VRSpike.ts`: `begin()` before the world submission, `end()` after it
    (~:4269-4287); a `performance.mark`/`measure` around `frame` (:1419-1538)
- Test: `src/tests/gpu-frame-timer.test.ts`

**Interfaces:**
- Produces:
  - `class GpuFrameTimer { constructor(gl: WebGLRenderingContext | WebGL2RenderingContext); readonly supported: boolean; begin(): void; end(): void; drain(): number[]; disjointSeen: boolean }`
  - For WebGL1 it uses `EXT_disjoint_timer_query` (`createQueryEXT`,
    `beginQueryEXT`, `getQueryObjectEXT`). For WebGL2 it uses
    `EXT_disjoint_timer_query_webgl2`, ported from
    `tools/xr-benchmark/src/GpuTimer.ts`.
  - `drain()` returns the completed query results in ms and deletes the queries.
  - `PerfWindowReport.gpuMs: { p50: number; p90: number; p99: number; samples: number; disjoint: boolean } | null`
  - User-timing measure name: `kotor2vr.xrframe`, one per `VRSpike.frame`
    invocation.

- [ ] **Step 1: Write failing tests with a fake WebGL1 context and extension:**
  - the extension is missing → `supported === false`, and `begin`/`end`/`drain`
    are no-ops returning `[]`
  - a result becomes available on a later poll → `drain()` returns
    `[elapsedNs / 1e6]`
  - `GPU_DISJOINT_EXT` reads true → `disjointSeen === true`, and that batch's
    results are discarded
  - `begin` twice without `end` → a single active query
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `GpuFrameTimer`.** Then wire it into PerfSampler: its
  `report()` computes percentiles over the drained samples, and returns `null`
  when the timer is unsupported or has zero samples.
- [ ] **Step 4: Run all the gates.** Expected: PASS.
- [ ] **Step 5: Check the emulator.** Run `perf-round.js window gpu-check 10` on
  `medbay-swept`. Expected: `report.gpuMs` is non-null with `samples > 0`, or
  `null` if the emulator's GPU lacks the extension; either result is recorded.
- [ ] **Step 6: Commit** `feat(perf): GPU frame timer and xrframe user timing`.

### Task 4: Make `perf-trace.js` budget- and callback-correct

**Files:**
- Modify:
  - `tools/vr-emulator/perf-trace.js`: the budget at :36, `analyzeTrace` at :122,
    the selector at :129
  - `tools/vr-emulator/perf-round.js:227`: pass `budgetMs`
- Test: `tools/vr-emulator/perf-trace.test.js`

**Interfaces:**
- Produces: `analyzeTrace(events, { seconds = null, top = 25, budgetMs = 1000 / 72 } = {})`.
  - It returns an `xrFrame` stats block built from `blink.user_timing` events
    named `kotor2vr.xrframe` (Task 3).
  - It returns `xrFrame: null` with `xrFrameSource: 'generic'` when those events
    are absent, keeping the old generic selector as the labelled fallback.
- Consumers: `perf-round.js` passes `budgetMs: 1000 / refreshHz` (R20; not `targetHz`).

- [ ] **Step 1: Write failing tests:**
  - `budgetMs: 1000/90` counts the 20 ms and 31 ms tasks as over budget, and the
    5 ms task as not
  - a synthetic trace with three `kotor2vr.xrframe` measures of 10, 12 and 40 ms
    gives `xrFrame.p50 === 12`, `xrFrame.max === 40` and
    `xrFrameSource === 'user_timing'`
  - the existing test at :9 still passes with the default budget
- [ ] **Step 2: Run `node --test tools/vr-emulator/perf-trace.test.js`.**
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement the changes.**
- [ ] **Step 4: Re-run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(perf): trace budget follows refresh; xrframe user-timing selector`.

### Task 5: `bisect`, `note` and `checkpoint` subcommands with an attribution table

**Files:**
- Create:
  - `tools/vr-emulator/perf-bisect.js` (pure helpers, no CDP)
  - `tools/vr-emulator/perf-bisect.test.js`
  - `tools/vr-emulator/perf-benchmarks.json`
- Modify: `tools/vr-emulator/perf-round.js`:
  - `main()` dispatch and the usage string (:317-332)
  - `measureWindow` (:187) gains the `rung`, `set`, `refreshHz` and `refreshHzSource` fields (`targetHz` is kept; it is the 50 Hz floor)
  - `STATE` (:64) echoes `perflayer`
  - `summaryLine` (:241) uses the 72 Hz target: `p90<=13.9 && p99<=20` is PASS

**Interfaces:**
- `perf-benchmarks.json` maps each set to
  `{ checkpoints: string[], rungs: number[], windows: ('rest'|'walk'|'talk')[] }`:

  | Set | Checkpoints | Rungs |
  |---|---|---|
  | `peragus` | `medbay-swept`, `t3-hangar`, `droids-cleared` | `[0,1,2,3,4,5]` |
  | `ebon-hawk` | `ebon-main-hold-open`, `ebon-engine-room-open` | `[3,4,5]` |
  | `conversation` | `kreia-awakened` (talk), plus `perf-theater` from Task 6 | `[3,4,5]` |
  | `combat` | `perf-combat`, `perf-turret`, `perf-swoop` from Task 6 | `[3,4,5]` |
  | `telos` | `perf-telos-a`, `perf-telos-c` from Task 6 | `[3,4,5]` |

- Produces, in `perf-bisect.js`:
  - `bisectPlan(benchmarks, setNames) → {set, checkpoint, rung, window}[]`.
    It throws `Unknown benchmark set: <name>` for an unknown set.
  - `attributeRungs(records, budgetMs) → {set, checkpoint, firstOverRung, stage, rows}[]`:
    - `stage` is one of `'sim'|'render'|'gpu'|'runtime'|'none'`
    - `stage` is the component with the largest p90 at `firstOverRung`: sim and
      render come from `cpuMs`, gpu from `gpuMs`, and runtime is
      frametime p90 − max(sim + render, gpu)
    - windows with `xrCadence.integrity.trustworthy === false` are skipped and
      listed in `rows[].excluded`
  - `formatAttribution(table) → string`: a markdown table.
- New CLI subcommands:
  - `bisect <set|all>`: for each plan row, `reload perflayer=l<rung>`, then `load`,
    `enter-vr`, a 10 s settle, and a 60 s window. At the end it prints
    `formatAttribution`.
  - `note <text...>`: appends `{at, round, label:'note', text}`. Used for the
    Virtual Desktop overlay readings Allen calls out.
  - `checkpoint <name>`: calls
    `K.SaveGame.SaveCurrentGame("VRPT-20260824-E2E " + name)`.
  - `attribution`: no CDP; reads the round JSONL and prints the table.

- [ ] **Step 1: Write failing `node:test` tests:**
  - `bisectPlan rejects unknown sets`
  - `bisectPlan expands peragus to 3 checkpoints × 6 rungs`
  - `attributeRungs picks first rung whose frametime p90 > budget`, using
    fixtures at rungs 0/1/2 with p90 of 8/12/20 ms → `firstOverRung === 2`
  - `attributeRungs names gpu stage when gpuMs.p90 dominates`
  - `attributeRungs skips untrustworthy windows`
  - `attributeRungs reports none when all rungs pass`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `perf-bisect.js`, then the CLI wiring.** `bisect`
  resolves each checkpoint against `K.SaveGame.GetSaveGames()` up front (Review
  Focus 3) before running any window.
- [ ] **Step 4: Run the tests and the gates.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(perf): bisect/note/checkpoint/attribution subcommands`.

### Task 6: Benchmark checkpoints for the missing sets

There is no code here. This task produces saves and updates the manifest.

- [ ] **Step 1: Create the checkpoints reachable in the emulator.**
  - `perf-turret`: reach the 107PER turret minigame with
    `playthrough.js --resume` from `hangar-door-open`, then run
    `perf-round.js checkpoint perf-turret`.
  - `perf-theater`: the theater shot on the Peragus route that is closest to
    `kreia-awakened` or `harbinger-*`.
  - `perf-combat`: a fight with several active effects on the Peragus route
    (e.g. the `droids-cleared` approach), saved just before it starts.
- [ ] **Step 2: Have Allen create the rest.** `perf-telos-a` (231tela),
  `perf-telos-c` (231telc) and `perf-swoop` are not reachable by the harness.
  Allen loads his own saves, and the lead runs
  `perf-round.js checkpoint perf-telos-a` (and the others) at the start of the
  Phase 0 round. Any checkpoint still missing comes out of
  `perf-benchmarks.json` for that round and is recorded as a gap in the round
  notes.
- [ ] **Step 3: Verify.** `node -e` lists `GetSaveGames()` names over CDP.
  Expected: every checkpoint in the manifest is present, or explicitly marked
  `"pending": true`.
- [ ] **Step 4: Commit** `chore(perf): benchmark manifest checkpoints`.

### Task 7: Emulator dry run and the round page

- [ ] **Step 1: Run the full dry run.** Run
  `perf-round.js --round bisect-dryrun bisect all` via Bash `run_in_background`,
  and Monitor only a `tail -f` of its log.
  Expected: every plan row produces one record; the attribution table prints;
  there are no page exceptions in `console-tail.js` output.
- [ ] **Step 2: Publish the round page.**
  - Load `artifact-design` and `artifact-capabilities`.
  - Publish a "VR Perf Rounds" artifact that shows the per-set, per-rung stacked
    sim, render, GPU and runtime ms against a 13.9 ms line.
  - Give it a `db` collection `rounds`. The lead writes each round's attribution
    rows there with ArtifactData. The page itself is never republished per round.
- [ ] **Step 3: Write the procedure.** Add a "Bisect round procedure" section to
  `PHASE0-STEREO-SPIKE.md`, covering:
  - the headset at 72 Hz with SSW off
  - the VD overlay on, with `note` readings at each rung
  - the command sequence
  - the reboot-between-rungs rule
- [ ] **Step 4: Commit** `docs(perf): bisect round procedure` and push the branch.

### Task 8: Headset bisect round (Allen, ~30 min)

- [ ] **Step 1: Check the setup.** After Enter VR, `perf-round.js state` reports
  `runtimeReportedHz` 72, or null on Chrome/VDXR, in which case Allen confirms 72 Hz
  with SSW off in Virtual Desktop and the lead runs
  `perf-round.js note "refresh 72 Hz, SSW off (VD)"`. `presenting` possible, the
  driver on CDP 9422, and every bisect/wave command passes `--refresh-hz 72`.
- [ ] **Step 2: Create the pending checkpoints** from Task 6 Step 2 while Allen is
  in the headset.
- [ ] **Step 3: Run the ladder.** Run `perf-round.js --round bisect-<date> bisect all`
  in the background; the lead relays VD overlay readings with `note`.
- [ ] **Step 4: Take one profiled window per set.** Run
  `perf-round.js trace <set>-profile 20`, kept separate from the unprofiled
  windows.
- [ ] **Step 5: Publish the results.** Write the attribution rows to the round
  page db, and save the markdown table to `docs/perf/bisect-<date>.md`.
  Expected: every set has a `firstOverRung` and a `stage`.
- [ ] **Step 6: Apply the early branch.** If any L0 row has `firstOverRung === 0`,
  record **"stack ceiling suspected"**. The XR-runtime track then leads wave 1,
  per the spec.

## Phase 1 — analysis workflow

### Task 9: Ledger, hypothesis schema, analysis workflow, and the `wave` driver

**Files:**
- Create:
  - `docs/perf/ledger.md` (force-add)
  - `docs/perf/hypothesis.schema.json`
  - `.claude/workflows/vr-perf-analysis.js`
  - `tools/vr-emulator/perf-wave.js` with `perf-wave.test.js`
- Modify: `tools/vr-emulator/perf-round.js`, adding the `wave` subcommand

**Interfaces:**
- **Hypothesis schema fields:**
  - `id`
  - `domain`: one of `trace`, `gpu`, `cpu`, `xr-runtime`, `visual`
  - `claim`
  - `evidence: string[]`: file:line references or trace references
  - `expectedMsSaved: {[set]: number}`
  - `confidence`: `low`, `med` or `high`
  - `cost`: `S`, `M` or `L`
  - `falsification`
  - `files: string[]`
  - `bigBet: boolean`
  - `upstreamCandidate: boolean`
- **Ledger columns:** rank, id, claim, ms × conf ÷ cost, verdict
  (`survives`/`weakened`/`refuted`), wave, owner session, flag, headset result,
  status (`proposed`/`building`/`merged-off`/`confirmed`/`rejected`/`removed`).
- **Workflow** `vr-perf-analysis`: 7 roles, at most 10 agents in total (the 5 analysts, the
  critic and the lead; critic instances per hypothesis are capped to keep within 10).
  - Its phases are Analyze, Verify and Rank.
  - Its args are the input packet paths: the attribution table, the
    `bisect-<date>.jsonl`, the trace files, `PERFORMANCE-AUDIT-2026-10-14.md`, the
    P1 notes and the in-flight branch list.
  - The analysts return the schema above. The audit's three unlanded items are
    seeded into the cpu and gpu analyst prompts.
  - The critic runs per hypothesis in `pipeline()`, with the emulator on its own
    port (`--port 9430+i`).
  - The lead ranks and writes `docs/perf/ledger.md` plus a proposed wave 1 of 2–4
    items with disjoint `files`.
- **`perf-wave.js`:**
  - `wavePlan(benchmarks, flags, worstSet) → windows[]`: the whole suite with all
    flags on, then for the worst set an A/B/A for each flag
    (on, `perf.<flag>=off`, on), standing windows only.
  - `confirmFlag(records, flag, predictedMs) → {verdict:'confirmed'|'rejected'|'inconclusive', deltaMs, positionDriftM}`:
    - `confirmed` when the delta is within ±30% of the prediction and no other set
      regresses by more than 1 ms p90
    - `inconclusive` when `positionDriftM > 0.5`

- [ ] **Step 1: Write failing `perf-wave.test.js` tests:**
  - `confirmFlag confirmed within ±30%`
  - `confirmFlag rejected when no gain`
  - `confirmFlag inconclusive on drift`
  - `wavePlan builds A/B/A per flag on worst set only`
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement `perf-wave.js` and the `wave <flags,...> --worst <set>`
  CLI.**
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Write the workflow.** Load `workflow-authoring` and write
  `.claude/workflows/vr-perf-analysis.js` to the interface above. Validate it with
  the schema and a dry-run argument set; that run must not spawn agents.
- [ ] **Step 6: Create the integration branch** with
  `git branch perf/integration spike/stereo-perf`, and commit the ledger template
  and schema to it.
- [ ] **Step 7: Commit** `feat(perf): ledger, analysis workflow, wave driver`.

### Task 10: Run the analysis workflow (needs Task 8's evidence)

- [ ] **Step 1: Run the workflow.** Invoke the `vr-perf-analysis` Workflow with the
  Phase 0 packet. Allen opted into the workflow in the spec.
- [ ] **Step 2: Check the ledger.** Expected:
  - `docs/perf/ledger.md` has every hypothesis with a verdict
  - wave 1 has 2–4 non-refuted items with disjoint files
  - no item reduces visual quality (the visual-guard verdict is attached)
- [ ] **Step 3: Get Allen's approval.** STOP for his review of the ledger and
  wave 1. No fix code is written before he approves.

## Phase 2 — fix waves (repeat per wave)

### Task 11: Wave N

- [ ] **Step 1: Start one fix session per item.** Use `start_session` with
  `use_worktree: true` and `source_branch: perf/integration`. Each brief contains:
  - the ledger row
  - the flag name `perf.<id>`, read through
    `readPerfFlag(location.search, '<id>', false)` until confirmed
  - the falsification baseline
  - the Global Constraints gates
  - the screenshot diff at the 5 fixed poses from Task 2 Step 5 (zero changed
    pixels outside dynamic HUD regions, with `perf.<id>=on` vs `off`)
  - critic approval before merging into `perf/integration`

  Big-bet items get a throwaway spike session instead. It measures in the headset
  at the bisect rungs and merges nothing.
- [ ] **Step 2: Wait for the sessions.** When they report, verify each one's diff
  and critic verdict. Then merge into `perf/integration` and rebuild.
- [ ] **Step 3: Run the wave headset round.** Run
  `perf-round.js --round wave<N> wave <flags> --worst <set>` in the background.
  Write the results to the round page db.
- [ ] **Step 4: Settle each flag with `confirmFlag`.**
  - **confirmed:** merge `perf/integration` into `spike/stereo-perf` with the flag
    default flipped to `true`.
  - **rejected:** leave the flag off and record the reason. The code is removed in
    the wave N+2 cleanup.
  - **inconclusive:** re-test it next round.
- [ ] **Step 5: Check the stop rules.** If two waves in a row show no scene closer
  to 13.9 ms, re-run Task 8 before planning more. A runtime ceiling, a failed big
  bet or a file conflict also means STOP and ask Allen.
- [ ] **Step 6: Re-rank.** Update the ledger, propose wave N+1, and STOP for
  Allen's review.

### Task 12: Close-out (when the target holds twice)

- [ ] **Step 1: Confirm the target.** Two consecutive rounds have every set at
  `p90 ≤ 13.9` and `p99 ≤ 20` (`summaryLine` PASS) at 72 Hz with SSW off.
- [ ] **Step 2: Remove dead code.** Every rejected flag's code is gone, and every
  confirmed flag defaults on. `perflayer` stays as a diagnostic.
- [ ] **Step 3: Update the ROADMAP.** Replace the Phase 0 caveat
  (`ROADMAP.md:15-17`) with the round numbers, and tag the upstream candidates in
  the ledger.
- [ ] **Step 4: Run the gates and commit** `docs(perf): 72 Hz reached`.
