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
`tools/vr-emulator/evidence/vr-check-metrics.json` in the implementation worktree.

## Device acceptance remaining

Reload the rebuilt game, reproduce the same Telos save, location, head view,
90 Hz refresh setting and SSW-off configuration. Compare repeated unprofiled
stationary and walking windows, and confirm grass motion/visuals. The separately
reported missing/wrong character rendering remains an unresolved correctness
issue. Neither device FPS gains nor character fixes are claimed here.
