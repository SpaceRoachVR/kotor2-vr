# Phase 0 engine-pivot report

Date: 2026-08-11

Branch: `spike/stereo-perf`

Target: Quest 3, VDXR, installed Chrome, RTX 3060

## Verdict

Phase 0 is a **go under the user-approved sustained-50 continuation gate**. The
final raw-WebXR isolation window delivered 51.82 FPS for 60 seconds after the
user disabled Virtual Desktop Synchronous Spacewarp and selected 72 Hz. Phase 1
flatscreen stabilization may proceed.

The hard floor is sustained average delivery of at least 50 FPS, p90 at or below
33.33 ms, p99 below 50 ms, unique timestamps, and complete GPU timing when the
extension is available. Runtime refresh and missed 72-Hz callbacks remain
reported independently. This explicitly accepts uneven delivery and is less
strict than native headset cadence; 72 Hz remains the stretch target.

## Authoritative device evidence

The cadence audit found and fixed two measurement defects:

- THREE r149's renderer-level animation-loop API restarted a desktop
  `requestAnimationFrame` source after the XR session had started, creating two
  schedulers and illegal draws outside an `XRFrame` callback.
- One already-queued browser callback could reach the engine during XR startup.

The spike now registers directly with the XR manager, rejects callbacks without
an `XRFrame`, and prevents browser-sourced engine updates while XR is presenting.
Subsequent reports reconcile exactly one XR update and render per accepted frame.

| Window | FPS | p50 | p90 | p99 | Over 13.89 ms | CPU p90 sim | CPU p90 render | Calls | Triangles | Heap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Mono rest | 60.00 | - | 18.2 ms | 19.9 ms | monitor-limited | - | - | - | - | 802.9 MB |
| Mono walking | 59.94 | - | 18.2 ms | 20.2 ms | monitor-limited | - | - | - | - | 815.4 MB |
| Corrected XR, full resolution | 31.96 | 29.5 ms | 32.7 ms | 63.1 ms | effectively 100% | 0.3 ms | 4.7 ms | 192 | 42,606 | 853.8 MB |
| Bounded 0.7 scale + maximum foveation | 33.01 | 28.6 ms | 32.0 ms | 62.7 ms | effectively 100% | 0.3 ms | 4.1 ms | 164 | 38,624 | 855.4 MB |

Clean partial XR windows ranged from 34.32 to 34.62 FPS with p90 around
31.4-31.7 ms. The reduced-resolution experiment produced no material gain, so
it was not retained. `.vis` culling was active and the observed scene submitted
roughly 146-192 calls and 36,000-43,000 triangles. Main-thread simulation and
renderer-submission time are far below the 13.89 ms budget; the long callback
interval points to GPU completion, compositor/runtime throttling, or the
browser-to-VDXR path rather than game simulation.

The earlier approximately 95-update-per-second result and 9.3/16.6 ms
percentiles are superseded because they came from the duplicated animation
sources.

## Bounded optimization result

The audited pass covered room culling, XR post-processing bypass, antialiasing,
draw-call volume, XR target scale, and foveation. Post-processing was already
bypassed in XR, antialiasing was already disabled, culling was active, and the
single reduced-target/foveation trial did not shift the callback ceiling.
Additional speculative quality cuts are not justified before isolating the
renderer/runtime boundary.

## Pivot comparison

| Option | Likely upside | Scope disruption | Fit with evidence | Proof required | Recommendation |
|---|---|---|---|---|---|
| Deep THREE renderer restructuring | Medium to high if r149 or the Odyssey render bridge is stalling XR | Medium; preserves TypeScript engine, assets, saves, and browser delivery | Plausible: this fork uses THREE r149 while current THREE is r184 | Minimal r149 vs r184 and render-only `101PER` A/B | **Preferred first pivot if the A/B isolates THREE/bridge cost** |
| Worker/OffscreenCanvas | Low for this gate | Medium-high architectural complexity | Poor: simulation p90 is 0.3 ms and render submission p90 is 4.1-4.8 ms; WebXR's `XRSystem` is exposed on `Window`, not workers | A worker prototype proving XR session ownership and frame delivery, not just asset work | Do not use as the Phase 0 renderer pivot; retain for later decoding/loading work |
| Alternate WebXR engine | Potentially high | High; Odyssey materials, models, visibility, animation, GUI, and effects need a new renderer bridge | Unknown until a minimal A/B distinguishes engine cost from VDXR/browser cost | Same scene and runtime clearing the accepted sustained floor before porting gameplay systems | Consider only if minimal alternate engine passes and current THREE path fails |
| Native OpenXR engine | Highest chance of bypassing browser/VDXR WebXR limitations | Very high; changes the locked browser architecture, packaging, tooling, and renderer integration | Relevant only if minimal browser WebXR is itself capped near 30/33 FPS | Native OpenXR prototype on the same hardware plus asset/save compatibility plan | Last-resort platform pivot after browser/runtime isolation |

WebXR exposes `navigator.xr` through the window environment, while
OffscreenCanvas can move ordinary WebGL rendering to a worker; these are not the
same as moving XR session ownership off the main window. See the
[WebXR Device API](https://www.w3.org/TR/webxr/),
[OffscreenCanvas documentation](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas),
[THREE WebXRManager documentation](https://threejs.org/docs/pages/WebXRManager.html),
[THREE releases](https://github.com/mrdoob/three.js/releases), and the
[THREE migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide).

## Recommended next decision study

Build one isolated, time-bounded benchmark that runs in the same Chrome/VDXR
session and records actual XR framebuffer dimensions, callback cadence, and GPU
timer queries where supported:

1. an official/minimal WebXR scene;
2. the same minimal scene on THREE r149;
3. the same minimal scene on current THREE r184;
4. `101PER` through a render-only Odyssey bridge with simulation disabled;
5. the full current engine.

If minimal WebXR reaches the sustained floor while r149 or the Odyssey bridge does
not, time-box an incremental r149-to-r184 migration using the official migration
guide. If minimal browser WebXR is also capped near 30/33 FPS, validate
Edge/SteamVR and runtime configuration before considering native OpenXR; an
engine rewrite would not fix a browser/runtime ceiling.

## Renderer-isolation results

The recommended study was executed in the same installed Chrome profile, VDXR
session, Quest 3, and RTX 3060 environment. Each case rendered one cube for a
matched 60-second window at the runtime-reported 72 Hz and the identical
4224 × 2304 XR target:

| Case | FPS | p50 | p90 | p99 | Over 13.89 ms | GPU p90 |
|---|---:|---:|---:|---:|---:|---:|
| Raw WebXR/WebGL2, no THREE | 34.96 | 27.8 ms | 31.1 ms | 46.7 ms | 99.95% | 0.06 ms |
| THREE r149 | 34.70 | 27.8 ms | 31.0 ms | 46.9 ms | 100% | 0.09 ms |
| THREE r185 | 34.72 | 27.8 ms | 31.0 ms | 46.8 ms | 100% | 0.09 ms |

The reports are retained under `evidence/xr-benchmark/2026-08-11/`. Raw WebXR
reproduces the same half-rate ceiling with negligible GPU work. Updating THREE,
restructuring the Odyssey renderer, moving simulation to workers, or choosing a
different browser engine cannot be justified as the remedy for this result.

### Accepted sustained-50 result

With Synchronous Spacewarp disabled and Virtual Desktop set to 72 Hz, the final
corrected raw-WebXR capture produced 3,110 frames in 60 seconds: 51.82 FPS,
p50 15.8 ms, p90 31.0 ms, p99 46.1 ms, and GPU p90 0.05 ms. The benchmark
reported runtime 72 Hz separately from acceptance 50 FPS and returned PASS with
no failed or missing checks. Evidence is stored at
`evidence/xr-benchmark/2026-08-11/raw-webxr-vdxr-ssw-disabled-50fps-pass.json`.

The user accepted this result and directed work to Phase 1. SteamVR/Edge remains
part of the eventual compatibility matrix, not a continuation blocker. The full
KOTOR VR stack must rerun the sustained-50 gate before the Peragus VR candidate.
