# Project map: docs, branches, plans

Sessions frequently open in the wrong directory. The repo is
`C:\Users\allen\source\repos\kotor2-vr`; the path under `SteamLibrary` is the
**game asset directory**, not the code.

## Planning documents

Read `ROADMAP.md` first, always. The rest are context you load on demand.

| Doc | What it is | Trust it for |
|---|---|---|
| `ROADMAP.md` | The live plan. Numbered tasks sized for one session, checked off in place | What to do next, and what is already done |
| `HEADSET-TEST-PLAN.md` | The master list of what still needs a human in a headset | What emulation cannot settle |
| `DESIGN.md` | Locked design decisions for the VR conversion | Why something is the way it is |
| `VR-AUDIT-AND-COMPLETION-PLAN.md` | Audit of VR-layer completeness | Gap analysis |
| `VR-PLAYTEST-FIX-PLAN.md` | Fixes derived from playtests | Playtest-driven work |
| `COMBAT-RADIAL-REDESIGN.md` | ROADMAP 4.8 spec — combat wheel structure, stance model, wedge-geometry limits | Touching `VRActionWheelModelBuilder` or any combat wheel route |
| `PHASE0-ENGINE-PIVOT-REPORT.md` | Why this engine was chosen over reone / NorthernLights | Engine choice rationale — settled, do not relitigate |
| `PHASE0-STEREO-SPIKE.md` | The stereo rendering spike | Stereo/perf background |
| `CONTRIBUTING.md`, `README.md` | Inherited from upstream KotOR.js | Upstream conventions only |

There is also a published checklist artifact, **"Headset Verification Run"**
(https://claude.ai/code/artifact/6897f1b9-af6a-4bea-8fd4-c693ce271af6), which is
what Allen actually fills in during a headset session. It is round-based and
pruned — see "Manual headset rounds" in `references/vr-testing.md`. Republish it
to the same URL rather than creating a second one.

## Branches

`origin` is `SpaceRoachVR/kotor2-vr`; `upstream` is `KobaltBlu/KotOR.js` (nothing
sent upstream). `spike/stereo-perf` is the working branch and is pushed; feature
branches land in it by PR (PR #2 merged `codex/embodied-vr-combat` on
2026-09-12). `master` is a merge of spike whose tree differs from it by ~15k
lines — do not target it without asking.

The main checkout routinely carries a large **uncommitted** headset-fix working
set between rounds. Before pulling or merging, save it (`git diff --binary` to a
patch, and copy the untracked files — `git status | head` truncates and hides them).

Work has been done in git worktrees under `.worktrees/`, one per `codex/*`
branch — `git worktree list` is the authoritative view. Branches seen so far:
`codex/studio-remediation`, `codex/level-up`, `codex/material-routing`,
`codex/qa-scenarios`, `codex/theater-recovery`, `codex/keyboard-held`,
`codex/legacy-panel`, `codex/material-restoration`, `codex/xr-runtime`,
`codex/gameplay-activation`, `codex/test-control`, `codex/radial-action-wheel`,
`codex/embodied-vr-combat` (merged), plus the older `tsl-prologue-fixes`.

Before starting anything, check whether a worktree already holds it — several
have been integrated already and re-doing that work is the expensive mistake.
Do it with `git branch -a | grep -i <feature>` *before* reading code: on
2026-09-12 level-up was rebuilt in the main checkout before `codex/level-up` was
noticed.

`codex/level-up` (2026-08-22, unmerged) is **superseded pending Allen's call** by
the main checkout's level-up (`LevelUpRules`, `LevelUpSession`, `MenuLevelUp`,
`MenuPowerLevelUp` under `src/game/kotor/menu/`, reusing the chargen Attributes /
Skills / Feats screens via `CharGenManager.levelUp`). The branch wires TSL's
step buttons to the wrong screens (the authored labels are Attributes, Skills,
Feats, Powers; it opens powers, feats, skills), has no Attributes step or Force
point gain, and forked before the chargen screens were fixed.

## npm scripts worth knowing

```bash
npm run webpack:dev-watch   # leave running
npm run start               # tsc the electron main, then launch
npm run vr:check            # 25 emulated-headset checks (the gate)
npm run vr:play             # real-headset launcher: fresh Chrome, CDP on :9422
npx jest --ci --silent      # unit gate
npm run xr:benchmark:check  # XR benchmark
npm run material:audit      # material/visual manifest
```

`npm test` runs jest with coverage and `--no-cache`, which is slow; prefer
`npx jest --ci --silent` while iterating.

**Never `npm run dev`** — see `references/workflow.md`.

## VR layer: where things live

```
src/vr/VRSpike.ts                    the XR loop and session lifecycle; large, central
src/vr/runtime/                      one file per surface or subsystem:
  XRInputRouter, XRGamepadReader     input routing and button mapping
  VRPointerHandResolver              which hand is pointing at a surface
  VRRadialMenu{Controller,Host,...}  the action wheel
  VRPanelPointerHost                 the shared ray + cursor visual
  VRTeleport{Controller,AimResolver,MarkerHost}   blink locomotion
  VRComfortSettingsHost              comfort panel
  VRWorldUseAdapter                  which world objects VR may act on directly
  VRCombatAimResolver                combat aim out to combat reach, not the 3 m use range
  VRCombatTargetLock, VRCombatIntentQueue, VRCombatTempoGate, VRArmedGrenadeState
                                     embodied combat
  VRBlasterBoltHost, VRDroidExplosionHost   visuals the engine never produced
  hands/                             rigged WebXR generic hands, finger curl, skeleton poser
  LocomotionController, VRSnapTurnController      movement
src/engine/interaction/ActionApproachPolicy.ts   suppresses engine approach-walk in VR
```

## Conventions that hold across this repo

- Every non-obvious guard carries a comment saying **why**, usually naming the
  bug it prevents. Match that density; it is the repo's main defence against
  a later session "simplifying" a fix back out.
- Tests are named as behaviour statements, and comments in tests explain the
  failure the test prevents.
- A defect that is understood but deliberately not fixed is recorded as a test
  asserting **current** behaviour, labelled clearly, so the gap is visible and
  flipping it is one edit.
