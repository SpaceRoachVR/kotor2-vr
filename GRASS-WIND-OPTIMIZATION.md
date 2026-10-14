# Grass wind optimization — 2026-10-14

Approved scope: reduce CPU work without reducing grass density, changing its
motion, lowering rendering quality, or changing gameplay.

## Change

`WindManager` caches the existing 32 quantized sine/cosine values in Float64
tables and evaluates the same rotation expression with scalar components.
Sampling APIs accept optional caller-owned output vectors; default calls retain
fresh-vector ownership. `ModuleRoom` supplies its existing grass scratch vectors
for global and point wind sampling. Invalid sampling positions, scales and
output objects fail before output mutation.

No change to turbulence generation, quantization, wind levels, delta clamping,
point-source lifetime/falloff, grass integration, blade count, trample, shaders,
instance transforms, buffer uploads or rendering settings. Blade-position
caching and particle optimizations remain separate work.

## Evidence

- Exact old/new rotation comparisons over 8,192 angle-pair/boundary cases.
- Fresh-result ownership, caller storage, zero wind, aliased position/output,
  gust radius/zero-distance boundaries, multiple gusts, invalid inputs and
  multi-frame grass integration covered by five Jest tests.
- Full Jest: **334 suites / 2,991 tests passed**. An initial run connected the
  disconnected-session MCP test to the live headset and encountered one
  dependency read error. The successful rerun used two workers and a temporary
  preload restricted to the MCP subprocess, routing its discovery to unused
  loopback port 65531. It did not skip tests or alter the live browser.
- Configured TypeScript project passed; development webpack build succeeded
  with existing warnings; independent review reported no actionable findings.
- Fresh-bundle emulated Quest 3 gate: **29/29 passed**, zero page exceptions.
  Tested via the `vr:check` entrypoint with a copied save and isolated asset/user
  storage. The initial fixture contained only one save, so its scrolling check
  correctly failed for lack of overflow; the passing fixture contained 21 saves.
  Six console errors remained within the harness's known baseline allowance;
  this is not a claim of an error-free engine.

## CPU microbenchmark

Original source at `6c73b6fd` versus optimized source, compiled with esbuild and
the same installed Three.js. Node v24.14.0; identical deterministic turbulence,
wind configuration and one point gust; 16,701 positions, 30 sampling passes per
trial, warm-up followed by nine trials alternating evaluation order. Global and
point samples matched exactly for all 16,701 positions; accumulated outputs
also matched across every timed trial.

Median sampling time: **2.678 ms -> 1.259 ms per pass**, a **53.0% reduction**.
This measures global and point sampling only, excluding grass integration,
rendering, GPU/compositor timing and the rest of the game. It is not a 53%
whole-game speedup and does not establish a headset FPS improvement.

Raw local evidence is under
`tools/vr-emulator/evidence/wind-optimization/benchmark.json` and
`tools/vr-emulator/evidence/wind-optimization/vr-check-metrics.json` in the main
checkout. The integrated checkout also passed **335 suites / 2,993 tests**,
including its existing additional harness tests.

## Native stationary verification

Allen reloaded the build, returned to `231TEL` / `231telc` with the requested
90 Hz and SSW-off configuration, and reported: "The grass looks good."
A live runtime probe confirmed the optimized sampling code was loaded before
capture. Two consecutive unprofiled 30-second windows followed:

| Window | FPS | Frame p50 / p90 / p99 | Simulation CPU p50 / p90 | Render CPU p50 / p90 |
|---|---:|---|---|---|
| Before, stationary | 21.42 | 46.7 / 49.6 / 56.0 ms | 8.3 / 9.5 ms | 14.4 / 15.4 ms |
| Updated, stationary 1 | 31.68 | 31.1 / 34.3 / 44.4 ms | 7.2 / 8.3 ms | 11.8 / 12.8 ms |
| Updated, stationary 2 | 31.10 | 31.4 / 36.5 / 47.7 ms | 7.3 / 8.6 ms | 12.0 / 13.3 ms |

All three windows had zero movement, gameplay mode, 8/9 rooms visible and
trustworthy one-update/one-render XR cadence. The updated FPS is **45–48% higher
than the earlier observed baseline**, and median simulation CPU is **12–13%
lower**. This is an observed comparison, not a controlled measurement assigning
the entire gain to wind: the player returned about 0.64 m from the old position,
head view and dynamic NPC state were not locked, the page was reloaded, and
final-pass draw calls/triangles differed. The prior snapshot had 1,166 calls /
442,810 triangles; updated snapshots had 1,120 / 430,006 and 1,160 / 447,890.
The independent exact-output microbenchmark remains the stronger evidence for
the wind routine's isolated CPU improvement.

A separate updated CPU profile recorded 967 ms inclusive grass-wind time over
21.02 s, versus 1,601 ms in the earlier 21.05 s profile. Those profiles also
cover different movement/scene states and are not a normalized per-frame A/B.
No profiler ran during the two updated FPS windows.

Evidence: `tools/vr-emulator/evidence/perf/audit-20261014-wind-after.jsonl`,
the prior `audit-20261014.jsonl`, and
`tools/vr-emulator/evidence/performance-native-wind-after-20261014/`.

Repeated controlled A/B/A and walking comparisons remain open. The 50 FPS
project floor and 90 Hz setting are still unmet here. The separately reported
missing/wrong character rendering remains an unresolved correctness issue;
this change does not claim to fix it.
