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

There is also a published acceptance artifact, **"Peragus Headset Acceptance"**,
which is the checklist Allen actually fills in after a headset session. It
mirrors `HEADSET-TEST-PLAN.md` in a checkable form. Update both together, and
republish the artifact by URL rather than creating a second one.

## Branches

`master` tracks `origin`; `upstream` is `KobaltBlu/KotOR.js`. **Nothing has been
pushed and no PR has been opened.**

Current branch: `spike/stereo-perf`.

Work has been done in git worktrees under `.worktrees/`, one per `codex/*`
branch — `git worktree list` is the authoritative view. Branches seen so far:
`codex/studio-remediation`, `codex/level-up`, `codex/material-routing`,
`codex/qa-scenarios`, `codex/theater-recovery`, `codex/keyboard-held`,
`codex/legacy-panel`, `codex/material-restoration`, `codex/xr-runtime`,
`codex/gameplay-activation`, `codex/test-control`, `codex/radial-action-wheel`,
plus the older `tsl-prologue-fixes`.

Before starting anything, check whether a worktree already holds it — several
have been integrated already and re-doing that work is the expensive mistake.

## npm scripts worth knowing

```bash
npm run webpack:dev-watch   # leave running
npm run start               # tsc the electron main, then launch
npm run vr:check            # 22 emulated-headset checks (the gate)
npm run vr:play             # hands-on emulated session with DevTools
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
