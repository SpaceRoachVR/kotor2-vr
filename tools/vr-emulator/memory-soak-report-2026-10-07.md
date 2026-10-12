# Sustained transition, party, and save/reload memory test — 2026-10-07

The extended emulated Quest 3 scenario completed after fixing an encounter
teardown leak. It performed **30 direct module transitions and ten save/reloads**
in one fresh browser session, alternating solo Exile and Exile/Atton/T3 parties.
There were zero page exceptions, zero reported XR-loop failures, and zero stale
encounter meshes in all 40 post-fix samples. Duration was 18.7 minutes.

The final three-member `106PER` reload retained **860.101 MiB**, compared with
**1,202.538 MiB** before the fix: **342.437 MiB less retained JavaScript heap**.
This closes the reproduced encounter retention defect and establishes an
observed late plateau for this scenario. It does not close full-campaign or
physical-headset memory acceptance.

## Reproduction and cause

The original two-module loop did not include `106PER`. Extending it to that
module, alternating party membership, and saving/reloading exposed continued
heap growth despite nearly constant renderer allocations.

A heap snapshot showed a strong reference chain:

`scene -> triggers -> encounter mesh -> userData.moduleObject -> encounter.area`

`ModuleArea.dispose()` destroyed ordinary triggers but omitted encounters.
Their hidden meshes remained in the scene, retaining old area data through the
encounter. Because these meshes were hidden, renderer allocation counts alone
did not reliably reveal their accumulation. The unpatched `106PER` scene gained
two nodes per cycle (one transition and one reload).

Area teardown now drains its encounter list and calls each encounter's existing
destructor. That removes its scene mesh, disposes geometry/material resources,
unregisters the object, and clears its area reference. No encounter gameplay or
retail data definitions were changed. The regression test first reproduced two
meshes remaining after unload; it now verifies three repeated unloads, resource
disposal exactly once, registry cleanup, and repeated area disposal.

## Measurements

The harness starts through character creation, returns prologue T3 possession
to the Exile, and uses synthetic party recruitment through engine APIs. It
direct-loads `101PER`, `102PER`, and `106PER`, then overwrites and reloads slot 2
in its own unique writable user-data directory. It checks the exact saved slot,
module readiness, party and controlled-character identity, loaded models, and
advancing XR frames. This is lifecycle stress, not authored campaign progression
or proof of all saved gameplay fields.

Heap readings use `Runtime.getHeapUsage` after discarding debugger console
handles and collecting garbage. Text diagnostics are retained. Both compared
runs used this method. The earlier October 5 two-module test did not clear
console handles, so its absolute heap values are not a controlled comparison.
The allocation-profile/heap-snapshot run was diagnostic only; the final run had
no sampling profiler or heap snapshot attached.

The following table compares the last three matching visits: cycles 5/7/9 for
solo parties and 6/8/10 for three-member parties. Each first-to-last interval
contains **12 transitions plus four reloads**.

| State | Before: heap change (MiB) | After: heap change (MiB) |
|---|---:|---:|
| Solo `101PER` arrival | +162.528 | -0.039 |
| Solo `102PER` arrival | +162.215 | -0.474 |
| Solo `106PER` arrival | +160.905 | -1.529 |
| Solo `106PER` reload | +163.636 | +0.980 |
| Three-member `101PER` arrival | +163.689 | +1.040 |
| Three-member `102PER` arrival | +164.453 | +1.381 |
| Three-member `106PER` arrival | +163.405 | +0.639 |
| Three-member `106PER` reload | +163.928 | +1.405 |

The automatic summary is more conservative: it excludes only the first
occurrence of each state. It therefore includes a later approximately 23 MiB
step in the solo `101PER`/`102PER` series between cycles 3 and 5, reporting
+23.073/+22.530 MiB across cycles 3–9. That step did not repeat in the final
three samples. Its exact allocation source has not been isolated; the observed
late plateau must not be described as proof of zero residual growth.

The `106PER` scene counts remained at 4,484 solo and 4,693 with three members
after the fix. Every sample had zero stale encounter meshes, zero stale waypoint
helpers, and zero uncached script situations. Renderer counts varied slightly
with live content; no claim of universally identical allocations is made.
Final arrivals/reloads took roughly 22–26 seconds. Early checks ran alongside
other validation, so these timings are not a controlled performance benchmark.

Console errors were retained: one missing `swkotor2.ini` probe, one missing
`repute.fac` diagnostic, and ten missing optional `pifo.ifo` reads, one per reload.
These were also present before the fix and were not uncaught page exceptions.

## Validation and evidence

| Check | Result |
|---|---|
| Jest, including engine actions | 266 suites / 2,527 tests passed |
| Emulator tooling tests | 142 passed |
| Configured TypeScript check | Passed |
| Fresh webpack build | Passed; existing 30/21 warning groups |
| `vr:check` with `Saves/000708 - Game707` | 28/28 passed |
| Extended soak | 40/40 measured load operations completed |
| Whitespace/diff check | Passed |

Final observed serving bundle SHA-256:
`e71d8c6405d2cc3735451242ef28bcef35f53a11578bb6970d302746cb309359`.

Local ignored evidence:

- Before: `evidence/memory-soak-2026-10-07-run4/memory-soak.json`.
- After: `evidence/memory-soak-fixed-2026-10-07/memory-soak.json`.
- Allocation profiles and heap snapshot: `evidence/memory-soak-profile/`.
- Matching console/build/test logs: `evidence/memory-soak-*.log`.

The portable result is this report; instructions are in [MEMORY-SOAK.md](MEMORY-SOAK.md).
The earlier failed fixture attempts remain in evidence. In particular, direct
fresh-state `103PER` entry did not return to gameplay within the timeout. Its
authored entry remains covered separately by the fresh campaign acceptance test.

Remaining acceptance: longer sessions across the rest of the campaign,
additional companion/story states, TSLRCM, total native/GPU memory, and sustained
physical-headset comfort/cadence/memory. Unrelated working-tree changes and
existing saves were preserved.
