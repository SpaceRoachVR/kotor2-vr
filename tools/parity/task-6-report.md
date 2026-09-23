# Task 6 parity-ledger promotion report

Updated: 2026-09-22 (local)

## Delivered

`ledger-adapter.js` promotes only findings classified exactly as
`engine-defect`. Findings with the same normalized code are grouped into one
deterministic ledger record, ordered by their stable `object` identity. The
grouped `expected` and `observed` values retain every object/value pair as JSON.
Single values preserve non-empty strings and serialize arrays, objects, empty
strings, and `null` explicitly as JSON-compatible non-empty strings.

Every ledger record includes the retained parity-report path and requires
report-level provenance for both matching engine and retail snapshots. The path
alone cannot promote a finding. Matching evidence sidecars are optional
supplementary references, so ordinary deterministic confirmed mismatches can
promote without pretending a sidecar exists.

The promotion boundary rejects a report that has only a report path or only one
baseline snapshot reference, rejects missing source `expected`/`observed`
values before grouping, and selects a stable canonical title when distinct
codes normalize to the same ledger ID.

## Automated evidence

Completed successfully:

```text
node --test tools/parity/*.test.js
# 90 passed, 0 failed

C:\Users\allen\Tools\kotormcp-local\.venv\Scripts\python.exe tools/parity/retail_snapshot_test.py
# 11 passed, 0 failed

C:\Users\allen\Tools\kotormcp-local\.venv\Scripts\python.exe tools/parity/evidence.test.py
# 8 passed, 0 failed

npx jest --ci --silent src/tests/parity-ledger-adapter.test.ts src/tests/defect-ledger.test.ts
# 2 suites passed, 13 tests passed
```

The TypeScript seam test passes normalized comparator-shaped array and `null`
values through `createDefectRecord`, the real ledger validator.

Additional checks completed successfully before the latest capture-bootstrap fix:

```text
npx tsc --noEmit -p tsconfig.kotorjs.json
npx jest --ci --silent
node --test tools/parity/*.test.js
```

After the bootstrap fix, the full Jest run again passed (166 suites, 1,461
tests), TypeScript checking passed, and `npm run vr:check` passed 25/25 with a
fresh webpack build. The texture gate now checks the exact retail-verified
absent resrefs rather than a permissive numeric threshold; its run observed
16 distinct known-absent names and no unexpected texture failure.

Five stale `playthrough-navigation.test.js` assertions at this branch's fork
point were updated to match the current authored route implementation without
changing gameplay code. The broader `tools/vr-emulator/*.test.js` Node suite
now passes 91/91. These source-level route tests and the emulated check do not
prove a complete Peragus playthrough or headset behavior.

## Fresh 101PER capture and comparison

A fresh canonical engine capture completed through the visible new-game route,
not a save. The capture reached the authored 001EBO opening, then loaded 101PER:

```text
node tools/parity/engine-snapshot.js --module 101PER --canonical
```

The engine artifact contains 18 creatures and 3,391 texture-routing decisions.
The retail snapshot was generated with the configured KotorMCP/PyKotor Python
environment, yielding 18 GIT creatures and 279 distinct texture inputs:

```text
& 'C:\Users\allen\Tools\kotormcp-local\.venv\Scripts\python.exe' tools/parity/retail_snapshot.py --module 101PER --textures tools/parity/out/101per.engine.json
node tools/parity/compare.js --module 101PER
```

The comparator paired all 18 creatures and 91 sounds and checked 279 textures.
It reported 87 findings grouped as one deterministic engine defect
(`stat:bodyVariation`, three creatures), one runtime-variable group
(`stat:maxForcePoints`, 18 creatures), and three coverage groups (model
presentation, audio play style, and the bounded behavior chain). The ledger
adapter emits one ledger-ready record, `parity-101per-stat-bodyvariation`, for
the confirmed defect; no persistent defect ledger was modified. The emitted
record references the immutable capture under
`tools/parity/out/captures/101per/c24a6e5f5babb25df078b0ff727a4e4f51fb0ff883eec13c4fe84b5c61d7e6bc/`.
`tools/parity/out/` is gitignored local evidence, so this committed report is
not itself a portable substitute for those capture bytes.

The behavior-chain group remains explicitly `missing-evidence`: no bounded
GFF/DLG/NCS interaction was selected on retail or driven on engine. The
comparison does not imply that action or script parity has been established.

## Acceptance boundary

Automated unit and emulator evidence do not establish physical-headset
acceptance. Presentation, comfort, haptics, stereo, and compositor behavior
remain a separate manual headset gate.
