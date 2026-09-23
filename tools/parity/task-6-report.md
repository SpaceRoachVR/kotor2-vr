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

## Bounded behavior chain: 101PER MedCom, medical log one (2026-09-22)

The behavior-chain group is now `complete` on both sides, for one interaction
only: using MedCom and choosing "Access medical logs." then "Access Log 253-12.".

- **Retail:** `retail_snapshot.py` resolves the active module's GIT → UTP
  (`comppnl001`, OnUsed `a_compdlg`, conversation `medlog`) → DLG path
  `[0, 16, 14, 19]` → NCS, and hash-pins all five scripts on that path. The
  expected result, `101PER_Med_Log` = 1, is claimed only for the exact 52-byte
  `a_setmedlog1` that pushes 1 before SetGlobalNumber (581).
- **Engine:** the fresh canonical capture drives the interaction through the
  real VR route and records, in order: `ActionUseObject` on MedCom queued on
  the player, MedCom's own OnUsed instance (`a_compdlg`) run on MedCom, then
  `a_setmedlog1`, and the global reading 0 before and 1 after. Any gap, wrong
  target or out-of-order step fails closed to `missing-evidence`.

Three things the live page showed that source reading had not, each of which
made the drive "fall short" before it could observe anything:

1. **No immersive session.** Approaches are driven by the VR stick, and the
   capture never entered VR, so the player never moved (every attempt stopped at
   the 27.21m spawn distance). The driver now enters VR first.
2. **001EBO's `intro` conversation survives the direct load** into 101PER with
   its menu hidden, holding DIALOG mode; skipping lines never ends it. The driver
   ends that one carried-over conversation the way DialogAbort does and plays any
   genuine 101PER conversation out. The controlled character at this point is
   T3-M4.
3. **MedCom sits behind the medbay's two doors.** The approach still refuses
   every unapproved door; exactly the unlocked `PeragusDoor1` doors within 10m
   of MedCom are approved (live: 7.8m and 5.2m, next is ~23m).

Scripts are traced at `NWScriptInstance.prototype.run`. A hook on the reply
node's own instance missed `a_setmedlog1` while the global still changed, so a
per-instance hook could not prove the reply did or did not run.

This proves one authored action → script → state chain, not action or script
parity in general.

Final gates on this branch: node parity tests 94/94, vr-emulator node tests
91/91, retail Python tests 13/13 and evidence 8/8, `tsc` clean, Jest 166
suites / 1,461 tests, `vr:check` 25/25. Comparison after the chain landed:
86 findings in 4 groups (1 defect `stat:bodyVariation`, 1 variable, 2
coverage: model presentation and audio play style).

## Acceptance boundary

Automated unit and emulator evidence do not establish physical-headset
acceptance. Presentation, comfort, haptics, stereo, and compositor behavior
remain a separate manual headset gate.
