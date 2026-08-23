# VR testing: the emulated headset, and what it cannot tell you

Most VR work can be verified without a headset. **Anything testable through
emulation must be confirmed that way before it goes to a manual pass** — this is
a standing instruction from Allen, not a preference.

## The two commands

```bash
npm run vr:check   # 22 automated checks under an emulated Quest 3 — the gate
npm run vr:play    # launch a fresh Chrome profile with DevTools, for hands-on poking
```

`vr:check` takes several minutes: it boots the app, accepts the EULA, loads a
save, enters an immersive session, and collects every metric in one pass. It
exits non-zero on failure and writes
`tools/vr-emulator/evidence/vr-check-metrics.json`, which is worth reading
directly when investigating rather than re-running.

## How it works, and the trap that cost the most time

The **Immersive Web Emulator Chrome extension cannot be automated.** It only
injects its runtime while its own DevTools panel is open, which no script can
force. Do not build on it.

Instead `tools/vr-emulator/harness.js` injects the `iwer` npm package (the same
runtime the extension wraps) via CDP `Page.addScriptToEvaluateOnNewDocument`,
before any page script runs. The critical line:

```js
device.installRuntime({ forceInstall: true });
```

Chrome exposes a native `XRSystem` even with no headset attached. Without
`forceInstall`, the device installs but `navigator.xr` stays native and every
immersive check fails with a plausible-looking `immersive-vr: false` — which
looks exactly like a real capability problem and is not one.

Files:

| File | Role |
|---|---|
| `tools/vr-emulator/cdp.js` | Minimal CDP client over `ws` |
| `tools/vr-emulator/harness.js` | Chrome launch, iwer injection, `evaluate()` |
| `tools/vr-emulator/collect.js` | One-pass metric collection |
| `tools/vr-emulator/checks.js` | The 22 assertions, each with a rationale comment |
| `tools/vr-emulator/run-checks.js` | Runner; non-zero exit on failure |
| `tools/vr-emulator/launch-headset.js` | `vr:play` |

## Never serialize engine objects

`JSON.stringify` invokes `toJSON()`, and THREE's `Texture.toJSON` warns every
time. A console-capture that stringified engine state produced **29,812
warnings** and was very nearly reported as an engine defect. `harness.js`
`describe()` is a manual walker for exactly this reason. Use it.

## Writing a probe: measure whether you found the thing

The recurring failure in this project is a probe that returns an empty result
which reads as a finding. It has happened repeatedly:

- The world-prompt survey reported empty labels for objects it had never
  sampled, which read as "this object offers nothing".
- A menu probe reported `equippedSlots: 0` because it read `GameState.player`,
  which does not exist. The player is `PartyManager.party[0]`.
- The same probe reported no journal source data because it read
  `PartyManager.PartyTable`, which also does not exist.

**Every probe must record whether it located its subject, not only what it
counted.** Emit `playerPresent`, `sampled`, `managerPresent` — a bare zero is
ambiguous and will be misread as evidence.

Corollary: "opens without throwing" is not "works". The route check passed a
blank quest list for weeks because it only asserted that menus did not throw.
Measure content.

## Verify the API you are probing is the one the product uses

Item icons appeared unresolvable via `TextureLoader.tpcLoader.fetch`, and
resolved fine via `TextureLoader.LoadGUI` — which is what the protoitems
actually call. A probe using the wrong entry point produces a confident, wrong
bug report. Find the real call site first.

## What emulation cannot settle

The runner prints this itself: *"this settles logic, not comfort or cadence."*
Emulation cannot judge nausea, whether a reach feels natural, whether a snap
turn is disorienting, stereo framerate on real hardware, or whether a UI element
sits at a comfortable distance. Those go on `HEADSET-TEST-PLAN.md`.

## The other test gates

```bash
npx jest --ci --silent    # the real gate for src/actions
npx jest --ci src/tests/<file>.test.ts
```

**`tsc -p tsconfig.kotorjs.json` does not cover `src/actions`, and `tsc` prints
its success banner regardless of exit code.** It once reported clean while
esbuild rejected nine files a scripted edit had malformed. Jest and webpack are
the real gates for that tree; do not trust a green tsc alone.
