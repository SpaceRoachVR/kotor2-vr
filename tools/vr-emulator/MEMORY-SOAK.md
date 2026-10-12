# Sustained module lifecycle measurement

Build the browser bundle, then run:

```powershell
npm run webpack:dev
node tools/vr-emulator/memory-soak.js
```

The default is ten cycles across `101PER`, `102PER`, and `106PER`: 30 direct
module transitions and ten save/reload operations. Odd cycles use the Exile
alone. Even cycles recruit Atton and T3 through the engine party APIs, switch
leadership to T3 and back, and carry the three-member party through the loop.
The initial prologue T3 possession is returned to the Exile before this fixture
is assembled. This is a synthetic lifecycle stress test, not a campaign route
or proof of authored recruitment, VR wheel input, or physical gestures.

The test launches a fresh game through character creation. It creates a unique
writable user-data directory beneath its output directory, and overwrites only
save slot 2 in that isolated root. Existing user saves and the retail install
are not modified. The service defaults to port 8487 and CDP to 9447; override
them with `--port` and `--cdp-port` when needed. A conflicting port is an error.

Optional `--cycles`, `--modules 101PER,102PER,106PER`, and `--out <directory>`
control the run. Choose modules with compatible entry conditions. A direct
fresh-state entry into `103PER` did not return to gameplay in the initial
experiment; that failure is not a memory verdict or an authored-route defect.

`--profile` records a CDP retained-allocation sampling profile after every
cycle (`allocations-<cycle>.json`). Use it to investigate growth, then repeat
without profiling for verification; profiling and heap inspections affect
timings and memory management.

Each reading requires the requested module to be loaded and ready, live party
models, and at least ten advancing XR frames. Save/reload additionally checks
the party identities and controlled character. Encounter meshes must belong
to the active area; a stale mesh fails the measurement. Diagnostics include object
ResRef, Tag, ID, Type, NPC slot, and explicit presence. A partial JSON report is
replaced atomically after each sample and retained on failure, alongside the
observed serving-bundle identity and runtime errors.

Measurements discard DevTools console object handles and collect garbage
before retained-heap sampling. The console text remains
in the report. Clearing debugger handles isolates engine ownership; it does
not prove that keeping DevTools object logs indefinitely has bounded memory.
Renderer geometry and texture counts are allocation counts, not GPU bytes.
Heap measurements likewise exclude native browser, audio, and compositor memory.

The summary groups by module, operation (transition or reload), controlled
character, and actual party composition. It discards the first sample in each
group as warm-up and reports the remaining heap/resource deltas. A completed
run only means the operations and runtime checks completed. It does not
automatically declare a memory plateau: inspect the series, resource ownership,
and any remaining growth. Load times are diagnostic wall times, not headset
performance measurements.

For regression checks:

```powershell
node --test tools/vr-emulator/memory-soak.test.js
npx jest --ci --silent
npx tsc --noEmit -p tsconfig.kotorjs.json
npm run webpack:dev
npm run vr:check -- --save "Saves/000708 - Game707"
```

Physical-headset endurance, the rest of the campaign, authored save-state
round-trip correctness beyond party identity, and mod compatibility remain
separate acceptance gates.
