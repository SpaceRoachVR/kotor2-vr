# Parity Observability Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a reproducible fresh-state `101PER` parity report that promotes only confirmed engine defects into the existing evidence ledger.

**Architecture:** Extend the existing untracked `tools/parity/` scaffold with immutable capture manifests, a fresh-state engine bootstrap guard, normalized evidence records, and a ledger adapter. Retail data stays read-only; KotorMCP, Holocron Toolset, and DeNCS contribute evidence with clear authority limits. The existing module-sweep ledger contract remains the sole defect-promotion boundary.

**Tech Stack:** Node.js CommonJS harnesses, TypeScript/Jest, Python 3.11 with PyKotor/KotorMCP, DeNCS Java CLI, Holocron Toolset, JSON and Markdown artifacts.

**Spec:** `docs/superpowers/specs/2026-09-19-parity-observability-foundation-design.md`

## Global Constraints

- Preserve the main checkout's dirty headset-fix work and the existing untracked `tools/parity/` files; reconcile them before editing and never replace them from the clean spec worktree.
- Retail KOTOR II files under `D:\SteamLibrary\steamapps\common\Knights of the Old Republic II` are read-only inputs.
- Canonical captures require a fresh new-game state; `loadedFromSave: true` is a hard rejection, not a warning.
- KotorMCP evidence is module-capsule scoped; never use a global module lookup for a template whose module matters.
- DeNCS output is investigative evidence only; NCS hash, resource reference, retail data, and engine trace govern parity decisions.
- Holocron Toolset observations name the inspected resource and supplement parsed evidence; they never replace source hashes or parsed values.
- Physical headset acceptance is separate from Jest, webpack, and `npm run vr:check` evidence.
- Never run `npm run dev`. Run `npm run webpack:dev` before `npm run vr:check` whenever a VR-reachable path changes.

## Review Focus

- A module restored from `gameinprogress` must fail canonical capture before any snapshot is written; Task 2 adds this test.
- A resource existing in another module must not be reported as a match; Task 3 adds a same-resref, different-capsule fixture.
- A DeNCS artifact whose NCS hash does not match the retail input must be rejected; Task 4 adds this test.
- A loop/continuous audio mismatch must remain `missing-evidence` until play-style semantics are captured; Task 5 adds this test.
- A placeable using a creature model must be classified as authored bind pose when retail metadata says it is a placeable, not an animation defect; Task 5 adds this test.

---

## File structure

| Path | Responsibility |
|---|---|
| `tools/parity/parity-contract.js` | Validates capture identity, evidence records, classifications, and report input invariants. |
| `tools/parity/parity-contract.test.js` | Node tests for contract success and failure cases. |
| `tools/parity/engine-snapshot.js` | Produces a fresh-state engine snapshot and refuses save-derived canonical output. |
| `tools/parity/retail_snapshot.py` | Produces module-scoped retail resource, creature, texture, and audio data plus hashes. |
| `tools/parity/evidence.py` | Writes and validates KotorMCP, Holocron, and DeNCS evidence sidecars without modifying retail files. |
| `tools/parity/evidence.test.py` | Python tests for evidence identity and hash validation. |
| `tools/parity/compare.js` | Merges snapshots and evidence into classified findings and a Markdown report. |
| `tools/parity/ledger-adapter.js` | Converts confirmed defects into `DefectRecord`-shaped records only. |
| `tools/parity/ledger-adapter.test.js` | Tests defect-only promotion and exact evidence references. |
| `src/tests/parity-ledger-adapter.test.ts` | Proves adapter output is accepted by the real `createDefectRecord` validator. |
| `tools/parity/README.md` | Documents commands, artifact retention, classifications, and manual-review boundaries. |

### Task 1: Adopt and lock the existing parity scaffold

**Files:**
- Modify: `tools/parity/README.md`
- Create: `tools/parity/parity-contract.js`
- Create: `tools/parity/parity-contract.test.js`

**Interfaces:**
- Consumes: the main checkout's existing `tools/parity/{retail_snapshot.py,engine-snapshot.js,compare.js,engine-save.js,save_schema.py}`.
- Produces: `createCaptureIdentity(input)`, `validateEvidenceRecord(record)`, and `CLASSIFICATIONS` for later tasks.

- [ ] **Step 1: Reconcile the existing scaffold without overwriting it**

Run:

```powershell
git -C C:\Users\allen\source\repos\kotor2-vr status --short -- tools/parity
Get-FileHash C:\Users\allen\source\repos\kotor2-vr\tools\parity\*.js,C:\Users\allen\source\repos\kotor2-vr\tools\parity\*.py
```

Expected: identify every existing parity file and record its SHA-256 before it is copied into the execution branch. Stop if the execution worktree lacks those files; create the execution worktree from the user-approved working-tree state rather than copying files by hand.

- [ ] **Step 2: Write failing contract tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const { createCaptureIdentity, validateEvidenceRecord } = require('./parity-contract');

test('capture identity rejects save-derived canonical evidence', () => {
  assert.throws(() => createCaptureIdentity({
    module: '101PER', freshState: true, loadedFromSave: true,
    engineCommit: 'abc', bundleMtime: '2026-09-19T00:00:00.000Z', retailInputs: [],
  }), /save-derived/i);
});

test('evidence record requires a resource hash and authority', () => {
  assert.throws(() => validateEvidenceRecord({ kind: 'dencs', resref: 'a_script', hash: '', authority: '' }), /hash|authority/i);
});
```

- [ ] **Step 3: Run the contract test to verify failure**

Run: `node --test tools/parity/parity-contract.test.js`

Expected: FAIL because `parity-contract.js` does not exist.

- [ ] **Step 4: Implement the minimal immutable contract**

```js
const CLASSIFICATIONS = Object.freeze([
  'engine-defect', 'authored-retail-behavior', 'unsupported-but-nonblocking',
  'missing-evidence', 'variable-runtime-output',
]);

function createCaptureIdentity(input) {
  if (!input || input.freshState !== true || input.loadedFromSave === true) {
    throw new TypeError('Canonical parity capture must be fresh and not save-derived');
  }
  for (const field of ['module', 'engineCommit', 'bundleMtime']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) throw new TypeError(`Capture identity requires ${field}`);
  }
  if (!Array.isArray(input.retailInputs) || input.retailInputs.length === 0) throw new TypeError('Capture identity requires retail inputs');
  return Object.freeze({ ...input, module: input.module.toUpperCase(), retailInputs: Object.freeze([...input.retailInputs]) });
}

function validateEvidenceRecord(record) {
  if (!record || typeof record !== 'object') throw new TypeError('Evidence record must be an object');
  for (const field of ['kind', 'resref', 'hash', 'authority']) {
    if (typeof record[field] !== 'string' || !record[field].trim()) throw new TypeError(`Evidence record requires ${field}`);
  }
  return Object.freeze({ ...record });
}

module.exports = { CLASSIFICATIONS, createCaptureIdentity, validateEvidenceRecord };
```

- [ ] **Step 5: Run contract tests**

Run: `node --test tools/parity/parity-contract.test.js`

Expected: PASS.

- [ ] **Step 6: Update the parity README and commit**

Document the adopted file hashes, source-of-truth boundaries, and output retention rule. Then run:

```powershell
git add tools/parity
git commit -m "feat: establish parity evidence contract"
```

### Task 2: Enforce a fresh-new-game canonical engine capture

**Files:**
- Modify: `tools/parity/engine-snapshot.js`
- Modify: `tools/parity/engine-save.js`
- Modify: `tools/parity/parity-contract.test.js`

**Interfaces:**
- Consumes: `createCaptureIdentity(input)` from Task 1 and existing `bootEngine` harness helpers.
- Produces: `engine.captureIdentity`, `engine.loadedFromSave`, and a nonzero exit before output when canonical state is save-derived.

- [ ] **Step 1: Add a failing clean-state test**

```js
test('canonical snapshot refuses a saved module', () => {
  const { assertCanonicalEngineState } = require('./engine-snapshot');
  assert.throws(() => assertCanonicalEngineState({ loadedFromSave: true, playerName: 'T3-M4', partySize: 1 }), /save-derived/i);
});

test('canonical snapshot requires the Peragus bootstrap identity', () => {
  const { assertCanonicalEngineState } = require('./engine-snapshot');
  assert.throws(() => assertCanonicalEngineState({ loadedFromSave: false, playerName: 'Exile', partySize: 1 }), /T3-M4/i);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `node --test tools/parity/parity-contract.test.js`

Expected: FAIL because `assertCanonicalEngineState` is not exported.

- [ ] **Step 3: Implement canonical-state validation and a `--canonical` flag**

```js
function assertCanonicalEngineState(state) {
  if (state.loadedFromSave === true) throw new Error('Canonical parity capture rejected: module is save-derived');
  if (state.playerName !== 'T3-M4' || state.partySize !== 1) {
    throw new Error('Canonical parity capture rejected: expected fresh T3-M4 single-member party');
  }
}

// parseArgs returns { module, url, port, canonical: argv.includes('--canonical') }.
// After the module settles, call assertCanonicalEngineState when canonical is true
// before writing the JSON file.
```

Require `engine-save.js --module 101PER --canonical` to create a named save only after the same assertion passes.

- [ ] **Step 4: Run focused tests and an intentional rejection probe**

Run:

```powershell
node --test tools/parity/parity-contract.test.js
node tools/parity/engine-snapshot.js --module 101PER --canonical
```

Expected: test PASS; capture either emits identity-bearing JSON from a clean state or exits nonzero with `save-derived`, never a canonical report from a save.

- [ ] **Step 5: Commit**

```powershell
git add tools/parity/engine-snapshot.js tools/parity/engine-save.js tools/parity/parity-contract.test.js
git commit -m "feat: require fresh state for canonical parity captures"
```

### Task 3: Record retail provenance through module-scoped data access

**Files:**
- Modify: `tools/parity/retail_snapshot.py`
- Create: `tools/parity/retail_snapshot_test.py`
- Modify: `tools/parity/README.md`

**Interfaces:**
- Consumes: module name and capsule list from `Module(module_name, Installation(game))`.
- Produces: `retailInputs: [{resref, restype, source, sha256}]` and per-record `source` data used by the comparator.

- [ ] **Step 1: Write failing provenance tests**

```python
import unittest
from retail_snapshot import normalize_retail_input, require_module_scoped_capsules

class RetailSnapshotTests(unittest.TestCase):
    def test_normalize_retail_input_requires_hash(self):
        with self.assertRaisesRegex(ValueError, "sha256"):
            normalize_retail_input("a", "UTC", "module", b"")

    def test_module_scoped_lookup_rejects_missing_capsules(self):
        with self.assertRaisesRegex(ValueError, "capsules"):
            require_module_scoped_capsules([])
```

- [ ] **Step 2: Run tests to verify failure**

Run: `python tools/parity/retail_snapshot_test.py`

Expected: FAIL because the helper functions do not exist.

- [ ] **Step 3: Implement source normalization and explicit capsule validation**

```python
def require_module_scoped_capsules(capsules):
    if not capsules:
        raise ValueError("Module-scoped lookup requires non-empty capsules")
    return tuple(capsules)

def normalize_retail_input(resref, restype, source, data):
    if not isinstance(data, bytes) or not data:
        raise ValueError("Retail input requires non-empty bytes for sha256")
    return {"resref": resref.lower(), "restype": restype.upper(), "source": str(source),
            "sha256": hashlib.sha256(data).hexdigest()}
```

Use `require_module_scoped_capsules(capsules)` in every `CUSTOM_MODULES` lookup, and include hashes for module RIMs, GIT, all compared templates, and behavior-chain resources.

- [ ] **Step 4: Run tests and a retail snapshot**

Run:

```powershell
python tools/parity/retail_snapshot_test.py
python tools/parity/retail_snapshot.py --module 101PER --out tools/parity/out/101per.retail.json
```

Expected: tests PASS; output contains non-empty `retailInputs` with normalized resrefs and 64-character SHA-256 hashes.

- [ ] **Step 5: Commit**

```powershell
git add tools/parity/retail_snapshot.py tools/parity/retail_snapshot_test.py tools/parity/README.md
git commit -m "feat: capture module-scoped retail provenance"
```

### Task 4: Add tool-evidence sidecars with explicit authority

**Files:**
- Create: `tools/parity/evidence.py`
- Create: `tools/parity/evidence.test.py`
- Modify: `tools/parity/compare.js`

**Interfaces:**
- Consumes: a retail input record from Task 3.
- Produces: `load_evidence(path) -> list[dict]` and `validateEvidenceRecord(record)`-compatible JSON sidecars with `kind`, `resref`, `restype`, `sha256`, `authority`, and `path`.

- [ ] **Step 1: Write failing evidence tests**

```python
import unittest
from evidence import validate_evidence

class EvidenceTests(unittest.TestCase):
    def test_dencs_hash_must_match_retail_ncs(self):
        with self.assertRaisesRegex(ValueError, "hash"):
            validate_evidence({"kind": "dencs", "resref": "a_script", "restype": "NCS",
                               "sha256": "0" * 64, "authority": "hypothesis", "path": "a_script.nss"},
                              {"a_script:NCS": "1" * 64})
```

- [ ] **Step 2: Run test to verify failure**

Run: `python tools/parity/evidence.test.py`

Expected: FAIL because `evidence.py` does not exist.

- [ ] **Step 3: Implement evidence validation and sidecar format**

```python
ALLOWED_KINDS = {"kotormcp", "holocron", "dencs"}
ALLOWED_AUTHORITIES = {"parsed-retail", "human-review", "hypothesis"}

def validate_evidence(record, retail_hashes):
    if record.get("kind") not in ALLOWED_KINDS or record.get("authority") not in ALLOWED_AUTHORITIES:
        raise ValueError("Unsupported evidence kind or authority")
    key = f"{record.get('resref', '').lower()}:{record.get('restype', '').upper()}"
    if record["kind"] == "dencs" and retail_hashes.get(key) != record.get("sha256"):
        raise ValueError("DeNCS evidence hash does not match retail NCS")
    return record
```

Write sidecars to `tools/parity/out/<module>.evidence.json`; do not copy retail NCS, NSS, or GUI-exported asset contents into the repository. Extend `compare.js` to list linked evidence paths in each finding without changing a finding's classification.

- [ ] **Step 4: Run evidence tests and a sidecar smoke check**

Run:

```powershell
python tools/parity/evidence.test.py
python tools/parity/evidence.py --help
node tools/parity/compare.js --module 101PER
```

Expected: tests PASS; comparator retains evidence links and does not promote a hypothesis-only record to a defect.

- [ ] **Step 5: Commit**

```powershell
git add tools/parity/evidence.py tools/parity/evidence.test.py tools/parity/compare.js
git commit -m "feat: attach bounded parity tool evidence"
```

### Task 5: Add presentation-aware audio and animation probes

**Files:**
- Modify: `tools/parity/retail_snapshot.py`
- Modify: `tools/parity/engine-snapshot.js`
- Modify: `tools/parity/compare.js`
- Modify: `tools/parity/compare.test.js`

**Interfaces:**
- Consumes: retail UTS fields, model/template types, and live `ModuleSound`/placeable/model state.
- Produces: `audioSemantics`, `modelPresentation`, and a `missing-evidence` finding when a semantic mapping is unproven.

- [ ] **Step 1: Write failing comparison tests**

```js
test('continuous audio is not an engine defect without a captured play-style mapping', () => {
  const { classifyAudioSemantic } = require('./compare');
  assert.equal(classifyAudioSemantic({ continuous: true }, { continuous: false }, null), 'missing-evidence');
});

test('a placeable creature model is authored bind-pose evidence, not an animation defect', () => {
  const { classifyModelPresentation } = require('./compare');
  assert.equal(classifyModelPresentation({ objectType: 'placeable', modelKind: 'creature' }, { animationApplied: false }),
    'authored-retail-behavior');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test tools/parity/compare.test.js`

Expected: FAIL because the two classification functions are not exported.

- [ ] **Step 3: Implement metadata capture and conservative classification**

```js
function classifyAudioSemantic(retail, engine, playStyleMapping) {
  if (!playStyleMapping) return 'missing-evidence';
  return playStyleMapping[retail.continuous] === engine.playStyle ? 'authored-retail-behavior' : 'engine-defect';
}

function classifyModelPresentation(retail, engine) {
  if (retail.objectType === 'placeable' && retail.modelKind === 'creature' && engine.animationApplied === false) {
    return 'authored-retail-behavior';
  }
  return engine.animationApplied ? 'authored-retail-behavior' : 'missing-evidence';
}
```

Retail records must include UTS `continuous`, `looping`, `random`, and selected template/object type. Engine records must include equivalent sound settings, resolved play style, object type, model kind, requested animation, and whether an animation was applied. Do not alter `AudioEmitter` or model runtime code in this task.

- [ ] **Step 4: Capture and inspect 101PER**

Run:

```powershell
npm run webpack:dev
node tools/parity/engine-snapshot.js --module 101PER --canonical
python tools/parity/retail_snapshot.py --module 101PER --textures tools/parity/out/101per.engine.json
node tools/parity/compare.js --module 101PER
node --test tools/parity/compare.test.js
```

Expected: tests PASS; the report labels the ten continuous mismatches `missing-evidence` unless a documented mapping exists, and labels the Kreia placeable case without claiming a missing animation.

- [ ] **Step 5: Commit**

```powershell
git add tools/parity/retail_snapshot.py tools/parity/engine-snapshot.js tools/parity/compare.js tools/parity/compare.test.js
git commit -m "feat: classify parity audio and model evidence"
```

### Task 6: Promote confirmed defects through the real ledger contract

**Files:**
- Create: `tools/parity/ledger-adapter.js`
- Create: `tools/parity/ledger-adapter.test.js`
- Create: `src/tests/parity-ledger-adapter.test.ts`
- Modify: `tools/parity/compare.js`
- Modify: `tools/parity/README.md`

**Interfaces:**
- Consumes: comparator findings with classification, module, expected, observed, reproduction steps, and evidence references.
- Produces: `toParityDefectRecords(report, evidencePath)` returning records accepted by `createDefectRecord`.

- [ ] **Step 1: Write failing adapter tests**

```js
test('only confirmed engine defects become ledger records', () => {
  const { toParityDefectRecords } = require('./ledger-adapter');
  const records = toParityDefectRecords({ module: '101PER', findings: [
    { classification: 'engine-defect', code: 'sound:play-style', object: 'metalstrain#0', expected: 'loop', observed: 'oneshot', evidenceRefs: ['101per.evidence.json'] },
    { classification: 'missing-evidence', code: 'sound:continuous', object: 'rumble#1' },
  ] }, 'tools/parity/out/101per.parity.json');
  assert.equal(records.length, 1);
  assert.match(records[0].id, /^parity-101per-sound-play-style$/);
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `node --test tools/parity/ledger-adapter.test.js`

Expected: FAIL because `ledger-adapter.js` does not exist.

- [ ] **Step 3: Implement defect-only conversion**

```js
function toParityDefectRecords(report, reportPath) {
  return report.findings.filter((finding) => finding.classification === 'engine-defect').map((finding) => ({
    id: `parity-${report.module.toLowerCase()}-${finding.code.replace(/[^a-z0-9]+/gi, '-')}`,
    title: `${finding.code} in ${report.module}`,
    module: report.module.toUpperCase(), room: finding.room || '(module-wide)',
    severity: finding.severity || 'major', status: 'open',
    expected: String(finding.expected), observed: String(finding.observed),
    reproductionSteps: finding.reproductionSteps || [`node tools/parity/compare.js --module ${report.module}`],
    evidenceRefs: [...new Set([reportPath, ...(finding.evidenceRefs || [])])],
  }));
}
module.exports = { toParityDefectRecords };
```

Add a TypeScript test importing the CommonJS adapter and passing every emitted record to `createDefectRecord`, following `src/tests/module-sweep-ledger.test.ts`.

- [ ] **Step 4: Run adapter, Jest, and emulator gates**

Run:

```powershell
node --test tools/parity/ledger-adapter.test.js tools/parity/compare.test.js tools/parity/parity-contract.test.js
npx jest --ci --silent src/tests/parity-ledger-adapter.test.ts src/tests/defect-ledger.test.ts
npm run webpack:dev
npm run vr:check
```

Expected: all automated checks PASS. Any remaining player-visible question is recorded for manual headset review rather than presented as acceptance.

- [ ] **Step 5: Write the final 101PER report and commit**

Document exact commands, evidence retention, classifications, and manual boundaries in `README.md`. Then run:

```powershell
git add tools/parity src/tests/parity-ledger-adapter.test.ts
git commit -m "feat: promote confirmed parity defects to ledger"
```

## Final verification

- [ ] Run `git status --short` and confirm only intended parity files changed.
- [ ] Run `node --test tools/parity/*.test.js`.
- [ ] Run `npx jest --ci --silent`.
- [ ] Run `npm run webpack:dev` followed by `npm run vr:check`.
- [ ] Capture canonical `101PER`, retail snapshot, evidence sidecar, comparison report, and ledger output.
- [ ] State separately whether the manual headset gate is still pending.
