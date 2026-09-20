# Task 6 parity-ledger promotion report

Date: 2026-09-20

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
node --test tools/parity/ledger-adapter.test.js tools/parity/compare.test.js tools/parity/parity-contract.test.js
# 30 passed, 0 failed

npx jest --ci --silent src/tests/parity-ledger-adapter.test.ts src/tests/defect-ledger.test.ts
# 2 suites passed, 13 tests passed
```

The TypeScript seam test passes normalized comparator-shaped array and `null`
values through `createDefectRecord`, the real ledger validator.

Additional final checks completed successfully:

```text
npx tsc --noEmit -p tsconfig.kotorjs.json
npx jest --ci --silent
node --test tools/parity/*.test.js
```

## Final 101PER capture attempt

The existing `tools/parity/out/101per.retail.json` remains retained locally.
A fresh canonical engine capture was attempted with:

```text
node tools/parity/engine-snapshot.js --module 101PER --canonical
```

It was blocked before capture because port 8479 was already owned by process
`25404`:

```text
node.exe tools/asset-http/asset-server.js --dist C:/Users/allen/source/repos/kotor2-vr-parity/dist
```

The service's authenticated launch URL/token cannot be inferred safely. It was
not stopped or replaced. Consequently there is no fresh canonical engine
snapshot, parity report, or ledger-output artifact for this Task 6 revision.
Run the documented capture sequence with the owning service's explicit launch
URL (or after its owner ends it) to complete that evidence lane.

## Acceptance boundary

Automated unit and emulator evidence do not establish physical-headset
acceptance. Presentation, comfort, haptics, stereo, and compositor behavior
remain a separate manual headset gate.
