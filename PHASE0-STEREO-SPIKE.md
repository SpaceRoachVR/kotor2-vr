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
   and picks up the headset's real refresh rate as the budget.
5. In DevTools, relabel as you go:
   ```js
   VRSpike.perf.label = 'stereo-rest'      // stand still, one minute
   VRSpike.perf.label = 'stereo-walking'   // walk the same loop, one minute
   ```
6. Leave it running ten minutes, then:
   ```js
   VRSpike.perf.report()
   VRSpike.perf.dump()      // JSON for every window this session
   ```

Each report carries frametime min/p50/p90/p99/max, the share of frames over
budget, `renderer.info` draw calls and triangles, geometry/texture/program counts,
and JS heap in MB. **Percentiles, not averages** — a mean hides exactly the spikes
that a wearer feels.

### Tunables, all live in DevTools, no rebuild

```js
VRSpike.yawOffset      // radians, if facing is rotated
VRSpike.eyeHeight      // 1.75 m, fixed and canonical by design decision
VRSpike.followCamera   // false = stand still and look around
VRSpike.perf.targetHz  // 72 for Virtual Desktop, 90 wired
```

The Z-up conversion is `rig.rotation.x = π/2` — KOTOR's world is Z-up, WebXR poses
are Y-up. If the world appears on its side, that is the line to look at.

## Record the verdict here

| Window | fps | p50 | p90 | p99 | % over budget | draw calls | triangles | heap MB |
|---|---|---|---|---|---|---|---|---|
| mono-rest | | | | | | | | |
| mono-walking | | | | | | | | |
| stereo-rest | | | | | | | | |
| stereo-walking | | | | | | | | |
| stereo +10 min | | | | | | | | |

**Go / no-go on 72 Hz:**

**Go / no-go on 90 Hz:**

Notes:

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
