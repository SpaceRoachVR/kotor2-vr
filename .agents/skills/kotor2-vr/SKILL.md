---
name: kotor2-vr
description: Working knowledge of the kotor2-vr fork of KotOR.js — the TypeScript reimplementation of the Odyssey engine we are turning into a VR mod for Star Wars KOTOR II. Use this skill whenever the task touches this repo: tracing or fixing an engine bug, reading a runtime console log, implementing an NWScript opcode, working with Odyssey game data (GFF, 2DA, TLK, RIM/ERF/MOD, TPC, MDL, DLG), building or launching the Electron app, or writing any of the VR layer (camera rig, WebXR, locomotion, gesture combat, diegetic UI). Also use when testing VR behaviour under the emulated headset (npm run vr:check, npm run vr:play), triaging a headset-session bug report, or verifying module sweep and combat systems.
---

# kotor2-vr

A fork of [KobaltBlu/KotOR.js](https://github.com/KobaltBlu/KotOR.js) being turned into a
room-scale VR mod for **KOTOR II: The Sith Lords** (Steam Legacy PC build).

- Repo: `C:\Users\allen\source\repos\kotor2-vr`
- Game assets: `D:\SteamLibrary\steamapps\common\Knights of the Old Republic II`
- User data / saves: `%LOCALAPPDATA%\Kotor2VR`
- `origin` is `SpaceRoachVR/kotor2-vr` (working branch: `spike/stereo-perf`).
  `upstream` is `KobaltBlu/KotOR.js` — nothing sent there; upstreaming waits until
  the full VR project is done.
- Design decisions: [DESIGN.md](../../../DESIGN.md). Phase plan: [ROADMAP.md](../../../ROADMAP.md).

## Orient yourself first

Read `ROADMAP.md` before starting work. It says which phase we are in and which
tasks are session-sized. Do not start VR work while the current phase is engine
hardening — VR bugs and engine bugs are indistinguishable on an unstable base.

## The reference files

Load the one that matches the task. Do not load all of them.

| File | Read it when |
|---|---|
| [workflow.md](./references/workflow.md) | Building, launching, type-checking, committing, or reading a console log |
| [engine-architecture.md](./references/engine-architecture.md) | Tracing a bug, adding engine behavior, implementing an opcode |
| [data-formats.md](./references/data-formats.md) | Inspecting game files, checking what vanilla should do, resource loading |
| [vr-design.md](./references/vr-design.md) | Writing any part of the VR layer |
| [vr-testing.md](./references/vr-testing.md) | Verifying VR behaviour, writing a probe, triaging a headset report, running the module sweep |
| [project-map.md](./references/project-map.md) | Finding a doc, a branch, a worktree, or a VR runtime file |
| [game-knowledge.md](./references/game-knowledge.md) | Deciding whether a report is our bug or vanilla KOTOR II behaviour |

## Non-Negotiable Invariants

1. **Never run `npm run dev`.** It starts webpack-dev-server, which emits an absolute
`publicPath`. Under Electron's `file://` that resolves to the drive root and the
window is black with no error. Use `npm run webpack:dev-watch` plus `npm run start`.
Full detail in `references/workflow.md`.

2. **Confirm through emulation before asking for a headset pass.** Allen's standing
instruction: anything testable under `npm run vr:check` must be shown working
there first. A headset session is expensive and he runs it. See
`references/vr-testing.md`.

3. **Do not theorize from a log. Add logging that names the object, then look.**
When a symptom is ambiguous, the cheapest move is almost always a diagnostic that
prints the resref, tag, id, or object type, then one more test run.

4. **Check what vanilla does before fixing it.** Reports are routinely ambiguous
between our bug, retail behaviour, and a known TSL quirk. See `references/game-knowledge.md`.

5. **A probe that cannot find its subject must say so.** Always emit whether the subject
was located (`playerPresent`, `managerFound`), not only what was counted.

6. **Preserve uncommitted changes.** The main checkout routinely holds a large uncommitted
working set between headset rounds. Never reset or discard without explicit instruction.

## Where things are

`src/` top level, roughly in dependency order:

```
GameState.ts     static god object: engine mode, current module, scene, managers
managers/        ~35 singletons (PartyManager, ModuleObjectManager, TextureLoader users,
                 CutsceneManager, TwoDAManager, TLKManager, VideoManager, ...)
module/          runtime world objects: ModuleArea, ModuleCreature, ModulePlaceable,
                 ModuleDoor, ModuleTrigger, ModuleItem, ModulePlayer
actions/         the action queue and every Action subclass
nwscript/        NWScript VM plus the K1/K2 opcode tables
resource/        GFF, DLG, 2DA, TLK and friends
loaders/         TextureLoader, MDLLoader, TPCLoader, TGALoader, ResourceLoader
odyssey/         model/animation runtime
gui/             in-game GUI control widgets (not React)
game/kotor/      K1 menu implementations
game/tsl/        K2 menu implementations — often a stub where K1 is complete
apps/            Electron launcher and the Forge editor (React lives here only)
combat/ talents/ effects/   d20 rules layer
vr/              WebXR runtime (VRSpike.ts, src/vr/runtime/)
```

The K1/K2 split matters: `game/tsl/` menus frequently stub out what `game/kotor/`
implements. When a TSL feature is dead, diff it against the K1 file before assuming
the logic is missing entirely.

## Test Gates & Verification

- Unit & rules integrity: `npx jest --ci --silent` (crucial because `tsc` ignores `src/actions`).
- VR emulation harness: `npm run webpack:dev` followed by `npm run vr:check` (25 automated checks under emulated Quest 3).
- Real headset launcher: `npm run vr:play` (launches Chrome with CDP on port 9422).
- Module sweep: `npm run vr:sweep` (sweeps all 82 campaign modules to rank root causes).
