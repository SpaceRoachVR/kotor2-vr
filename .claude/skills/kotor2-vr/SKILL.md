---
name: kotor2-vr
description: Working knowledge of the kotor2-vr fork of KotOR.js — the TypeScript reimplementation of the Odyssey engine we are turning into a VR mod for Star Wars KOTOR II. Use this skill whenever the task touches this repo: tracing or fixing an engine bug, reading a runtime console log, implementing an NWScript opcode, working with Odyssey game data (GFF, 2DA, TLK, RIM/ERF/MOD, TPC, MDL, DLG), building or launching the Electron app, or writing any of the VR layer (camera rig, WebXR, locomotion, gesture combat, diegetic UI). Also use when the user pastes a stack trace or console dump from the game, reports a visual glitch, or asks what vanilla KOTOR II is supposed to do at some point in the game. Also use when testing VR behaviour under the emulated headset (`npm run vr:check`, `npm run vr:play`), triaging a headset-session bug report, or deciding what still needs a manual pass.
---

# kotor2-vr

A fork of [KobaltBlu/KotOR.js](https://github.com/KobaltBlu/KotOR.js) being turned into a
room-scale VR mod for **KOTOR II: The Sith Lords** (Steam Legacy PC build).

- Repo: `C:\Users\allen\source\repos\kotor2-vr`
- Game assets: `D:\SteamLibrary\steamapps\common\Knights of the Old Republic II`
- Upstream remote is wired as `upstream`. We have not pushed or opened a PR.
- Design decisions: `DESIGN.md`. Phase plan: `ROADMAP.md`.

## Orient yourself first

Read `ROADMAP.md` before starting work. It says which phase we are in and which
tasks are session-sized. Do not start VR work while the current phase is engine
hardening — VR bugs and engine bugs are indistinguishable on an unstable base.

## The reference files

Load the one that matches the task. Do not load all of them.

| File | Read it when |
|---|---|
| `references/workflow.md` | Building, launching, type-checking, committing, or reading a console log |
| `references/engine-architecture.md` | Tracing a bug, adding engine behavior, implementing an opcode |
| `references/data-formats.md` | Inspecting game files, checking what vanilla should do, resource loading |
| `references/vr-design.md` | Writing any part of the VR layer |
| `references/vr-testing.md` | Verifying VR behaviour, writing a probe, triaging a headset report |
| `references/project-map.md` | Finding a doc, a branch, a worktree, or a VR runtime file |

## Two rules that have cost us the most time

**Never run `npm run dev`.** It starts webpack-dev-server, which emits an absolute
`publicPath`. Under Electron's `file://` that resolves to the drive root and the
window is black with no error. Use `npm run webpack:dev-watch` plus `npm run start`.
Full detail in `references/workflow.md`.

**Confirm through emulation before asking for a headset pass.** Allen's standing
instruction: anything testable under `npm run vr:check` must be shown working
there first. A headset session is expensive and he runs it, not you. See
`references/vr-testing.md`.

**Do not theorize from a log. Add logging that names the object, then look.**
This is the single most reliable lesson from this project. On one bug we burned four
wrong hypotheses — a silent conversation fallback, a stalled dialogue node, a missing
opcode, and a whole theory built on a misremembered character — before adding one
`console.log` that printed the dialogue resref and solved it immediately. When a
symptom is ambiguous, the cheap move is almost always a diagnostic that prints the
resref, tag, id, or object type, then one more test run.

Corollary: when the user reports a symptom, ask what they actually saw before
proposing a cause. "Didn't display correctly" and "didn't display at all" have
different fixes.

**A probe that cannot find its subject must say so.** The most repeated mistake
in this project is a diagnostic returning an empty result that reads as a
finding — objects never sampled reported as offering nothing, `GameState.player`
read when the player is `PartyManager.party[0]`. Always emit whether the subject
was located, not only what was counted. And check that the API you are probing
is the one the product actually calls.

## Failure patterns already found in this engine

Recognising these saves a lot of tracing. All four are fixed on `tsl-prologue-fixes`,
but the *shapes* recur elsewhere in the codebase.

- **Unguarded throw in a per-frame loop.** `ActionQueue.process` called
  `action.update()` with no try/catch, so a throwing action was never shifted off the
  queue and re-threw every frame forever. Symptom: thousands of identical stack traces
  and an owner that can never act again. Any per-frame consumer of a queue deserves
  the same suspicion.
- **Silent fallback that renders as a valid-looking value.** `TextureLoader` left
  `map = null` when a texture failed, which THREE renders as solid white, and logged
  nothing. Symptom: unexplained white boxes with a clean console. Look for `else`
  branches that swallow a failure without logging.
- **Negative length reaching an allocator.** `ComputedPath.buildHelperLine` guarded
  with `if(!bufferSize)`, but an empty path made `bufferSize` negative, which is
  truthy, so it reached `new Array(-6)` and threw `RangeError`. Prefer `<= 0` over
  falsy checks on computed sizes.
- **Stale cached length across a mutating loop.** An effects loop cached
  `this.effects.length` while effects could remove themselves mid-update.

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
```

The K1/K2 split matters: `game/tsl/` menus frequently stub out what `game/kotor/`
implements. When a TSL feature is dead, diff it against the K1 file before assuming
the logic is missing entirely.

## Current state

Branch `spike/stereo-perf`. Nothing pushed, no PR. The Peragus prologue runs its
scripted beats, and the VR layer is well past a spike: locomotion, snap turn,
recenter, blink teleport, an action wheel, comfort settings, and a world-use
prompt system all exist and are covered by tests.

Two gates are green and should stay that way: **`npx jest --ci`** and
**`npm run vr:check`** (22 emulated-headset checks).

Do not trust this section for specifics — `ROADMAP.md` is the live plan and
`HEADSET-TEST-PLAN.md` is the live list of what needs a human. Check both.
`references/project-map.md` indexes every doc, branch, and worktree.
