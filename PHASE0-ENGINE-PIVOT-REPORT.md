# Phase 0 engine-pivot report

Date: 2026-08-11
Branch: `spike/stereo-perf`
Target: Quest 3, VDXR, installed Chrome, RTX 3060

## Verdict

The bounded remediation fixed the device-breaking failure, but the current
instrumented result is a **no-go under the predeclared native-frame gate**.
Feature expansion must remain paused.

Do not change engines yet. The device result and sampler disagree materially:
the user reports a responsive image that looks excellent at Virtual Desktop's
90 Hz setting, while the harness reports p90 16.6 ms and approximately 95 engine
updates per second. The next action should be an instrumentation-only audit of
XR frame cadence, compositor/reprojection state where exposed, and duplicated
engine callbacks. That is evidence gathering, not another optimization pass.

## Measured evidence

### Before remediation

- The game entered immersive WebXR with audio and head tracking, but the headset
  remained black and then reported that the page was not responding.
- `GameInitializer.LoadOverride()` retained 1,823 loose resources totalling
  7.66 GiB before the main menu.
- Used JS heap was approximately 7.86 GiB before module load and 8.37 GiB in XR.
- A short stereo-rest window recorded p90 16.5 ms, p99 27.5 ms, and 19.8% over
  the 72 Hz budget.

### Bounded remediation

- Replaced eager Override byte caching with a validated path-only index and lazy
  reads that retain Override precedence.
- Added focused unit coverage; the complete gate passed 10 suites and 101 tests,
  configured TypeScript, and all webpack targets.
- Fresh Chrome fell to 118 MB at the menu and approximately 889 MB in `101PER`.
- Only requested Override resources were cached, and `.vis` culled 66 rooms down
  to 13 at the accepted save position.

### After remediation

- The user reports that the headset view is clear, responsive, and looks
  "amazing" at Virtual Desktop's fixed 90 Hz setting.
- A confirmed walking trace sampled the creature every 500 ms, covered 85.55 m,
  reached 9.94 m maximum displacement, and crossed four rooms.
- Walking: p50 9.3 ms, p90 16.6 ms, p99 16.8 ms, max 31.8 ms, 23.62% over the
  13.89 ms 72 Hz gate, 386 draw calls, 55,790 triangles, 799.8 MB JS heap.
- No XR session loss, tracking loss, black frame report, or monotonic heap growth
  was observed during the confirmation windows. The required continuous
  ten-minute memory window is still outstanding.

## Decision options

1. **Recommended: audit the measurement boundary.** Count `XRFrame` callbacks,
   engine updates, and renders independently; use XR timestamps; record missed
   frames and compositor/reprojection telemetry when the runtime exposes it.
   Repeat the same rest/walking path only if the harness proves one sample per XR
   frame. This resolves the conflict without expanding product scope.
2. **Accept a reprojection-based floor.** Change the written acceptance rule to a
   perceptual/device criterion backed by compositor evidence and external testers.
   This is a product decision and weakens the native-frame guarantee.
3. **Pivot engines now.** Move to a native renderer or another engine. This has
   the highest schedule and compatibility cost and discards substantial Odyssey,
   browser-filesystem, save, and TSL work. Current evidence does not justify it
   before option 1.

## Release impact

No later VR platform or gameplay milestone should start from this result. The
browser asset foundation and flatscreen engine fixes remain valuable regardless
of the eventual renderer decision. A public release still requires the full
hardware matrix, campaign acceptance, external beta, and all existing blockers.
