# VR design: locked decisions and how to build against them

`DESIGN.md` is the public spec. This file is the working summary plus the engineering
constraints that follow from it.

## Target

- **SteamVR** via WebXR on THREE.js (r0.149, WebXR support is built in).
- Primary rig: **Quest 3 over Virtual Desktop, wireless, SteamVR runtime, RTX 3060.**
  That is the perf floor, not an aspiration.
- Open source so low-spec players can run it. GPL-3.0, inherited from upstream.
- Quest 3 native port is a possible future, not a current constraint.

## Locked decisions

**Combat.** Gestures gate the roll; stats decide hit and damage. The d20 layer stays
authoritative — a swing never bypasses the dice. Swing governor is **option (c)**:
every swing animates and connects visually, but only on-tempo swings roll. Off-tempo
swings look real and do nothing mechanically, which reads better than a dead weapon.
Blaster deflection is automatic and stat-rolled. Blasters use a laser pointer and are
stat-rolled, not aim-simulated.

**The round timer is diegetic** — surfaced in the lightsaber hilt, not as a HUD
element. This is the main hook into `combat/`: the 3-second round and attack queue
need to drive a hilt visual, and the swing governor needs to read round phase.

**Locomotion.** Smooth locomotion and smooth turn by default; teleport, snap turn and
vignette as options. **Roomscale default**, seated supported. Movement stays coupled
to the walkmesh — the rig cannot leave walkable space. Physical wall intrusion is
**soft-blocked**: push the rig back rather than fading out or hard-stopping.

**Party.** Keep both order-issuing and full character swapping, anywhere. The cost of
swapping was considered and accepted.

**UI.** Wrist-mounted holo device plus physical inventory. Character sheet, galaxy map
and dialogue skill checks are summonable floating panels. Every on-screen button in the
flat game needs a VR route — the existing `gui/` widget layer is the thing being
replaced or reprojected, and `game/tsl/` menus are frequently stubs, so check against
`game/kotor/` before assuming a menu is missing.

**Radial menu pauses outright.** Revisit only if multiplayer ever happens.

**Cutscenes.** Reproject onto a theater screen. Dialogue keeps the engine's camera
cuts, with **fade-to-black between them** — the cuts themselves are nauseating in VR,
the fade makes them tolerable.

**Geometry.** Hand-fix per area. Fixed canonical eye height.

## Scope

Full campaign start to finish for v1. **Peragus is the first shippable slice.** Vanilla
for Peragus; TSLRCM required for full-campaign v1; M4-78 out of scope.

## Engineering constraints that follow

**Keep the VR layer separable from upstream engine code.** We may eventually want to
take upstream fixes, and a public fork that is a tangle of VR edits is hard to
maintain. Prefer new files and narrow hook points over edits scattered through
`module/` and `gui/`.

**The perf risk is JS single-thread draw-call overhead, not GPU fill.** Stereo doubles
draw calls, and the renderer is already single-threaded JavaScript. A 3060 has ample
raw power; the question is whether the main thread can submit two eyes at rate. This is
why the perf spike gates the rest of the plan.

**`.vis` room culling must be honoured in stereo.** If room visibility is not applied
per-frame, stereo will submit the whole level twice. Verify this before optimising
anything else.

**Memory is an unresolved threat.** The renderer has been seen at ~8.9 GB with load
times climbing across successive loads, and the Bink decoder has already failed with
`Array buffer allocation failed` during the intro movie. A headset drops frames long
before a monitor does; this needs to be understood before VR is called stable.

## Team and process

Just the user and Claude. The user is comfortable with TypeScript. Public repo from day
one. Commit locally on a topic branch; no upstream PR without being asked.
