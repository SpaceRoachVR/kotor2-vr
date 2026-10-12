# Module-transition memory investigation — 2026-10-05

## Scope and method

This implements the ownership fixes identified while investigating ROADMAP 0.3.
Investigation began October 5; final verification completed October 6.
The acceptance loop starts a fresh new game, enters an emulated Quest 3
immersive session, then alternates `101PER` and `102PER` five times. It does
not load a save for the memory baseline or modify retail assets.

Every sample requires the requested module to finish loading, normal in-game
mode, an active XR session, and more than ten advancing render frames. A forced
CDP garbage collection precedes the reading; `Runtime.getHeapUsage.usedSize`
supplies the JS heap size. Console history remains intact. Uncaught page
exceptions and VR-loop failures invalidate the run. Other console errors are
retained in the JSON evidence rather than silently suppressed.

Compare successive readings of the **same module**. Differences between the
two modules and initial cache population are not per-transition leaks. Geometry
and texture counters describe renderer-tracked allocations, not GPU bytes; the
heap reading does not measure total browser or compositor memory.

## Measured result

The final run completed all ten transitions, with zero uncaught page exceptions
and zero reported VR-loop failures. All samples were presenting XR with advancing
frames. Final same-module deltas compare cycles four and five, so each interval
contains **two module transitions**:

| Revisiting | Heap delta | Geometry delta | Texture delta | Scene-node delta |
|---|---:|---:|---:|---:|
| `101PER` | +1.1 MB | 0 | 0 | 0 |
| `102PER` | +3.2 MB | 0 | 0 | +2 |

For a longer interval, cycles three through five average +1.7 MB (`101PER`) and
+1.95 MB (`102PER`) per cycle. The earlier pre-fix sweep measured +66.9 and
+72.0 MB respectively. Its renderer was affected by the detached-emitter error,
so its GPU counts are not a valid comparison. After the first emitter/model
repair, an intermediate sweep still measured +74.4/+78.1 MB; the other ownership
fixes removed most of that growth.

Final warm readings are 778.8 MB (`101PER`) and 790.7 MB (`102PER`). Geometry and
texture counts remain constant after cycle two: 751/347 and 1790/1294
respectively. Shader programs and renderer counters can vary between runs as
assets and animated objects become visible; these are same-run comparisons.
Scene nodes in `102PER` vary between 5494 and 5500, so no universal scene-node
plateau is claimed.

Every sample has zero stale waypoint helpers and zero uncached script
situations. Waypoint helpers alternate with the actual area count (67/20),
rather than accumulating to the previously observed 459. Live VM registry counts
are approximately 2188/2393 after warm-up and reset on module teardown; a
between-load inspection found only the single global menu script. The player's
damage, visual, and innate racial effects remain at one each across all loads.

**The remaining JS heap growth is still open.** This result establishes stable
renderer allocations in this loop and a substantial reduction in retained heap;
it does not establish a zero-growth heap plateau or prove long-session campaign
safety. No console clearing or experimental reference cuts were used in the
acceptance run.

Raw local evidence is in
`tools/vr-emulator/evidence/memory-2026-10-05-validated/memory-growth.json`
and `area-ownership.json`. The earlier sweeps remain alongside it. Evidence
directories are ignored; the numeric summary above is the portable record.

## Verification

- Jest: **263 suites, 2,508 tests passed**, including action code, resource
  ownership, retained-player state, and failed saved-stack allocation.
- Emulator Node tests: **109 passed**.
- `npx tsc --noEmit -p tsconfig.kotorjs.json`: passed.
- `npm run webpack:dev`: passed; existing bundle warnings remain.
- `npm run vr:check`: **28/28 passed** against the rebuilt bundle with the
  explicit save below. The Bash gate observed authored refusal on
  `MedClosetDoor`; successful dispatch and repeat-start rejection also have unit
  coverage. The live gate does not claim that refusal proves a successful swing.
- `git diff --check`: passed. The eight pre-existing untracked NSS files remain
  untouched; no commit, push, or release is part of this change.

To reproduce from the checkout (run the two browser jobs sequentially):

```powershell
npm run webpack:dev
node tools/vr-emulator/probe-memory-growth.js --cycles 5 --out tools/vr-emulator/evidence/memory-repeat
npm run vr:check -- --save "Saves/000708 - Game707"
node --test tools/vr-emulator/*.test.js
```

The full Jest run excludes nested checkouts under `.worktrees` and
`.claude/worktrees`; it does not exclude any test in this checkout. The live VR
gate used a separate asset service on port 8491 while the memory probe ran,
avoiding contention with its service on port 8479.

## Ownership defects repaired

- Nested runtime models now run their own teardown, releasing their cached-MDL
  subscription and emitter state. The previous parent-bound recursion left
  detached emitters updating and could interrupt XR frames.
- Chunk emitters own and release their temporary source model, cloned geometry,
  and material arrays. Failure and completion after unload also release them.
  Sprite `Points` allocations now follow the same model-disposal path as meshes.
- Skinned meshes release bone textures on unload. Skeleton replacement releases
  the previous texture and moves borrowing force-shield meshes to the new
  skeleton before disposal.
- Retained party creatures refresh their module registrations and scripts
  without rehydrating their own effects, inventory, and equipment. Innate racial
  effects are reused. Fresh/save-created creatures still hydrate normally.
- Equipment models and parentless head source models are released before
  replacement, including droid equipment with no hand attachment.
- Lifecycle logs record primitive object identity (`found`, ResRef, Tag, ID,
  Type), avoiding console handles that retained whole unloaded object graphs.
- Waypoints own their debug helpers; unload removes those helpers from the
  global group. Area unload releases its path helper and fog texture; repeated
  disposal and incomplete path loads are covered.
- Saved script situations read their instruction pointer and restore the
  stack before registering a VM instance. A rejected restore can no longer
  leave an abandoned instance in the global registry. Valid continuations keep
  their existing restoration behavior.

## Regression harness changes

`vr:check -- --save "Saves/<directory>"` can select a reproducible fixture
explicitly. Loading and journal verification use the same selected save, and a
load rejection is reported immediately. The local quicksave was unsuitable for
this run; the passing gate uses `Saves/000708 - Game707`.

The Bash probe now approaches real locked module objects, refreshes the normal
selectable pool, and builds their authored prompt. It checks that a swing is
blocked before an explicit Bash selection, then dispatches that selection once
and rejects a second start. A prompt without Bash proves refusal; unavailable
or invalidated prompts cannot pass as refusal. Equipment and position are
restored in `finally`. This corrects the previous stale selectable-pool probe
to match the existing interaction contract; it does not invent a gameplay action.

## Acceptance boundary

This is a repeated Peragus ownership test and an emulator regression gate.
Longer campaign transitions, party variations, sustained real-headset memory,
comfort, stereo presentation, and native compositor performance remain separate
acceptance work. Existing NPC saved-action restoration errors
(`ActionDoCommand` / `NWScriptStack.FromActionStruct`) and missing-file probes
are recorded in memory evidence; these fixes do not establish campaign parity.
