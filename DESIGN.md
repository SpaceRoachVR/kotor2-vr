# KOTOR II VR — Design Document

A first-person, room-scale VR conversion of *Star Wars: Knights of the Old Republic II — The Sith Lords*, built on a fork of [KotOR.js](https://github.com/KobaltBlu/KotOR.js).

**Status: pre-alpha. Nothing is playable yet.** This document is the design spec, written before the code. It exists so that anyone who finds this repo knows exactly what is being attempted and can tell us early if we're wrong about something.

---

## What this is

KOTOR II is a turn-based d20 RPG with a floating third-person camera. This project turns it into a first-person VR game where you move freely, swing a lightsaber with your hand, and stand inside the Ebon Hawk — without throwing away the character system that makes it an RPG.

The core bet: **the d20 ruleset and VR embodiment are not in conflict.** The 2004 engine already runs a three-second combat round with an attack queue. In VR that round timer stops being an invisible accounting detail and becomes a *rhythm you can feel*. Your character sheet becomes something you hold in your hand.

**Target platform:** Windows desktop WebXR, primarily Quest 3 over Virtual
Desktop/VDXR, with SteamVR/OpenXR profiles also required for v1. A standalone
Quest port is not in scope.

**Performance floor:** sustained 50 FPS minimum on an RTX 3060 and Quest 3 over
Virtual Desktop/VDXR (wireless), with 72 Hz retained as the stretch target. The
continuation gate allows uneven runtime delivery up to p90 33.33 ms and p99 below
50 ms. This is a user-approved comfort tradeoff; the GPU still pays for both the
game and video encode.

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

The left-controller `X` button opens one **all-purpose action wheel**. It replaces
the separate four-way contextual and wrist radials with a dynamic snapshot of
the currently available combat, self, menu, party, and comfort actions. Missing
or malformed actions are omitted rather than padded; every action is
revalidated before dispatch and a failed action is never replaced by another.
Pages contain at most six content actions plus dedicated previous/next wedges,
and Party opens a nested wheel built from the live selectable party list.

Each opening captures the head pose and places the wheel 0.85 metres forward
and 0.25 metres below it. The wheel then stays fixed in world space. Only the
left-controller ray hovers its shared render/collision sectors, with amber
extrusion, label, pointer, and best-effort haptic feedback; a left-trigger press
confirms the hovered action. Either controller may instead activate a wedge by
direct touch. The center cancels, a trigger with no resolved target does
nothing, and releasing `X` always cancels without activating the hover.

Opening the wheel **does not pause or slow the game**: simulation, locomotion,
and turning continue. While open, the wheel owns conflicting combat, world-use,
and UI activation input. It closes and clears ownership before dispatch, so a
selected full-screen Inventory, Character, local Map, or other legacy menu can
apply that menu's existing pause behavior.

Doors, containers, mines, and ordinary consoles do not consume wheel slices.
When an eligible object is in range, visible, and in front of the player, a
compact world-anchored prompt proactively exposes only its safe direct use and
authored `ActionMenuManager` routes. Either controller ray and trigger can
activate a prompt action once; there is no prompt touch route. The prompt is
removed immediately when its object, range, line of sight, view cone,
visibility, or actions become invalid. Locked, key-required, plot, and other
story-owned objects fail closed instead of receiving a generic direct-use
fallback. The Ebon Hawk Galaxy Map console is the exact static exception: its
existing world `Use` route remains available through the prompt and may open
the context-dependent Galaxy Map UI, while the wheel's Map action opens only
the local `MenuMap`.

Tracking or XR-session loss, module transitions, dialogue/cutscene entry, and
foreground-menu takeover close the wheel and prompts and clear rays, hover,
haptics, press/touch latches, and ownership without engine activation. Session
teardown also disposes the owned meshes, materials, canvas/icon textures, and
pointer resources.

### Locomotion

Smooth locomotion and smooth turn are the defaults. Teleport, snap turn, and vignette are all available as options. Room-scale is the default play mode; seated is fully supported.

**Movement goes through the walkmesh, not around it.** Thumbstick input drives the *existing creature's* move intent, the engine resolves it against the walkmesh and trigger volumes, and the XR rig follows the creature's position plus your head offset. Moving a free-floating camera rig instead would let you walk through geometry and silently skip the trigger volumes that fire half the game's scripts.

**Physical room-scale movement soft-blocks.** You cannot push your body through world geometry — the rig resists rather than fading you out.

### The player and the party

Humanoids use calibrated, avatar-relative eye height with small clamped scale and
offset adjustments. T3-M4 uses a bespoke stabilized waist-height chassis view;
tracked space is not aggressively scaled to droid proportions.

**Full party swap, anywhere**, as in the original. This is expensive — every companion needs a VR rig, hand meshes, and an eye-height offset — and it's accepted as a cost. T3-M4 is genuinely bespoke: no arms, waist-height eyeline, radial-only input. Swapping is fade-to-black plus reorient.

Order-issuing stays, via the radial.

### Interface

**Diegetic where it can be, panels where it can't.**

- **All-purpose `X` action wheel** for combat/self actions, party selection,
  menu access, and comfort settings, with proactive object prompts for world use.
- **Physical inventory** — reach for it.
- **Floating panels** for the character sheet, local map, context-dependent
  galaxy map, and dialogue skill checks, summoned through their valid wheel or
  world routes and dismissed at will. These screens are too dense to make
  diegetic without losing information.

### Dialogue and cutscenes

**Dialogue defaults to a curved theater surface** showing the engine-authored
camera, with reply and skill-check controls below it. A stabilized in-world mode
is optional and fades between discontinuous camera cuts. The tracked head is
never directly driven by an authored camera.

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

**What Peragus proves:** locomotion and walkmesh coupling, the GUI re-host, dialogue with fades, geometry fixing at scale, party basics, and whether the complete VR stack can sustain the user-approved 50 FPS floor on a 3060. The runtime remains configured for 72 Hz as a stretch target.

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
