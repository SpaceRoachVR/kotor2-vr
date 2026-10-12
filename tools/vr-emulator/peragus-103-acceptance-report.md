# Fresh-game Peragus acceptance through T3's fuel depot

The strict emulated Quest 3 campaign passed in one uninterrupted browser session: character creation, the complete Ebon Hawk prologue, Peragus medical bay, Kreia's awakening, Atton's administration code, T3 possession, the hangar/sub-level errands, and first arrival in `103PER`.

## Recorded result

- 94 of 94 steps passed in about 44 minutes; one pass, no saved-state resume, no death retry or reload, and no injected health recovery.
- Bootstrap: `freshGame=true`, `loadedFromSave=false`, authored prologue route `continue`.
- Target: `t3-fuel-depot`; `verdict.passed=true`, with no verdict failures.
- Final state: ready, presenting gameplay in `103PER`, T3-M4 at 30/30 HP, party size 1, and ten advancing XR frames.
- No page exceptions or VR-loop failures.
- Observed serving bundle SHA-256: `a9a26c51f2489972cf3653104458651219c074f58149a78185b1cc28baec587e`.
- Raw local evidence: `evidence/peragus-103-acceptance-passed.json`; navigation log: `evidence/peragus-fresh-acceptance.log`. These ignored artifacts accompany this working checkout; the assertions and reproduction procedure are versionable.

| Milestone | Verified authored state |
| --- | --- |
| Kreia awakened, `101PER` | Live Kreia found; `101PER_Kreia_Spawn=2`, `101PER_Talk_Kreia=1`, `RecoverEbonHawk=10` |
| Atton's code, `101PER` | Live Atton found; `101PER_Know_Adm_Code=1` |
| T3 possession, `106PER` | Controlled tag `T3M4`, NPC slot 8, roster slot 8 available |
| T3 fuel-depot arrival, `103PER` | Controlled tag `T3M4`, NPC slot 8, roster slot 8 available; `RecoverEbonHawk=15` |

All four progression snapshots recorded ready, presenting gameplay. Checkpoints were saved as evidence without loading them during the run.

## Changes supporting the gate

Inventory transfers preserve the live stack count through item initialization and loading, including credits and merged container stacks. Controlled companions retain their NPC identity across module transitions. Saved solo companion control is reconstructed from a unique available roster tag, including saves whose current-members list is empty.

The campaign driver now offers a fail-closed fresh acceptance mode and read-only progression assertions. It follows connected retail walkmesh routes around the exterior lift, cockpit, communications console, hangar ramp, and storage ramp. Short thumbstick pulses release inside the browser to reduce approach overshoot. Droid equipment uses the normal equipment menu, and item abilities use their required trigger input. Combat and interactions enter the engine's existing action queue; navigation can interrupt travel to fight a live attacker.

Acceptance disables diagnostic death recovery, injected health regeneration, forced dialogue termination, and saved-state resumes. Concurrent diagnostic services have independently writable storage as well as separate ports. Retail files and unrelated working-tree edits were preserved.

## Validation

| Check | Result |
| --- | --- |
| Jest, including engine actions | 265 suites, 2,526 tests passed |
| Emulator Node tests | 136 passed |
| TypeScript, `tsconfig.kotorjs.json` | Passed |
| `npm run webpack:dev` | Passed; existing warning groups of 30 and 21 |
| `npm run vr:check -- --save "Saves/000708 - Game707"` | 28/28 passed; zero page exceptions, four known console errors within baseline |
| Strict fresh campaign | 94/94 steps passed; process exit 0 |

The Jest run excluded nested worktree copies from test discovery while retaining the main checkout's engine/action tests. Build and VR checks used the same serving bundle as the accepted campaign.

## Reproduce

```powershell
npm run webpack:dev
node tools/vr-emulator/playthrough.js --acceptance --until t3-fuel-depot
```

Inspect both the process exit status and `verdict.passed` in `evidence/playthrough-report.json`. See [CAMPAIGN-ACCEPTANCE.md](CAMPAIGN-ACCEPTANCE.md) for gate requirements and storage isolation.

## Remaining gates

Long navigation still needs bounded retries around doors and smoothed corners. A separate saved-prefix diagnostic failed at the exterior Quadlasers approach, although the accepted fresh run passed that encounter. This result proves campaign progression for the recorded run, not consistently smooth automation across every starting state.

Combat automation supplies recognized VR action inputs; physical gesture recognition, headset comfort, performance, and cadence remain separate checks. The rest of Peragus, sustained campaign memory, and release acceptance remain open. ROADMAP 1.10's full-arc completion criterion is unchanged.
