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

## Preconditions

WebXR is present in Electron 41 — probed directly, `navigator.xr` is a live
`XRSystem` and `makeXRCompatible` exists, ANGLE/D3D11 on the 3060. So the spike
runs in Electron and avoids the browser build's `NotReadableError` on large reads.

`isSessionSupported('immersive-vr')` returned **false** with no runtime running.
That is expected, but it means **SteamVR must be up and the headset connected
before launching Electron** — otherwise the button renders as "VR unavailable".

## Procedure

```bash
npm run webpack:dev
```

Then, with SteamVR running and the headset connected via Virtual Desktop:

```bash
npm run start
```

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
