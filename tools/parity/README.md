# Retail parity checks

Compares what our engine does with what retail KOTOR II ships, using PyKotor
(the library under kotormcp) as the retail oracle. Three checks:

## Contract, authority, and adoption

`parity-contract.js` is the boundary shared by later capture and comparison
steps. Canonical engine evidence must begin through the visible fresh-new-game
route (never the sweep's save bootstrap), must not be save-derived, and must
name the module and SHA-256 of the bundle actually served to the harness.
Local captures also record checkout commit and bundle modification time.
Bundle provenance comes from CDP observers installed before navigation: the
completed network response and Chrome's parsed main-frame script source must
have the same SHA-256 and match the content-addressed URL. DOM and performance
APIs cannot supply this identity. Missing, duplicate, failed, or uncorrelated
runtime observations fail closed, including captures requested through `--url`.
The response loader and live default execution context must belong to the active
main-frame document. Bootstrap and snapshot evaluations use that context's unique
CDP identifier; document navigation or context destruction invalidates the capture.
`--url` is hashed from that URL and records neither local commit nor mtime, so
it never borrows the local checkout's bundle identity. Evidence records must name their
module-scoped, typed resource identity, hash, and authority. The available finding classifications are deliberately
closed: `engine-defect`, `authored-retail-behavior`,
`unsupported-but-nonblocking`, `missing-evidence`, and
`variable-runtime-output`.

Retail game assets are read-only source-of-truth inputs. A canonical engine
capture is only a fresh-state observation; a save can be useful for diagnosis
but is never canonical parity evidence. Retail lookups remain scoped to the
module's capsules. KotorMCP/PyKotor parsed data is retail evidence; Holocron is
supporting human review only; DeNCS output is a hypothesis only and cannot
override a retail input hash or promote a finding on its own.

The initial user-owned scaffold was adopted unchanged from the approved working
tree after recording these SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `compare.js` | `6F88A5EF2FA490CAEBDB8973AD6C22653539B97D93B1373484CF21DF75BA94AA` |
| `compare.test.js` | `B2FB08A7143CCBFB8268B8CAA6B7607F531E82D4CBC7E0E1D3C77C81C6BA589E` |
| `engine-save.js` | `144440D0EB627B52198C3FF76295DBB53D0A5F5541B7C99DB1088355B2E26009` |
| `engine-snapshot.js` | `3F63E08C2371EA55D80A48BCB3917DCECD5DD9FBA5FAE63905FCF87E0438A0AE` |
| `retail_snapshot.py` | `5F2BE2D0957D77A6FBA05DD95CB514B31A33C545E8E0D9FFBAEF6CBDAC5AE388` |
| `save_schema.py` | `C64E724B5C560D2DE4E69F1D063827596C96D97D951310DC370B70733878A7AE` |

`tools/parity/out/` is gitignored evidence retention, never source adoption.
The fixed `<module>.engine.json`, `<module>.retail.json`, and report files are
latest-capture convenience pointers only. `compare.js` freezes every compared
engine, retail, optional sidecar, and report into a content-addressed
`out/captures/<module>/<sha256>/` manifest. Artifacts use workspace-relative
POSIX paths to the direct `engine.json`, `retail.json`, `comparison.json`, and
optional `sidecar.json` files. Promotion resolves them against this checkout
regardless of the process working directory and rejects foreign prefixes,
traversal, unexpected artifact keys, symlinks, and junctions. Legacy absolute
artifact manifests must be recaptured. Ledger promotion accepts only that
verified manifest and emits those immutable artifact paths, so an existing
ledger record never changes when a later capture refreshes the fixed files. Do
not commit retail assets, extracted NCS/NSS, GUI exports, or save data there.

| Check | Retail side | Engine side | Report |
|---|---|---|---|
| Creatures (stats, classes, feats, powers, skills, equipment, appearance) | `retail_snapshot.py` reads the module GIT and each UTC | `engine-snapshot.js` loads the module and reads live `ModuleCreature`s | `compare.js` |
| Textures (which layer each name resolves from) | `retail_snapshot.py` resolves every name per layer, in retail order | `engine-snapshot.js` reads `TextureLoader.routingDiagnostics` | `compare.js` |
| Save format (GFF field types and coverage) | a retail `SAVEGAME.sav` | a save written by `engine-save.js` | `save_schema.py` |

## Running

PyKotor lives in the kotormcp virtualenv:

```bash
PY=C:/Users/allen/Tools/kotormcp-local/.venv/Scripts/python.exe
```

Per module (build first; the engine side measures `dist/`):

```bash
node tools/parity/engine-snapshot.js --module 102PER
$PY tools/parity/retail_snapshot.py --module 102PER --textures tools/parity/out/102per.engine.json
node tools/parity/compare.js --module 102PER
```

Save format:

```bash
node tools/parity/engine-save.js --module 101PER        # last line = new save folder
python tools/parity/save_schema.py --retail "<game>/saves/000002 - Game1" --engine "<that folder>"
```

`save_schema.py` needs no PyKotor. It has its own GFF reader, so it can still
open saves from builds that wrote empty lists as `0xFFFFFFFF`.

Output goes to `tools/parity/out/` (gitignored).

## Defect-ledger promotion

After reviewing a parity report, create ledger-ready records only from findings
whose `classification` is exactly `engine-defect`:

```bash
node -e "const fs=require('fs'); const {toParityDefectRecords}=require('./tools/parity/ledger-adapter'); const report=JSON.parse(fs.readFileSync('tools/parity/out/101per.parity.json')); console.log(JSON.stringify(toParityDefectRecords(report, 'tools/parity/out/101per.parity.json'), null, 2));"
```

Each emitted record includes only capture-specific immutable engine, retail,
comparison, and optional sidecar paths from the verified manifest. A report
pathname or fixed latest baseline pathname alone is not evidence and cannot
promote a finding. A matching sidecar is supplementary, not required:
ordinary confirmed deterministic mismatches retain their baseline provenance
through those two snapshots. `authored-retail-behavior`,
`unsupported-but-nonblocking`, `missing-evidence`, and
`variable-runtime-output` remain report observations and are never promoted.
The adapter rejects a promotable finding without verified fresh-state engine
provenance, matching module identities, hashed retail inputs, and retained
artifact contents; it does not invent provenance. Repeated
findings with the same normalized code are grouped in stable object-identity
order with a canonical code title. Every source finding must explicitly contain
expected and observed values before grouping. Arrays and `null` values are
serialized explicitly as JSON.

The automated parity tools establish data and engine-observation evidence only.
They do not accept headset presentation, comfort, haptics, stereo, or compositor
behavior; any such question remains a manual headset-review gate.

## Retail provenance

Every retail snapshot includes `retailInputs`, an immutable, deduplicated list
of `{resref, restype, source, sha256}` records. `resref` is lower-case,
`restype` is upper-case, `source` is the exact retail path, and `sha256` is
computed from the exact resource or capsule bytes used by the snapshot. The
list includes the active module capsules, GIT, compared UTC/UTI/UTS templates,
and the 2DA/template inputs that define the captured audio behavior chain.

Module-local template and texture resolution always receives the non-empty
capsule list returned by `Module(module_name, Installation(game))`. Do not
substitute `SearchLocation.MODULES`: a global lookup can select the same resref
from a different module and invalidate the comparison. A missing capsule list
is a capture error, not a fallback condition.

## Reading a report

Findings are grouped by code and ranked by how many objects each touches.

- **defect**: a template value retail never changes at spawn differs. This is our bug.
- **variable**: retail can change it at spawn (autobalance, OnSpawn scripts, item
  bonuses). Check it against the rules, but it isn't proof of a bug.
- **coverage**: couldn't be compared (creature missing, texture never requested).

## Traps found while building this

- **`SearchLocation.MODULES` searches every module.** It returned 102PER's
  droids from `101PER_s.rim`, which has different stats. Use `CUSTOM_MODULES`
  with the module's own capsules.
- **PyKotor 2.3.12 swaps the arm slots.** Its `RIGHT_ARM` is `0x80`, but
  `tsl_nwscript.nss` defines `INVENTORY_SLOT_LEFTARM = 7`, which is also `0x80`.
  `compare.js` maps slots by bit value.
- **Saved modules differ from templates.** A module in `gameinprogress` loads
  from the save. Equipped items in saves (retail's too) have no resref, so they
  are compared by tag. `engine-snapshot.js` records `loadedFromSave`.
- **Retail UTCs have no `MaxForcePoints`.** Only `ForcePoints` and `CurrentForce`.
- **The session's kotormcp may not be the patched one.** The desktop config used
  to launch `uvx kotormcp` (stock, broken `describeResource`) rather than
  `C:\Users\allen\Tools\kotormcp-local`.

## Decompiling scripts

When a behaviour differs, not a value, decompile the retail script:

```bash
tools/dencs/NCSDecompCLI/NCSDecompCLI.exe -i script.ncs -o script.nss --k2
```

Pull the `.ncs` out with PyKotor (`inst.resource(name, ResourceType.NCS)`) first.
