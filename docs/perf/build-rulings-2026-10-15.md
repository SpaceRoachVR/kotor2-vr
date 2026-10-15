# SDD ledger — plan: docs/superpowers/plans/2026-10-15-vr-perf-team.md

Worktree: C:\Users\allen\source\repos\kotor2-vr-perfteam, branch claude/perf-team-2026-10-15, cut from spike/stereo-perf at dbfb748a. The spec has been read.

Scope of this SDD run: the machinery tasks (1, 2, 3, 4, 5, 9, then the operational tasks 6 and 7). It stops before Task 8, which needs Allen in the headset. Tasks 10–12 depend on the headset round's evidence and on Allen's review of the ledger.

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1→T2 | `parsePerfLayer` → `PerfLayerGate.configure` | ok |
| T1→T11 | `readPerfFlag` → fix sessions | ok |
| T2↔T3 | Both edit the `VRSpike.render` world submission (~:4269-4287) | Sequential, so no conflict. The GPU timer must wrap whichever submission runs. Ruling R2. |
| T3→T4 | `kotor2vr.xrframe` user timing → trace selector | The trace must record the `blink.user_timing` category, or the selector finds nothing. Ruling R3. |
| T3→T5 | `PerfWindowReport.gpuMs` → `attributeRungs` | ok (nullable, handled) |
| T4↔T5 | Both edit `perf-round.js` | Sequential, ok |
| T5→T6/T7/T9 | CLI `checkpoint`/`bisect`, record fields → manifest, dry run, `perf-wave` | ok |
| T5 summaryLine | Changes PASS from the 50-FPS gate to the 72 Hz target | Matches the spec acceptance. Ruling R4. |
| T1 self | Tests vs impl: `perflayer` is URL-only, flags use `readLaunchOption` | consistent |
| T2 self | The table test matches the predicate list; Step 5 needs the emulator | Ruling R1 |
| T3 self | Step 5 needs the emulator | Ruling R1 |
| T4 self | The existing test at :9 keeps the default budget | consistent |
| T5 self | Manifest checkpoints: `perf-*` don't exist until T6 | They're marked pending in T6, ok |
| T6/T7 self | Operational (emulator runs), not code | Ruling R5 |
| T7 Step 4 | "push the branch" | Ruling R6 |
| T9 Step 6 | Commit into `perf/integration` while working on the feature branch | Ruling R7 |
| Order | T9 has no dependency on T6–T8 outputs at build time | Ruling R8 |

## Rulings

- **Ruling R1:** the per-task emulator smoke steps (T2 Step 5, T3 Step 5) are folded into Task 7's dry run, which runs every rung once with screenshots. — Subagents running emulators on shared ports (9422/8479) would collide with each other and with other sessions. — If wrong: a gate bug surfaces at T7 instead of at T2, which means one extra fix loop.
- **Ruling R2:** `GpuFrameTimer` begin/end wraps the world submission in both branches: the L0 `renderer.clear()` and the normal `renderer.render`. — L0's GPU time is exactly what the stack-ceiling test needs. — If wrong: L0 shows `gpuMs` null and the attribution falls back to runtime.
- **Ruling R3:** Task 4 also makes sure `perf-round.js` trace capture includes the `blink.user_timing` category. — Without it, the selector the plan mandates can never fire. — If wrong: nothing; the category is cheap.
- **Ruling R4:** `summaryLine` PASS becomes `p90<=13.9 && p99<=20`, the spec target. The old 50-FPS gate stays available in `PerfSampler.sustained50Verdict`. — If wrong: P1-era summaries print FAIL where they used to print PASS, which is display only.
- **Ruling R5:** Tasks 6 and 7 run as one operational dispatch, after all code tasks. Their deliverables are saves, a manifest update, dry-run evidence and the procedure doc, reviewed like the other tasks. Publishing the round page (T7 Step 2) is done by the controller, since it needs Artifact tools. — If wrong: one delayed review.
- **Ruling R6:** no push. Commits stay local on `claude/perf-team-2026-10-15`. — Pushing to the shared remote is an outward side effect Allen hasn't approved for this run. — If wrong: Allen pushes with one command.
- **Ruling R7:** the ledger template and schema are committed on the feature branch. `perf/integration` is created from this branch's tip once the final review is clean, not with Task 9. — The integration branch exists to hold fixes; it should start from the finished machinery. — If wrong: nothing; a branch pointer.
- **Ruling R8:** execution order is 1, 2, 3, 4, 5, 9, then 6+7. — Task 9 is code and needs no runtime evidence, so the emulator work batches at the end. — If wrong: nothing.
- **Ruling R9:** if `vr:check` finds port 8479 busy (another session's `vr:play`), the implementer reports DONE_WITH_CONCERNS without killing that process, and the controller re-runs the check later. — If wrong: one gate is deferred.

## Incidents
- **2026-10-15 ~14:20, Task 1 implementer.** It created a temporary base worktree with a junctioned `node_modules`, then ran `git worktree remove --force` on it. The removal followed the junction and EMPTIED `C:\Users\allen\source\repos\kotor2-vr\node_modules`, which ~38 worktrees and Codex share. Restored 14:33 by robocopying perfteam's fresh `npm ci` (same lockfile; main package files clean). Verified that three, electron and tsc resolve in main and in `kotor2-vr-impl-k`. Other sessions were broken for ~10–15 min. Allen must be told.
- **Ruling R10:** every dispatch from here on carries the rule: never run `git worktree add/remove`, never create or delete junctions, never `rm` outside this worktree. To compare against base, use `git diff`/`git show` or `git worktree`-free checks. — If wrong: nothing; it is pure restriction.
- `node_modules` in perfteam is now a real install, not a junction. Keep it that way.

## Tasks
- Task 1: minor (deferred): the PerfLayer doc comment (RendererOptions.ts:110-117) describes Task 2's not-yet-written layering.
- Task 1: minor (deferred): a test's removeItem is skipped when an assertion throws (harmless; beforeEach resets the store).
- Task 1: complete (commits dbfb748a..202e776f, review clean)
- Env notes: full jest runs out of memory with default workers, so use `npx jest --ci --silent -w 2`. Four failures in `vr-spike-xr-loop.test.ts` are pre-existing on base dbfb748a. `vr:check` is blocked by another session's server on port 8479 (R9).
- Task 2: minor (deferred): L1/L2 are valid only at a stationary checkpoint, because the player's update is skipped. Document it in the Task 7 procedure.
- Task 2: minor (deferred): the PerfLayerGate doc table says "L3 adds placeables, doors", but their meshes are drawn at L1/L2 and only their updates start at L3.
- **Ruling R11:** Task 2's minors #1 (L4 forces grass visible, overriding the user's Grass setting) and #2 (L0 `clear()` skips `xr.updateCamera`, so the head pose goes stale) are fixed inside Task 3:
  - L0 renders a reused empty `THREE.Scene` with the XR camera.
  - `applyPerfLayerGroupVisibility` only ever hides groups.
  - Why: both corrupt the bisect's L0 and L4→L5 deltas, and Task 3 already edits the submission site. If wrong: a small Task 3 scope creep.
- Task 2: complete (commits 202e776f..5288293a, review clean)
- Task 3: minor (deferred): GPU query results still in flight bleed 2–3 samples into the next window (PerfSampler.start keeps the pending queries). Fix: a timer `reset()` in `start()`.
- Task 3: minor (deferred): the `vr-first-person-body.test.ts:387-393` "restore in finally" assertion now matches the GPU-timer finally, so it is partly vacuous. Assert on the contiguous restore text.
- Task 3: minor (deferred): at L0 the rig's matrixWorld is not refreshed (the empty scene skips the camera parent update), so the R11a comment overstates it. Optionally call `scene.updateMatrixWorld()`.
- Task 3: minor (deferred): no guard test for R11b ("never assigns visible=true"). A source-slice test would do.
- Task 3: minor (deferred): disjoint is checked before availability, a narrow race.
- Task 3: complete (commits 5288293a..c52561f3, review clean)
- Task 4: minor (deferred): the xrframe selector isn't filtered to the renderer main thread (perf-trace.js:134-150), so a second renderer would double-count frames. A duplicate open begin overwrites silently. No test covers an unmatched end.
- Task 4: complete (commits c52561f3..8ffe8ece, review clean)
- **Ruling R12** (Task 5 Important #1 vs the plan's manifest table, which runs rungs 0–5 on every Peragus checkpoint and rest+walk at L3–L5): the spec wins. It says the L0–L5 ladder runs on Peragus, and L3–L5 on each other set, with ~30 min of headset time. The manifest gets a per-set `ladderCheckpoint`: the set's `rungs` run only on that checkpoint, every other checkpoint in the set runs L5 only, and `walk`/`talk` windows run only at L5 (rest everywhere else). `freshPage` loses its redundant double boot. A `--dry` flag prints the plan and an estimated wall time. — If wrong: fewer data points on secondary checkpoints; a later round can rerun them via `bisect <set>`.
- **Ruling R13** (Task 5 minor): a `pending: true` entry is skipped only when its save is absent. Once Task 6/8 creates the save, it runs without anyone editing the manifest. — If wrong: nothing.
- Task 5: Fixing in round 1: Important #1 (R12), #2 (perflayer leak warning + restore), #3 (missing rungs in attribution); minors: perflayer check before enter-vr, the checkpoint error message, missing cpuMs → stage null, `--budget` validation.
- **Ruling R14:** after R12, `bisect all` estimates ~39 min today and ~66 min once every benchmark save exists, against the spec's ~30 min. Accepted: the round is driven set by set (`bisect peragus` ≈ 21 min first, then the others), splittable across two headset sittings. Coverage is not cut further, because 60 s windows are a spec constraint. — If wrong: Allen spends a second sitting.
- Task 5: fix round 1/5 (7 addressed + R12/R13, 0 open; commits fbbc2bdb..c89295bd)
- Task 5: minor (deferred): the SIGINT handler doesn't halt the stop loop (check `interrupted` at the top of the loop). The 5 s restore timer is never cleared. A ladder checkpoint whose stops all failed is absent from the attribution table (it is named in the failed-stops line).
- Task 5: complete (commits 8ffe8ece..c89295bd, review clean after round 1)
- **Ruling R15:** `deltaMs = B.p90 − mean(A1.p90, A2.p90)`. B is the flag OFF, so a positive delta means the fix saves time. The controller's dispatch had the sign backwards; the implementer's version is correct. — If wrong: every verdict inverts, which the wave tests would show.
- **Ruling R16:** a real gain together with a suite regression gives `inconclusive`, not `rejected`. A suite run with all flags on can't pin the regression on one flag, so the next round A/Bs it on the regressing set. — If wrong: one extra round per such flag.
- **Ruling R17:** a wave round estimates ~32 min now, ~50 min with every save. It is driven set by set like the bisect (R14). — If wrong: a second sitting.
- Note: the `PERFORMANCE-AUDIT-2026-10-14.md` audit is untracked in the main checkout (someone else's file). The workflow's args point at the main-checkout path; it is not copied into this branch.
- **Ruling R18:** the critics run sequentially (one emulator at a time), each with its own CDP port 9480+i, asset port 8520+i, and a userRoot/userDataDir under %TEMP%. %TEMP% is explicitly allowed in SAFETY. — Four emulators on one 3060 contend for the GPU and collide on 8479 and the saves. Running in sequence costs wall time, not agents. — If wrong: the Verify phase is slower.
- Task 9: Fixing in round 1: Important 1 (vacuous regression baseline), 2 (drift ignores `after`), 3 (the ledger re-run wipes results), 4 (critic isolation per R18); minors 5 (wave-1 check prefers the critic's refuted verdict; empty files), 6 (lowercase flag ids + STATE echoes the flags the engine read), 7 (targetHz mismatch → inconclusive), 8 (covered by R18; the critic must not refute on emulator timing alone).
- Task 9: fix round 1/5 (7 addressed, 0 open; commits 62677d12..0218a08a)
- Task 9: minor (deferred): a wave-1 id unknown to both judged and ranked skips the refuted/bigBet check. The SAFETY "outside your worktree" line sits next to the %TEMP% carve-out. Conversation never matches a bisect baseline (talk vs rest). The baseline regression comparison doesn't check targetHz. Critics copying saves into a temp userRoot is unverified.
- Task 9: complete (commits c89295bd..0218a08a, review clean after round 1)
- **Ruling R19:** Tasks 6+7 run as one operational dispatch, isolated:
  - its own CDP port 9490 and asset port 8530 (another session holds 8479)
  - a temp userRoot holding COPIES of the needed checkpoint saves
  - new perf-* saves are copied additively into `%LOCALAPPDATA%\Kotor2VR\saves` (never overwrite, never delete)
  - the dry run covers `bisect peragus` (the full L0–L5 ladder, which also discharges R1's per-rung smoke checks for Tasks 2/3) and at least one L5-only set
  - checkpoints it can't create are left pending for Allen (Task 8 Step 2)
  - If wrong: missing checkpoints are created during the headset round instead.
- **Ruling R20** (cross-task, from the Task 6-7 review): `PerfSampler.targetHz` is the 50 Hz acceptance floor, not the refresh rate. The refresh rate is `runtimeRates.runtimeReportedHz`, which is null on Chrome/VDXR and before Enter VR. Decision:
  - The tools carry `refreshHz` = runtimeReportedHz when it is finite, else the declared `--refresh-hz` (default 72), plus `refreshHzSource: 'runtime'|'declared'`.
  - Records, the STATE echo, the traceWindow budget (1000/refreshHz), wave A/B/A, and the baseline mismatch checks all use `refreshHz`.
  - `targetHz` stays in records, labelled as the acceptance floor.
  - `summaryLine` prints the real refreshHz and its source, not a hard-coded "72".
  - The doc's setup check becomes "runtime 72 if reported, else Allen confirms 72 Hz in VD + `note`".
  - The plan's never-implemented "refuse to label a round 72 Hz" constraint is satisfied by `summaryLine` printing the refreshHz source.
  - If wrong: a declared rate is trusted over measurement, but the source is always recorded.
- **Ruling R21:** the desktop mirror stays in L5, because it is the shipped default (af4b117f). The procedure says it is on, that the L4→L5 delta includes it, and adds one extra L5 window with `mirror=off` per set if Allen streams without it. — If wrong: one extra window.
- Task 6-7: fix round 1 is given to a FRESH sonnet implementer instead of resuming. The original's context is about 370k tokens, so resuming is wasteful; the report file carries the memory.
- Task 6-7: fix round 1/5 (5 addressed incl. R20/R21, 0 open; commits 2fde5a7a..8e617373)
- Task 6-7: minor (deferred): the ModuleArea L<3 room-resolution tests are regex source slices; perf-theater was not created (time-box); the perf-combat ladder spot is pre-fight, so L3/L4 won't exercise combat effects; the perf-turret walk windows are in a turret; PASS thresholds stay at 72 Hz values even if the runtime reports another rate.
- Task 6-7: complete (commits 0218a08a..8e617373, review clean after round 1)

## Final review (dbfb748a..8e617373): With fixes
- **Ruling R22** (Final Important 1): the GPU timer queries and the `kotor2vr.xrframe` user-timing mark run ONLY while a measurement switch is on (`VRSpike.perf.instrument`, default false), which perf-round's measureWindow/traceWindow (bisect/wave/window/trace) turn on before measuring. Normal VR play does zero extra per-frame work. — Why: the spec's overriding constraint is that normal play is unchanged. — If wrong: the 60 s auto-reports in casual play lack gpuMs.
- Final fix wave (ONE dispatch):
  - Imp 1 (R22)
  - Imp 2: the wave suite uses the set's own windows, and the `TALK now` prompt is printed in bisect and wave
  - the T2 PerfLayerGate table line (must-fix)
  - Minors 1–8: L0 early-branch conditioned on stage; Phase 0 naming; profiled window in the procedure; gpu column wording; L4 also hides the effects/weather_effects/spell_instances groups; ledger wording plus `wave --predicted/--baseline` printing the confirmFlag verdict; an npm `vr:perf:test` script; global `--budget` parsing
  - T9 one-liner: a wave-1 id unknown to judged and ranked gets flagged
  - T5 one-liner: `if (interrupted) break`
- Final fix wave: re-review clean (10/10 addressed; commits 8e617373..013724ba).
- Final: parked — `PerfSampler.tick()` still calls `gpuTimer.collect()` every VR frame with instrument off (one empty-array allocation, no GL calls) — **Ruling R23:** parked, not fixed now. Negligible, but strictly against R22's "no extra per-frame work". It is a one-line gate (`if (this.instrument && this.gpuTimer)`), to land with the first fix wave. — If wrong: one tiny allocation per frame until then.
- Final: parked — PerfLayerGate's comment says placeables/doors are "part of the room scene". They are separate groups, room-culled only by their own update, so at L1/L2 the whole module's placeables and doors draw unculled. — **Ruling R24:** parked, and stated explicitly in the handoff, because the Phase 1 analysts must know it when reading the L1→L2→L3 deltas. It goes into the analysis workflow's input packet. — If wrong: L1/L2 GPU costs are misread as room cost.
- **Ruling R25:** the round artifact page (plan Task 7 Step 2) is not published yet. It is published at the start of the Task 8 headset round, when there is real data for it. The dry-run attribution lives in `tools/vr-emulator/evidence/perf/bisect-dryrun*`. — If wrong: nothing; the page is built from the same db either way.
- Out-of-scope (for the Phase 1 packet): the movie/cutscene theater paths are neither GPU-timed nor perflayer-gated. `readRecords` mixes reused round names, so use a fresh `--round` per run.
