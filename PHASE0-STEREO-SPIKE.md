# Phase 0.1 — Stereo perf spike: how to run it

The question this answers: **can a single-threaded JS renderer submit two eyes at
rate on the 3060 over Virtual Desktop?** Everything from Phase 2 on depends on the
answer, so it gets measured before anything gets built.

Branch: `spike/stereo-perf`. Nothing here is the VR layer — no locomotion, no
controllers, no walkmesh coupling. Delete it once the verdict is written.

## What landed

| File | Role |
|---|---|
| `src/vr/VRSpike.ts` | Enables WebXR on the existing renderer, adds an Enter VR button, owns the stereo render path |
| `src/vr/PerfSampler.ts` | Per-frame timing, draw calls, triangles, heap. Reports percentiles |
| `src/GameState.ts` | Three hooks, each behind an `isPresenting` check |

The three engine changes, and why each was unavoidable:

1. **`makeXRCompatible()`** — the renderer is constructed around a context that
   already exists (`GameState.canvas.getContext('webgl')`), so the usual
   `{ xrCompatible: true }` attribute is not available. The context gets promoted
   after the fact instead.
2. **`GameState.scheduleNextFrame()`** — `requestAnimationFrame` runs at monitor
   rate. WebXR runs at headset rate and owns the callback via
   `renderer.setAnimationLoop`. Scheduling both would double-step the engine, so
   `Update()` defers while presenting and `VRSpike` re-arms rAF on session end.
3. **Composer bypass in `GameState.Render()`** — `EffectComposer` draws into its
   own render targets and blits to the default framebuffer, which is not the one
   XR presents. While presenting, the world scene is submitted directly.

Point 3 is a finding in its own right, independent of the perf numbers: **any
post-processing this mod wants has to be re-plumbed for XR.** It is not free, and
Phase 2 should budget for it.

## FINDING: Electron cannot do WebXR. The VR build has to be a browser build.

This is the most consequential thing Phase 0 has turned up so far, and it lands
before any frametime was measured.

**`immersive-vr` is unavailable in Electron and no flag fixes it.** Verified on
2026-08-08 against a fully working runtime, with `tools/xr-probe`:

| Runtime | `inline` | `immersive-vr` |
|---|---|---|
| Chrome 151, fresh profile | true | **true** |
| Edge 151 | true | **true** |
| Electron 41 (Chromium 146) | true | **false** |

Electron stayed false under every one of `enable-features=OpenXR`,
`force-webxr-runtime=openxr`, `disable-features=XRSandbox`, `disable-xr-sandbox`
and `enable-features=WebXRInternals`. Process enumeration during the query shows
Electron spawns only `network.mojom.NetworkService` — **the XR device service is
never started at all**, and Chromium's verbose XR logging emits nothing.

This is upstream and long-standing: [electron/electron#35011](https://github.com/electron/electron/issues/35011).
Even custom Electron builds with `checkout_openxr=True` never read the OpenXR
registry keys, while stock Chrome reads them the moment `isSessionSupported` is
called. It is not a configuration problem on this machine and not something the
mod can flag its way out of.

`inline: true` in Electron is **not** evidence the backend works — inline sessions
need no device and are supported even with no XR runtime whatsoever. Reading it
that way cost an hour here; do not repeat it.

### What this costs the project

The workflow rule "run it in Electron, never the browser" holds for engine work
but **cannot hold for VR work**. Phases 2 onward have to run in Chrome or Edge,
which means the browser build, which reopens the problem Electron was chosen to
avoid: the File System Access API is slow on this machine and throws
`NotReadableError` on large reads (`dialog.tlk` failed there while reading in
39 ms from the shell).

`src/server/` is IPC plumbing, not an asset server, so there is no existing
HTTP-serving path to fall back on.

**This deserves its own Phase 0 task, ahead of 0.1**, because it gates the same
go/no-go: if game assets cannot be read reliably in a browser, the stereo
frametime number is irrelevant. Candidate approaches, roughly in order of
promise: serve the game directory over local HTTP instead of File System Access;
cache assets into OPFS on first run; or chunk the large reads that fail.

## Preconditions

`tools/xr-probe` is a small Electron app that reports what the XR stack actually
exposes. It takes Chromium switches as `--sw=key=value`, so a flag can be tested
in seconds without touching the game build:

```bash
node_modules/electron/dist/electron.exe tools/xr-probe --sw=disable-features=XRSandbox
```

For browsers, `tools/xr-probe/browser-probe.js` serves the same check over
localhost — a page cannot write `result.json` itself.

**Start the browser after the VR runtime is up.** A Chromium process caches the
"no XR device" answer from startup, so launching a new *window* in an
already-running browser reports `immersive-vr: false` forever. That confound
produced a wrong reading here twice before it was caught. Use a fresh profile:

```bash
chrome.exe --user-data-dir=/tmp/xrtest --no-first-run http://localhost:8478/
```

## Runtime setup that works on this machine

The OpenXR runtime is **VDXR**, Virtual Desktop's own, set from the Virtual
Desktop Streamer window. It replaced SteamVR on both registry keys:

```
HKLM\SOFTWARE\Khronos\OpenXR\1             → virtualdesktop-openxr.json
HKLM\SOFTWARE\WOW6432Node\Khronos\OpenXR\1 → virtualdesktop-openxr-32.json
```

With VDXR active and the headset connected, Chrome and Edge both report
`immersive-vr: true`. SteamVR does not need to be running.

An earlier reading of `false` under SteamVR was never conclusively attributed —
by the time VDXR was in place the browser-caching confound was also in play, so
whether SteamVR-as-runtime works here is untested. VDXR is the target path
anyway, so it was not chased further.

## Procedure

The browser asset gate is now complete. Build the current bundle, start the
authenticated loopback service against the real KOTOR II installation, and open
the printed one-time launch URL in a fresh Chrome process:

```powershell
npm run webpack:dev
node tools/asset-http/asset-server.js `
  --game "D:\SteamLibrary\steamapps\common\Knights of the Old Republic II" `
  --user "$env:LOCALAPPDATA\Kotor2VR"
```

Use the same browser build for the matched mono and stereo windows so filesystem,
bundle, and renderer conditions remain constant. The stereo half needs the
headset connected, VDXR active, and Chrome launched *after* the runtime is up on
a fresh profile.

1. Load a save inside `101PER`. Do not click Enter VR at the main menu — measure
   the level, not an empty scene.
2. Open DevTools (Ctrl+Shift+I). Console reports arrive every 30 s.
3. **Mono baseline first.** Without entering VR:
   ```js
   VRSpike.perf.start('mono-rest')
   ```
   Stand still for a minute, then `VRSpike.perf.start('mono-walking')` and walk a
   loop of the level for a minute. The stereo numbers mean nothing without this —
   what matters is the *ratio*, not the absolute figure.
4. Click **Enter VR (spike)**. The sampler starts a `stereo` window automatically
   and picks up the headset's real refresh rate as the budget. Confirm the
   runtime reports its actual refresh separately from the sustained-50 gate.
5. In DevTools, relabel as you go:
   ```js
   VRSpike.perf.start('stereo-rest')      // stand still, one minute
   VRSpike.perf.start('stereo-walking')   // walk the same loop, one minute
   ```
6. Start a post-warm ten-minute window, leave it running, then dump everything:
   ```js
   VRSpike.perf.start('stereo-10min')
   // leave running for at least ten minutes; 60-second reports are automatic
   VRSpike.perf.memoryStability()
   VRSpike.perf.dump()      // JSON for every window this session
   ```

   Auto-reporting remains enabled during `stereo-10min`, producing enough
   post-warm samples for the memory evaluator. After the walking and memory
   windows are present, record compositor evidence separately and request the
   combined verdict:

   ```js
   VRSpike.perf.sustained50Verdict()
   ```

Each report carries frametime min/p50/p90/p99/max, the share of frames over
budget, `renderer.info` draw calls and triangles, geometry/texture/program counts,
JS heap in MB, XR callback/update/render reconciliation, missed-frame estimates,
visible/total room counts, and a 500 ms player-position trace with accumulated
distance, maximum displacement, and rooms traversed. **Percentiles, not
averages** — a mean hides exactly the spikes that a wearer feels.

The cadence report must say `trustworthy: true`: every unique `XRFrame` has one
XR-sourced engine update and one XR render on that exact timestamp, no
browser-sourced update occurs in the window, no callback is inferred missed,
and every callback carries an `XRFrame` object. Stock WebXR reports
compositor telemetry as unavailable; capture separate VDXR/Virtual Desktop
evidence showing native rather than sustained synthetic delivery.

### Tunables, all live in DevTools, no rebuild

```js
VRSpike.yawOffset      // radians, if facing is rotated
VRSpike.eyeHeight      // 1.75 m spike default; production uses calibration
VRSpike.followCamera   // false = stand still and look around
VRSpike.perf.targetHz     // the 50 Hz acceptance floor (acceptanceThresholdHz), not the refresh rate
VRSpike.perf.xrRuntimeHz  // actual XR runtime refresh, audited separately
```

The Z-up conversion is `rig.rotation.x = π/2` — KOTOR's world is Z-up, WebXR poses
are Y-up. If the world appears on its side, that is the line to look at.

## Record the verdict here

### First device run and bounded remediation (2026-08-11)

Quest 3 through VDXR successfully created an immersive session in installed
Chrome and supplied head tracking, but the headset showed black and then reported
that the page was not responding. The settled 15-second `stereo-rest` sample was:

| Runtime | fps | p50 | p90 | p99 | % over 13.89 ms | draw calls | triangles | heap MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Quest 3 / VDXR / Chrome / RTX 3060, 90 Hz delivery | 90.3 | 9.1 | 16.5 | 27.5 | 19.8% | 324 | 49,636 | 8,368.6 |

This failed the 72 Hz floor at rest, before a walking window. Desktop diagnosis
then found that `GameInitializer.LoadOverride()` eagerly cached all 1,823 files in
the TSLRCM Override folder: 7.66 GiB of resource bytes were resident before the
main menu, and V8 reported 7.86 GiB used heap.

The bounded remediation replaced the byte preload with a validated path index and
lazy per-resource reads. Fresh installed-Chrome evidence after rebuilding:

- main-menu heap: 118.3 MB, with 1,823 indexed paths and zero cached Override files;
- settled `101PER` heap: 888.9 MB, with 52 requested Override resources cached;
- `.vis` evidence: 13 of 66 rooms visible at the accepted save position;
- 30-second mono rest: 59.99 fps, p50 16.7 ms, p90 16.8 ms, p99 16.9 ms;
- rendered browser screenshot visually confirmed the level and UI remained intact.

The mono draw-call counter is not recorded here because the final EffectComposer
blit overwrites `renderer.info`; XR bypasses the composer and reports the stereo
world counters directly. The headset must be rerun at an explicitly selected
72 Hz before either verdict below can be filled.

### Remediated headset confirmation (2026-08-11)

Virtual Desktop exposed a fixed 90 Hz mode on this setup; there was no selectable
72 Hz option. After the lazy Override fix, the user confirmed that `101PER` was
visible, responsive, and looked "amazing" in the Quest 3. No black environment,
page-unresponsive warning, session loss, or tracking loss recurred.

The first walking interpretation used only equal start/end coordinates and was
discarded after the user reported that they had walked a loop. The confirmation
run sampled the creature position every 500 ms:

- 182 position samples over 91.49 seconds;
- 85.55 metres of accumulated movement and 9.94 metres maximum displacement;
- rooms `101per2a`, `101perbc`, `101peray`, and `101peraq` traversed;
- `.vis` culling remained active;
- heap ended at 799.8 MB.

| Window | p50 | p90 | p99 | max | % over budget | budget | draw calls | triangles | heap MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| remediated stereo rest | 9.3 | 16.6 | 16.8 | 25.7 | 32.88% | 11.11 ms (90 Hz) | 384 | 55,470 | 823.1 |
| remediated stereo walking, path-confirmed | 9.3 | 16.6 | 16.8 | 31.8 | 23.62% | 13.89 ms (72 Hz gate) | 386 | 55,790 | 799.8 |

The user-observed result was a clear functional and perceptual success, but the
sampler also counted about 95 engine updates per second while Virtual Desktop
reported 90 Hz. The corrected-cadence section below supersedes those timing
percentiles and resolves that mismatch before issuing the final no-go.

### Corrected cadence and final Phase 0 result (2026-08-11)

The earlier remediated headset percentiles above are not valid performance
evidence. THREE r149 was driving the engine from both its desktop animation loop
and its XR animation loop, which also caused framebuffer errors outside XR frame
callbacks. The corrected implementation owns one XR loop, rejects callbacks
without an `XRFrame`, and blocks an already-queued browser callback from updating
or rendering while XR is presenting.

The user confirmed that corrected `101PER` remained visible and head-tracked.
The clean reports reconciled exactly one XR update and render per accepted frame:

| Window | FPS | p50 | p90 | p99 | % over 13.89 ms | CPU p90 sim | CPU p90 render | draw calls | triangles | heap MB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mono-rest | 60.00 | - | 18.2 | 19.9 | monitor-limited | - | - | - | - | 802.9 |
| mono-walking | 59.94 | - | 18.2 | 20.2 | monitor-limited | - | - | - | - | 815.4 |
| corrected XR full resolution | 31.96 | 29.5 | 32.7 | 63.1 | 99.95% | 0.3 | 4.7 | 192 | 42,606 | 853.8 |
| bounded 0.7 scale + foveation | 33.01 | 28.6 | 32.0 | 62.7 | 99.95% | 0.3 | 4.1 | 164 | 38,624 | 855.4 |

Clean partial XR windows reached 34.32-34.62 FPS with p90 31.4-31.7 ms.
Reducing the XR render target to 0.7 and applying maximum foveation did not
materially change the ceiling, so that quality reduction was reverted.

**Historical native-72 result: NO-GO.** The corrected KOTOR result was roughly
32-35 FPS. This remains useful diagnostic evidence and has not been relabeled.
The later user-approved continuation floor is sustained 50 FPS, with 72 Hz as a
stretch target.

### Isolated renderer comparison (2026-08-11)

A standalone benchmark removed KOTOR and then THREE from the stack. All three
cases ran for 60 seconds in the same Chrome/VDXR session at a 4224 × 2304 XR
target:

| Case | FPS | p50 | p90 | p99 | GPU p90 |
|---|---:|---:|---:|---:|---:|
| Raw WebXR/WebGL2 | 34.96 | 27.8 | 31.1 | 46.7 | 0.06 |
| THREE r149 | 34.70 | 27.8 | 31.0 | 46.9 | 0.09 |
| THREE r185 | 34.72 | 27.8 | 31.0 | 46.8 | 0.09 |

Raw WebXR therefore reproduces the half-rate ceiling with negligible GPU work.
After Synchronous Spacewarp was disabled, the final 60-second raw-WebXR run
delivered 51.82 FPS, p90 31.0 ms, p99 46.1 ms, and passed the revised sustained-
50 gate. The result does not support a THREE upgrade or Odyssey renderer rewrite
as the current performance fix. Phase 1 may proceed; the full VR stack must
repeat the sustained-50 gate before the Peragus VR candidate.

## Bisect round procedure

The Phase 2 bisect round (VR perf team, 2026-10-15) asks which engine layer
first pushes each benchmark scene over the 72 Hz budget (p90 ≤ 13.9 ms,
p99 ≤ 20 ms). `tools/vr-emulator/perf-round.js bisect` boots the page at each
`?perflayer=l0..l5` rung, loads a checkpoint, enters VR, settles 10 s and
times 60 s windows. The rungs are cumulative: L0 an empty clear, L1 the
player's room only, L2 the linked rooms, L3 adds characters, L4 adds effects,
grass and lights, L5 is the full game. The sets live in
`tools/vr-emulator/perf-benchmarks.json`. Records go to
`tools/vr-emulator/evidence/perf/<round>.jsonl`.

### Headset setup

- **72 Hz, SSW off.** Set the refresh rate to 72 Hz in Virtual Desktop and turn
  Synchronous Spacewarp off. SSW on halves the delivered rate and hides the
  real frame time (the Phase 0 runs above). A window measured at another rate
  doesn't compare with the rest. Check it like this:
  1. After Enter VR, run `perf-round.js state`.
  2. If `runtimeReportedHz` is reported, it must be 72.
  3. If it is null (expected on Chrome with Virtual Desktop / VDXR), Allen
     confirms 72 Hz with SSW off in Virtual Desktop, and the lead records it:
     `perf-round.js note "refresh 72 Hz, SSW off (VD)"`.
  4. Every `bisect` and `wave` command passes `--refresh-hz 72`.

  The driver stores `refreshHz` (and `refreshHzSource`: `runtime` when the
  page reported one, `declared` when it came from `--refresh-hz`) on every
  record, and the trace budget and the wave's A/B/A comparison use it. Don't
  read `targetHz` for this: it is the sampler's 50 Hz acceptance floor
  (`acceptanceThresholdHz`), not the refresh, and it reads 50 whatever the
  headset runs at.
- **The desktop mirror is part of L5.** `?mirror=on|off` defaults to on
  (`VRDesktopMirror.ts`), so every L5 window includes the mirror's cost, and
  the L4 to L5 delta is the play layer plus the mirror. If Allen won't be
  streaming the mirror during play, take one extra L5 window per set with it
  off. `load` keeps the page's current options, and `reload` takes any
  `key=value` (it passes them straight into the URL), so:
  ```bash
  node tools/vr-emulator/perf-round.js reload perflayer=l5 mirror=off
  node tools/vr-emulator/perf-round.js load medbay-swept
  node tools/vr-emulator/perf-round.js enter-vr
  node tools/vr-emulator/perf-round.js --round bisect-<date> window l5-medbay-mirror-off 60
  node tools/vr-emulator/perf-round.js reload perflayer=l5      # mirror back on
  ```
  `bisect`, `wave` and `stop` build their own URLs and drop the option, so
  this takes a separate pass of `reload`, `load`, `enter-vr` and `window`.
- **Virtual Desktop performance overlay on.** It shows what the browser can't
  see: compositor frame time, dropped frames and encode/network latency.
- Launch with `npm run vr:play` (CDP on 9422, asset service on 8479). Attach
  the console tailer: `node tools/vr-emulator/console-tail.js <round>.log`.
  Never run `vr:check` at the same time, because both bind 8479.

### Start of the round: create the pending checkpoints

Some benchmark checkpoints can only be made from Allen's own saves.
`perf-telos-a`, `perf-telos-c` and `perf-swoop` are `pending: true` in the
manifest. Allen loads each save in the headset at the spot to be benchmarked,
stands still, and the driver saves it under the VRPT prefix:

```bash
node tools/vr-emulator/perf-round.js checkpoint perf-telos-a
node tools/vr-emulator/perf-round.js checkpoint perf-telos-c
node tools/vr-emulator/perf-round.js checkpoint perf-swoop
```

Nobody needs to edit the manifest. A pending entry runs as soon as its save
exists, and is skipped with a log line while it doesn't (R13).
`perf-turret` and `perf-combat` already exist (made in the emulator,
2026-10-15). `perf-theater` is still pending. Make it the same way at a
cutscene trigger, for example on the Harbinger engine deck one step short of
the Sion junction.

### Run it set by set

`bisect all` is ~50 min with the saves that exist now and ~66 min once every
pending save exists (R14), which is more than one sitting. Run one set per
command, Peragus first, and split the sets across two sittings if needed:

```bash
node tools/vr-emulator/perf-round.js bisect all --dry          # the plan and its wall time, no CDP
node tools/vr-emulator/perf-round.js --round bisect-<date> --refresh-hz 72 bisect peragus      # ~21 min, the full L0-L5 ladder
node tools/vr-emulator/perf-round.js --round bisect-<date> --refresh-hz 72 bisect ebon-hawk
node tools/vr-emulator/perf-round.js --round bisect-<date> --refresh-hz 72 bisect conversation
node tools/vr-emulator/perf-round.js --round bisect-<date> --refresh-hz 72 bisect combat
node tools/vr-emulator/perf-round.js --round bisect-<date> --refresh-hz 72 bisect telos
```

Use the same `--round` for every set in the round, so `attribution` sees them
all.

- **Run the driver in the background, never in a Monitor.** Claude starts each
  `bisect` with Bash `run_in_background` and redirects it to a log. A Monitor
  only tails that log (`tail -f`). Stopping a Monitor kills only the current
  step, so a Monitor that owns the driver leaves the loop running on.
- **Reboot between rungs.** The layer is read once, at page boot, so every
  rung (and every checkpoint) is a fresh page boot at that rung's URL. Loading
  a second save into a used page leaves a blank player in the old room. The
  driver does all of this. After each reboot, the wearer presses Enter VR again
  if the driver's own click doesn't start the session; it waits up to 5 min.
  Never change `perflayer` in a live page by hand.
- **Stand still through L0–L4.** Below L3 the party isn't updated, so the
  player can't move. L1 and L2 are valid only from the load spot, so don't
  walk during them. Every rung below L5 takes a `rest` window. Walk only when
  the log says `WALK now` (the L5 `walk` windows). The `talk` window
  (conversation set) means start the conversation in front of you and click
  through it.
- **Read the overlay at each rung.** When a window starts, Allen reads the VD
  overlay aloud, and Claude records it against the round:
  ```bash
  node tools/vr-emulator/perf-round.js --round bisect-<date> note "l3 medbay: VD 13.1 ms, 0 dropped, encode 6 ms"
  ```
- A failed stop is logged as `FAILED <set>/<checkpoint> l<N>: <reason>` and the
  run goes on to the next. When the run ends, or on Ctrl+C, the driver sends
  the page back to plain `perflayer=l5`. If it says it couldn't, reload
  without `?perflayer` before playing.

### Reading the attribution table

At the end of each `bisect`, and on demand, the driver prints the table:

```bash
node tools/vr-emulator/perf-round.js --round bisect-<date> attribution [--budget 13.9]
```

There is one block per set and checkpoint. The heading is the verdict:

- `first over at l3, stage: render` means l3 is the lowest measured rung whose
  worst-window p90 is over budget. The rung's p90 splits into sim (CPU update),
  render (CPU render submission), gpu (GPU timer query) and runtime (whatever
  frame time is left over, which belongs to the XR runtime and compositor).
  The stage named is the largest of those at that rung. So "characters pushed
  it over, and the cost is on the CPU render side".
- `first over at l3 (l1, l2 unmeasured), stage: …`: some planned rungs below l3
  have no usable window (the stop failed, or every window was untrustworthy).
  The true crossing could be at any unmeasured rung up to l3. Re-run those
  rungs before acting on the verdict.
- `no measured rung over the 13.9 ms p90 budget` means the scene is within
  budget at every measured rung. With `(lN unmeasured)` after it, that "none"
  isn't proven.
- `stage: unknown` means the report lacked `cpuMs`, so no stage can be named.
- A `-` in the gpu column means `gpuMs` was null: no timer-query extension, or
  disjoint samples. The runtime column then absorbs the GPU time.
- **excluded** lists windows dropped because their `xrCadence` integrity was
  untrustworthy. A rung with only excluded windows shows as `unmeasured`.
- If an L0 row is already over budget (`first over at l0`), the cost is below
  the engine, in the browser or XR runtime. Record "stack ceiling suspected",
  and the XR-runtime track leads wave 1.

Each set's other checkpoints run only at L5 (R12), so their blocks have one row.
The emulator can rehearse all of this (see the dry run below), but its frame
times are not headset frame times. Only the headset round's numbers count.

### Emulator dry run (2026-10-15)

The machinery was rehearsed under the emulated Quest 3 on its own ports (CDP
9490, asset service 8530, a temp user root holding copies of the saves). It ran
`bisect peragus` (all 11 plan rows recorded, perflayer echoed l0..l5 per
rung, the attribution table printed, and the page was sent back to plain l5),
`bisect ebon-hawk`, and `bisect all --dry`. The evidence is in
`tools/vr-emulator/evidence/perf/bisect-dryrun.jsonl`, and the per-rung views
of `medbay-swept` are in `tools/vr-emulator/evidence/perf/bisect-dryrun/`.
Things it found that matter for the headset round:

- **Before the fix, L0–L2 never loaded.** Below L3 the player had no room, so
  every room stayed visible (66/66) and the load timed out. Fixed in
  `ModuleArea.update`. Since then, L1 draws one room and L2 the 17 linked
  rooms of 101PER.
- **`screenshot.js` times out below L5,** because the desktop mirror only
  draws at the play layer. To see a stripped rung, draw one mirror frame
  yourself inside an XR frame (the dry run's per-rung images were taken that
  way). A plain CDP `Page.captureScreenshot` is black while presenting.
- **The emulator's L0 is always "over".** Its frame loop runs at 60 Hz, so an
  empty scene measures 17 ms p90 and the table says `first over at l0,
  stage: runtime`. That is the emulator's frame rate, not a stack ceiling.
  Only the headset round can apply the L0 rule.
- `gpuMs` was non-null at every rung under the emulator (EXT disjoint timer
  available, no disjoint samples): 0.1 ms p90 at L0, and 8.7 to 12.6 ms at L5
  across the checkpoints. The maximum is 12.1 to 12.6 ms at t3-hangar,
  droids-cleared and ebon-engine-room-open; medbay-swept's 10.6 ms is not it.
- A reloaded `perf-turret` save now stays in the turret minigame (engine
  mode 2). The overlay reopen used to force INGAME.

## What this deliberately does not do

- No GUI in stereo. The GUI scene is an orthographic overlay with no meaning in a
  headset; Phase 4 replaces it. Movies and the legal screen render their own ortho
  scenes directly and are not XR-aware either.
- No comfort handling of any kind. Do not stay in it if it feels bad — the rig is
  hard-locked to the follower camera, which is not how anyone should experience
  smooth locomotion.
- No controller input. Walk with the keyboard while wearing the headset.

## Feeds the next two tasks

- **0.2** — the `draw calls` column is exactly what `.vis` room culling verification
  needs. If stereo draw calls are 2× mono, culling is running per-eye as it should.
  If they are 2× *and* the count is near the whole level, culling is not applying.
- **0.3** — `heap MB` across the ten-minute window is the first cheap read on the
  memory growth. It is not a heap snapshot and does not identify a retainer, but a
  flat line would meaningfully narrow the search.
