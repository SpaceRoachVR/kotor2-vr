# Parity Observability Foundation

## Purpose

Create a repeatable, evidence-backed way to establish whether the TypeScript
engine reproduces authored KOTOR II behavior. The foundation starts with the
fresh-state `101PER` Peragus module and extends the existing `tools/parity/`
tooling rather than creating a parallel framework.

The outcome is not a claim of campaign parity. It is a trustworthy parity
ledger that identifies the retail source, live engine observation, confidence,
and regression evidence behind every confirmed mismatch.

## Goals

- Make a fresh-new-game `101PER` capture the canonical baseline for static and
  spawn-time comparison.
- Compare creature rules, resource provenance, audio configuration, model and
  animation state, and one authored behavior chain.
- Preserve retail data as read-only and preserve authored action queues, d20
  rules, scripts, animations, and content semantics.
- Classify differences before proposing a code change.
- Reuse the current module sweep and `DefectLedger` record contract.

## Non-goals

- A full Peragus playthrough or campaign-wide content audit.
- Replacing the engine's loaders, action system, or existing sweep tooling.
- Treating DeNCS output as an executable or authoritative replacement for
  retail bytecode.
- Physical-headset acceptance. Emulation validates engine behavior and routes;
  headset comfort, stereo presentation, haptics, and compositor behavior remain
  manual acceptance gates.

## Architecture

The system has three immutable evidence inputs and one promotion boundary.

1. **Retail snapshot.** `retail_snapshot.py` reads the original module capsules,
   templates, 2DAs, and resource layers through PyKotor/KotorMCP-compatible
   resolution. Every source resource records its normalized resref, type, path,
   and SHA-256 hash.
2. **Engine snapshot.** `engine-snapshot.js` launches the freshly bundled engine
   through the existing harness, establishes a clean new-game state, loads
   `101PER`, and copies live state into plain JSON. It must state whether the
   module originated from a save; canonical captures fail if it did.
3. **Behavior evidence.** A selected interaction stores source GFF/DLG/NCS
   metadata, the NCS hash, optional DeNCS source, and an engine action/event/
   state trace. DeNCS explains a hypothesis; comparison is against retail data
   and observed engine state.
4. **Comparator and ledger.** `compare.js` ranks structured findings. Only a
   confirmed engine defect emits a `DefectLedger`-validated record with exact
   reproduction steps and evidence references.

`tools/parity/out/` remains ignored because it can contain large captures and
retail-derived metadata. Checked-in inputs are schemas, comparison logic,
deterministic fixtures, and compact baseline manifests only.

## Evidence classification

Every finding has exactly one initial classification:

| Classification | Meaning | Promotion rule |
|---|---|---|
| `engine-defect` | Static or deterministic authored behavior differs in the engine. | Create a ledger record and focused regression test. |
| `authored-retail-behavior` | The retail data intentionally specifies the observed behavior. | Record as accepted behavior; do not change engine code. |
| `unsupported-but-nonblocking` | The behavior is known but intentionally outside current scope. | Record scope and impact; no false parity claim. |
| `missing-evidence` | The comparison lacks a reliable source, state, or reproduction. | Add a probe; do not fix. |
| `variable-runtime-output` | Spawn scripts, autobalance, save state, equipment modifiers, or timing legitimately alter a value. | Compare the governing rule, or capture a clean deterministic state. |

The existing report labels `defect`, `variable`, and `coverage` map respectively
to candidate `engine-defect`, `variable-runtime-output`, and
`missing-evidence`. A human triage step determines the final classification.

## Tool roles

### KotorMCP

Use KotorMCP for machine-readable installation discovery, module-scoped
resource lookup, source-path provenance, and resource summaries. Queries must
be scoped to the active module capsules when a resource may exist in multiple
modules; a global modules search can resolve the wrong template.

### Holocron Toolset

Use Holocron Toolset for reviewer inspection of ambiguous GFF, DLG, 2DA, MDL,
TXI, and module-object relationships. Attach the inspected resource identity to
the evidence record. A visual inspection supplements parsed values; it does not
replace the recorded source or hash.

### DeNCS

Use DeNCS only after a behavior mismatch identifies a relevant retail NCS.
Archive the NCS identity and hash alongside the decompiled output and specify
the selected game definitions. The resulting NSS is investigative evidence;
the original bytecode, GFF/DLG trigger references, and engine action/state trace
remain the decision inputs.

## 101PER proof probes

1. **Bootstrap identity.** Verify a fresh run enters `101PER` with T3-M4, the
   authored party state, and no save-derived module state.
2. **Creature rules.** Compare GIT/UTC instances and live creatures: attributes,
   classes, feats, powers, skills, equipment, appearance, base HP/FP, and saves.
3. **Texture provenance.** Compare all retail model texture names and all engine
   requests by resref, source layer, dimensions, decode result, and diagnostic.
   Preserve TXI-related risks as explicit evidence rather than assuming a loaded
   texture renders correctly.
4. **Audio semantics.** Compare area music and ambience plus every placed UTS.
   Begin with the reported `continuous` mismatches and establish the relationship
   between retail continuous, looping, and engine play style before changing
   `AudioEmitter` behavior.
5. **Animation and model state.** Inspect selected player-visible models,
   including the Kreia stunt-body case, to distinguish authored placeable bind
   poses from missing animation, model, or walkmesh behavior.
6. **Authored behavior chain.** Trace one interaction from DLG/GFF/NCS metadata
   to engine action queue, event dispatch, and resulting globals/object state.

## Verification requirements

- Unit tests cover parsers, provenance normalization, clean-state rejection,
  comparison classification, and ledger conversion.
- The parity capture has deterministic fixtures for each classification and a
  negative fixture that proves a save-contaminated capture is rejected.
- After engine logic changes, run `npx jest --ci --silent`. Build fresh output
  with `npm run webpack:dev` before `npm run vr:check` for any VR-reachable path.
- A manual headset pass is requested only for remaining presentation, comfort,
  haptic, stereo, or compositor questions that cannot be settled in the harness.

## Rollout

1. Harden the existing `tools/parity/` baseline around fresh-new-game state and
   input identity.
2. Add KotorMCP, Holocron, and DeNCS evidence adapters without changing retail
   assets or runtime behavior.
3. Implement and validate the six `101PER` probes.
4. Promote confirmed defects through `DefectLedger` with focused tests.
5. Repeat the proven lanes in `102PER`, then use the 82-module sweep to order
   wider work by blast radius.
6. Apply the same foundation to a dedicated chargen/level-up vertical slice for
   feats, Force powers, character stats, and progression.

## Acceptance criteria

- A canonical `101PER` report proves it came from a fresh state and identifies
  every retail input used for comparison.
- Each proof probe has an explicit coverage result: match, confirmed defect,
  authored behavior, unsupported, variable, or insufficient evidence.
- Every promoted defect satisfies `createDefectRecord`, links to retained
  evidence, and has a focused regression test.
- No retail installation file is modified.
- The design makes no physical-headset parity claim without a separate manual
  acceptance record.
