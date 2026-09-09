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

## The unattended nightly (`npm run qa:nightly`)

Added 2026-09-08. One command that builds, runs `vr:check`, runs the full sweep,
and writes a report saying **what changed since the previous run** — the delta is
the point, not the absolute number. A sweep that has blocked the same 12 modules
for a week is not news; 12 to 19 is.

    npm run qa:nightly                       # the full pass, 60-120 minutes
    node tools/qa/nightly.js --skip-build    # tree already built
    node tools/qa/nightly.js --sweep-limit 2 # wiring smoke test

Report and per-stage logs land in `tools/vr-emulator/evidence/nightly/`;
`latest.json` is always the most recent run.

**The stage-idle guard is a safety net, not the fix.** The runner kills a stage
that has been silent for `--idle-minutes` (default 15) and takes the sweep's
verdict from `module-sweep-summary.json` — but only if that file was written by
*this* run. Keep it: a stage that genuinely wedges must not stall the job
forever. It should no longer trigger, because the hang it was written for is
fixed (below).

**Exit 2 means it refused to start.** Both stages want asset-service port 8479,
and two concurrent runs do not queue — the second dies with EADDRINUSE partway
through and its evidence is indistinguishable from a real failure. So the runner
checks the port first and aborts rather than corrupting both runs. A scheduled
run landing while someone is driving the engine by hand is the expected case for
this, not an edge case. Exit 2 is "skipped, machine was busy", never a defect.

It also never resumes a checkpoint: a bad unattended run must not be able to
poison a save that a later run would pick up.

A scheduled task (`kotor2-vr-nightly-regression`) runs this and reports the
delta. Scheduled tasks only fire while the desktop app is open — if it was
closed at the scheduled time the run happens at next launch, which is precisely
why the port guard exists.

## Testing in the Quest's own browser (`npm run quest:perf`)

Added 2026-09-08. This is the answer to "what emulation cannot settle": it runs
the browser build **on the headset**, against the real compositor, with CDP still
reachable from the PC.

    npm run quest:perf:check    # verify adb, device and browser, launch nothing
    npm run quest:perf          # start the loop
    npm run quest:perf:test     # device-selection unit tests, no hardware needed

**Why a reverse tunnel and not the LAN address.** WebXR is gated on a secure
context. `http://127.0.0.1` qualifies — Chromium treats loopback as potentially
trustworthy — and `http://192.168.x.x` does not, so serving the build to the
headset over the LAN leaves `navigator.xr` undefined. That presents exactly like
a missing XR runtime, which is the same confound that produced two wrong
readings in Phase 0. `adb reverse tcp:8479 tcp:8479` makes the headset's own
127.0.0.1:8479 tunnel back to this machine, so the launch URL works verbatim
with its token, the page is a secure context, and the asset service keeps its
deliberate loopback-only binding — retail game data is never exposed to the LAN.

`adb forward tcp:9423 localabstract:chrome_devtools_remote` then puts CDP on
`127.0.0.1:9423`, so every tool built on `tools/vr-emulator/cdp.js` points at the
headset browser unchanged. Do not reload the page when attaching.

**Launch the URL with no package argument.** Naming `com.oculus.browser` on the
`am start` VIEW intent starts the browser *process* but opens no window: the
Store stays in front, no tab exists, and because the devtools socket is only
published once there is a tab, CDP then refuses the connection — which reads
exactly like remote debugging being switched off. Confirmed 2026-09-08: process
alive at pid 4902, `/proc/net/unix` readable with 581 entries and zero devtools
sockets, `curl` to the forwarded port returning empty. Letting the system
resolve the intent opens the browser properly, which is also what metavr's own
`metavr_device open_url` does.

**Device selection refuses to guess.** This machine has a second Android device
attached (a Pixel), and `adb` with two devices and no `-s` errors rather than
picking one — which then fails three steps downstream for a reason unrelated to
the actual cause. `tools/quest/adb.js` matches headsets on codename as well as
model and errors naming what it saw.

Compositor-side capture is metavr's job, through its MCP:

    perf capture --mode vr --app com.oculus.browser --duration 60000
    perf analyze-trace --focus frames
    perf compare <baseline_id> <comparison_id>

and the runtime knobs worth sweeping between captures are
`metavr_device vrruntime_set` (cpu_level, gpu_level, foveation_level, asw_mode),
reset with `vrruntime_reset`.

### Verified on hardware 2026-09-08

Quest 3 over wireless ADB (`192.168.1.77:5555`), Quest Browser 150 /
Chrome 150. One command brought up the asset service, both tunnels and the
browser; the page reported:

    href           http://127.0.0.1:8479/game/index.html?key=tsl&assets=/assets
    secureContext  true
    navigator.xr   present
    immersive-vr   true

so the reverse-tunnel reasoning above holds in practice, and `cdp.js` drove the
headset browser unmodified. `perf capture --mode vr` returned a 41.8 MB trace
(282,848 slices) and `analyze-trace` parsed it. `frame_timing` came back null,
correctly — nothing had entered an immersive session, so there were no XR frames
to time. Real cadence numbers still need someone wearing the headset to press
Enter VR.

**This is a different measurement from PCVR-over-Virtual-Desktop, not a
replacement for it.** The Quest browser renders locally; VDXR streams a desktop
Chrome session. Numbers from the two are not comparable, and Phase 0's evidence
is the VDXR path.

## Why the tools used to linger after finishing (fixed 2026-09-09)

`vr:sweep` would print its whole report, write every artifact, release port
8479 — and then sit there. It looked like an unkillable hang and cost a
scheduled job its completion signal.

**Root cause: `CdpSession.evaluate` raced the CDP call against a timeout it
never cleared.** When the evaluation won the race the rejection timer stayed
armed, and a pending ref'd timer keeps Node alive until it fires. The sweep's
module probe passes `--timeout` through to that evaluate, so the last probe of a
run left a **425-second** timer holding the process open. Same bug, smaller
blast radius, in `VrHarness.close()` (10s) and `startAssetService()` (20s).

All three now clear the loser of the race in a `finally`. `vr:sweep --limit 1`
exits 0.0s after its last line; `vr:check` is 25/25 and exits in 0.1s.

**Two instrument traps met while finding it, both worth knowing:**

- **`process._getActiveHandles()` does not report timers on Node 24.** A control
  with a listening server and a live 60s timeout reports only the server. So a
  handle dump showing `handles=0 requests=0` on a process that is plainly still
  running is not a contradiction — it means "no non-timer handles," and a
  pending timer is exactly what is invisible. `process.getActiveResourcesInfo()`
  *does* list `Timeout`, and said so on the first attempt; the dump that
  contradicted it was the one to distrust.
- **Piping a diagnostic through `grep` adds two `PipeWrap` handles of your own.**
  They are stdout and stderr, they are not the leak, and they crowd out the
  signal. Redirect to a file instead.

The technique that actually named it: monkey-patch `setTimeout`/`clearTimeout` in
a `-r` preload, record every timer with a stack, and print the ones still pending
once the work is done. That produced the file, line and duration in one run,
after two rounds of inference had produced only plausible wrong answers.
