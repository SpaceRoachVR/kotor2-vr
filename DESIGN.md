# KOTOR II VR — Design Document

A first-person, room-scale VR conversion of *Star Wars: Knights of the Old Republic II — The Sith Lords*, built on a fork of [KotOR.js](https://github.com/KobaltBlu/KotOR.js).

**Status: pre-alpha. Nothing is playable yet.** This document is the design spec, written before the code. It exists so that anyone who finds this repo knows exactly what is being attempted and can tell us early if we're wrong about something.

---

## What this is

KOTOR II is a turn-based d20 RPG with a floating third-person camera. This project turns it into a first-person VR game where you move freely, swing a lightsaber with your hand, and stand inside the Ebon Hawk — without throwing away the character system that makes it an RPG.

The core bet: **the d20 ruleset and VR embodiment are not in conflict.** The 2004 engine already runs a three-second combat round with an attack queue. In VR that round timer stops being an invisible accounting detail and becomes a *rhythm you can feel*. Your character sheet becomes something you hold in your hand.

**Target platform:** SteamVR. A Meta Quest 3 standalone port is a possible future, not a current goal.

**Performance floor:** RTX 3060, Quest 3 over Virtual Desktop (wireless). This is deliberately a mid-range target — the mod should run on the hardware most people actually own, and wireless streaming is the honest test because the GPU pays for both the game and the video encode.

---

## Why KotOR.js

Three open-source Odyssey engine reimplementations exist. None is playable start to finish, so any of them means finishing an engine *and* adding VR. We picked on the basis of momentum and architecture:

| | Language | Last commit | Verdict |
|---|---|---|---|
| [reone](https://github.com/seedhartha/reone) | C++ / OpenGL 3.3 | April 2025 | Dormant. Roadmap hasn't reached "Endar Spire completable." Force powers unimplemented. |
| **[KotOR.js](https://github.com/KobaltBlu/KotOR.js)** | **TypeScript / THREE.js** | **July 2026** | **Chosen.** Actively developed, supports both K1 and TSL, and THREE.js gives us WebXR essentially for free. |
| [NorthernLights](https://github.com/lachjames/NorthernLights) | Unity / C# | — | Best VR tooling and ships a level editor, but save/load and the effect system don't work and combat is minimal. |

KotOR.js also has the renderer quarantined in `src/three/`, which is exactly where WebXR has to go in, and its in-game GUI is drawn from Odyssey's own `.gui` resources rather than React DOM — so the HUD can be re-hosted into world space instead of rewritten.

**We intend to upstream engine-level fixes.** Anything that isn't VR-specific — culling, performance, bug fixes — belongs to KotOR.js, not to us.

---

## Design decisions

### Combat

Free movement. No round pauses outside cutscenes.

**Gestures gate the roll; stats decide the outcome.** Swinging your controller doesn't deal damage directly — it *authorizes* an attack that the engine resolves with the normal d20 math. Strength, Dexterity, feats, and attacks-per-round all still matter. A player with a bad build swings just as fast and lands far less.

**The swing governor.** A human can swing three times a second; a mid-level character gets one or two attacks per round. Rather than locking you out between attacks, **every swing animates and connects visually, but only swings on the round tempo roll an attack.** You never lose control of your own arm — off-tempo swings just don't do anything.

**The tempo is diegetic.** A slow pulse in the lightsaber crystal tells you when your next attack is live, and it pulses faster as your attacks-per-round increases. The round timer has been running invisibly since 2004; we're just showing it to you.

**Blaster bolt deflection is automatic** — stat-rolled against Jedi Defense feats as in the original, with bolts visibly pinging off the blade. Manual blocking would be a better VR moment but would make the defense feats meaningless and would punish players with limited mobility.

### Weapons

- **Lightsaber:** one-handed by default; grab the hilt with your off hand for a two-handed grip.
- **Blasters:** stat-rolled, aimed with a laser pointer. No manual ballistics.
- **Gesture set stays deliberately small** — saber swings, Force push/pull flicks. Everything else lives on a radial menu. A gesture per Force power would be a memorization burden, not immersion.

### Radial menu

Opening the radial **pauses outright.** This is a single-player game and pausing is the most comfortable, most readable option. If multiplayer ever happens, this becomes time dilation instead.

### Locomotion

Smooth locomotion and smooth turn are the defaults. Teleport, snap turn, and vignette are all available as options. Room-scale is the default play mode; seated is fully supported.

**Movement goes through the walkmesh, not around it.** Thumbstick input drives the *existing creature's* move intent, the engine resolves it against the walkmesh and trigger volumes, and the XR rig follows the creature's position plus your head offset. Moving a free-floating camera rig instead would let you walk through geometry and silently skip the trigger volumes that fire half the game's scripts.

**Physical room-scale movement soft-blocks.** You cannot push your body through world geometry — the rig resists rather than fading you out.

### The player and the party

Fixed canonical eye height, so hand-fixed level geometry has one target to be correct against.

**Full party swap, anywhere**, as in the original. This is expensive — every companion needs a VR rig, hand meshes, and an eye-height offset — and it's accepted as a cost. T3-M4 is genuinely bespoke: no arms, waist-height eyeline, radial-only input. Swapping is fade-to-black plus reorient.

Order-issuing stays, via the radial.

### Interface

**Diegetic where it can be, panels where it can't.**

- **Wrist-mounted holo device** for at-a-glance state.
- **Physical inventory** — reach for it.
- **Floating panels** for the character sheet, galaxy map, and dialogue skill checks, summoned and dismissed at will. These screens are too dense to make diegetic without losing information.

### Dialogue and cutscenes

**Dialogue keeps the engine's camera cuts, with a fade to black between each one.** KOTOR II is roughly 60% conversation by playtime — routing all of it through a theater screen would turn the game into a visual novel with walking segments, and cutting the camera without a fade is nauseating. Fades preserve the original framing and direction while making the cuts survivable.

**Pre-rendered movies reproject onto a curved theater screen.**

### Level geometry

KOTOR II's interiors were built for a camera looking down from above: low ceilings, undersized doorways, props at the wrong scale, collision only up to waist height, skybox seams you'd never notice from a bird's eye.

**Every area gets a hand-authored VR fix pass**, and those fixes live as **data — module and override files — never as engine code.** This is the single largest work item in the project, larger than all the VR code combined. Keeping it as data means it survives an engine change, and it means the level-editing tools built by the wider KOTOR community remain usable.

The game reuses layouts far more than the module count suggests. The Peragus slice, for example, is 18 module files but only about 12 distinct geometry passes.

### Mod compatibility

**The Peragus slice targets unmodded Steam TSL.** When combat breaks, we need to know it's our engine and not a mod interaction.

**TSLRCM is a hard requirement for the full-campaign v1.** Nobody finishes KOTOR II without it, and the restored content is exactly the material that benefits most from being stood inside. TSLRCM is overwhelmingly dialogue, scripts, and spawn logic, so the geometry work transfers almost entirely. M4-78 is out of scope.

---

## Milestone 1 — Peragus

Peragus is the first shippable thing. It's self-contained, geometry-light, and teaches every mechanic.

**Modules:** `101PER`–`107PER` (7), `151HAR`–`154HAR` (4), `001EBO`–`007EBO` (7 files, one shared interior layout).

**What Peragus proves:** locomotion and walkmesh coupling, the GUI re-host, dialogue with fades, geometry fixing at scale, party basics, and whether the engine can hold 90Hz in stereo on a 3060.

**What Peragus cannot prove:** the lightsaber. The Exile spends the entire prologue with a vibroblade and a blaster — you don't get a saber until after Telos. Saber combat, the swing tempo, and deflection get developed in a throwaway "dojo" test module that never ships, and won't be validated in a public build until the slice after this one.

Going in with clear eyes: **the first public release demonstrates presence in KOTOR II, not lightsaber combat in VR.**

### Work order

1. **Stereo perf spike on `101PER`** — this can invalidate the engine choice, so it goes first
2. Walkmesh-coupled locomotion
3. GUI re-host from orthographic overlay to world space
4. Dojo combat prototype — saber, tempo, deflection
5. Dialogue camera cuts with fades
6. Geometry pass over the ~12 distinct Peragus layouts
7. Theater screen for the intro movie

---

## Building

Standard KotOR.js setup — see [README.md](README.md). You need your own legally-owned copy of KOTOR II; no game assets are distributed here.

```bash
npm install
npm run dev
```

Then open `http://localhost:8080/game/?key=tsl`.

---

## License

GPL-3.0, inherited from KotOR.js. All source is public.

This project distributes **no** original game content. It reads assets from your own installation.

Not affiliated with, endorsed by, or associated with Lucasfilm, BioWare, Obsidian Entertainment, Aspyr, or Electronic Arts. *Star Wars* and *Knights of the Old Republic* are trademarks of their respective owners.
