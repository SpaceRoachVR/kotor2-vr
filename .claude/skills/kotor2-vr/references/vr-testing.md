# VR testing: the emulated headset, and what it cannot tell you

Most VR work can be verified without a headset. **Anything testable through
emulation must be confirmed that way before it goes to a manual pass** — this is
a standing instruction from Allen, not a preference.

## The two commands

```bash
npm run vr:check   # 23 automated checks under an emulated Quest 3 — the gate
npm run vr:play    # launch a fresh Chrome profile with DevTools, for hands-on poking
```

`vr:check` takes several minutes: it boots the app, accepts the EULA, loads a
save, enters an immersive session, and collects every metric in one pass. It
exits non-zero on failure and writes
`tools/vr-emulator/evidence/vr-check-metrics.json`, which is worth reading
directly when investigating rather than re-running.

**`vr:check` reads `dist/`. It does not build it.** On 2026-08-23 a run passed
22/22 against a six-hour-old bundle and read as confirmation of a change that
was not in it. Always `npm run webpack:dev` first. There is now a loud STALE
BUNDLE banner that names the offending source file, but treat it as a backstop,
not a substitute for building.

Note for anyone touching that guard: comparing `dist/KotOR.js` mtime against
source is **not** sufficient. Webpack's `compareBeforeEmit` defaults to true, so
a rebuild whose output is byte-identical never rewrites the asset, and the
bundle stays older than source while being perfectly current — which produced a
false "stale" warning the first time the guard ran. `npm run webpack:dev` and
`webpack:prod` therefore write `dist/.build-stamp` via `tools/build-stamp.js`,
and the guard prefers that. `webpack:dev-watch` does **not** stamp, so under the
watch build the banner can cry wolf.

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

## Breadth-first module sweep (`npm run vr:sweep`)

Added 2026-08-29. Complements the playthrough driver rather than replacing it.

The playthrough is depth-first: it must succeed at step N to reach step N+1, so
one blocker shadows every defect behind it and defects arrive in encounter order.
The sweep warps into each of the campaign's **82 modules** in turn, runs a fixed
battery, records everything wrong, and moves on whether the module passed or not.
Output is a whole-game defect inventory ranked by **how many modules each root
cause breaks**, so fixes go in blast-radius order.

    npm run vr:sweep                        # all 82, ~90 minutes
    npm run vr:sweep -- --modules 101PER    # one module, ~35s after boot
    npm run vr:sweep -- --limit 5           # smoke run
    npm run vr:sweep -- --start 302NAR      # resume an interrupted sweep
    npm run vr:sweep:test                   # 41 unit tests, no browser needed

Evidence lands in `tools/vr-emulator/evidence/`: `module-sweep.jsonl` (one record
per module, written incrementally so a crash mid-run costs nothing),
`-summary.json` (ranking + coverage), `-defects.json` (`DefectRecord`s that pass
`src/qa/DefectLedger.ts`).

**What it settles:** area load and identity, model presence on rooms, creatures,
doors and placeables, name and template resolution, item-property resolution
across inventories and equipment, declared-vs-resolved conversations, N rendered
frames, and console/page exceptions attributed to the module that caused them.

**What it does not:** whether a quest is finishable, whether combat maths are
right, whether a conversation dead-ends. Those still need the playthrough. And
like everything here it says nothing about comfort or cadence.

### Three traps it already walked into

- **Readiness must be identity, not existence.** `loadingModule === false &&
  module.area` is true *before* a load starts, because the outgoing module is
  still resident. The first run passed that check in 1.7s and reported an area
  with zero of everything as a blocker. Hold a reference to the outgoing module,
  require a *different* one with `readyToProcessEvents === true`, settle, then
  verify `filename` matches what was requested.
- **`DLGObject` is not exported from the bundle**, and `FromResRef` is
  synchronous. Probe what the engine itself resolved (`creature.conversation`
  against the template's declared `Conversation` field) rather than trying to
  force-load a `.dlg`.
- **A benign probe will dominate a blast-radius ranking.** The engine's
  `modules/NAME.mod` 404 fires for all 82 modules (ROADMAP 1.11). It is filtered
  and counted separately — never silently dropped, or the filter becomes a place
  real regressions go to hide.

**A skipped probe is not a passed probe.** The battery reaches into engine
internals that move; when an API is missing it records a `skipped` entry rather
than inventing findings, and the run summary prints the skip count loudly. A
sweep reporting zero findings *and* nonzero skips has not told you the game is
healthy.
