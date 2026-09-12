# Embodied VR Combat Design

## Goal

Replace point-and-click combat with an embodied, weapon-specific VR control layer
that authorizes the existing KOTOR II d20 combat system. The player aims,
swings, fires, casts, and throws; the engine remains the sole source of truth
for legal actions, target validity, combat rounds, attack rolls, damage, feats,
animations, effects, inventory, and saves.

## Scope

The system applies in gameplay WebXR sessions only. It covers hostile target
acquisition, melee and blaster basic attacks, a three-entry planned special
sequence, Force powers, grenades, first-person weapon presentation, humanoid
hands and arms, and floating droid weapon presentation.

It does not change authored TSL scripts, d20 calculations, walkmesh movement,
NPC combat AI, campaign resources, the flatscreen action menu, retail assets,
or action-queue behavior outside a presenting VR session.

## Player Decisions

| Area | Accepted behavior |
|---|---|
| Overall loop | Tempo Duelist with weapon-specific physical input. |
| Targeting | Aim immediately soft-locks a hostile; trigger or swing confirms the action. |
| Target loss | Keep the lock briefly to avoid flicker during natural motion. |
| Target switching | Require a short dwell on a different hostile. |
| Humanoids | Show character-aware arms, hands, sleeves, and equipped weapons. |
| Droids | Show a stable floating weapon or ability rig near the dominant controller, with no hands. |
| Basic attacks | Continue as the fallback after specials resolve. |
| Special sequence | Queue up to three attack specials and Force powers, FIFO, as in the original queue. |
| Sequence targeting | Each planned action uses the hostile soft-locked when its eligible physical action occurs. |
| Sequence invalidation | Skip invalid entries with feedback; clear the full sequence on weapon swap. |
| Grenades | Arm separately in the off hand; aim at the soft-locked hostile and use off-hand trigger to throw. |
| Force powers | Force entries join the three-slot sequence; trigger commits all except Push and Pull, which retain their existing directional gesture. |
| Blasters | Each trigger press is deliberate; only a tempo-eligible press creates an engine attack. |

## Design Principles

1. **VR authorizes; the engine resolves.** VR code never rolls damage, decrements
   inventory, calculates range, applies a feat, or writes combat results.
2. **No speculative engine actions.** Selecting a planned action changes only
   VR intent state. Its engine action is re-resolved and dispatched only after
   matching physical input is eligible.
3. **Fail closed.** A stale target, invalid action, missing tracked pose, full
   sequence, menu ownership, weapon swap, party change, load, transition, or
   exception cannot issue an engine action.
4. **Existing semantic routes win.** Actions flow through ModuleCreature
   attackCreature, TalentFeat useTalentOnObject, TalentSpell useTalentOnObject,
   and ActionMenu routes. The design does not manufacture an Action, edit a
   CombatRoundAction, or directly consume an item.
5. **Presentation is non-mutating.** Controller-anchored models are clones.
   The original actor body and equipment remain under engine ownership and are
   restored after each first-person world render.

## Target Lock Contract

VRCombatAimResolver remains separate from interaction aiming, retaining its
combat-specific reach and aim assist. A new VRCombatTargetLock owns state on top
of its raw aimed id.

| Situation | Result |
|---|---|
| Raw aim enters a live hostile | Acquire it immediately and emit one acquisition feedback event. |
| Raw aim leaves the locked hostile | Retain the existing lock for 500 ms. |
| Raw aim returns during the grace interval | Retain the lock without a feedback restart. |
| Raw aim rests on a different live hostile | Transfer after a continuous 180 ms dwell. |
| Old or candidate target dies, unloads, is not selectable, or leaves combat range | Clear immediately; no grace applies. |
| No target is locked | Physical combat input may animate locally but cannot dispatch an engine action. |

The values are constructor defaults, configurable only through an injected
configuration so tests can exercise boundaries. They are not exposed as a
comfort setting in this milestone.

The existing world target label and combat highlight become lock feedback:
the locked target shows a durable floor ring and name or health label for the
grace interval, while a pending transfer is visually distinct. Haptic feedback
occurs only on acquire, successful transfer, invalid plan skip, full queue, and
grenade cancellation; it never runs every frame.

## Basic Combat and Tempo

The dominant hand drives the active weapon. The dominant-hand setting already
owned by VRSpike must be honored by all combat input and presentation; no combat
path may assume the right hand.

- **Melee:** a tracked swing above the configured speed threshold is visually
  expressed. A tempo-eligible swing with a live lock dispatches one normal
  attack or the first eligible planned action.
- **Blaster:** a rising dominant-hand WeaponAction edge is a deliberate visual
  shot. It dispatches only while tempo eligible and locked.
- **Two-handed one-handed weapons:** the existing close-hand off-hand grip
  sampling remains the physical two-hand condition. It does not change engine
  equipped-weapon or feat rules.
- **Droids:** use the same logical melee and blaster inputs and target behavior
  as humanoids. Their visible equipment is floating rather than held by hands.

CombatRound, rather than VRCombatInputController's local 3,000 ms cooldown, is
the authority for the next legal tempo window. The VR controller may detect
physical events and render readiness, but the bridge derives eligibility from a
read-only snapshot of the actor's current engine combat state. A new engine
action is requested only when the current round can legally accept it. Existing
per-round extra attacks, feat penalties, animation delay, attack rolls, and
damage application remain untouched in CombatRound.

The weapon-mounted readiness ring remains the diegetic timing cue. It reports
the next engine-authorized window and never promises that an action will
succeed. The stance plaque is replaced by an upcoming-action readout.

## Upcoming Action Sequence

VRCombatIntentQueue is a bounded, FIFO, engine-independent state machine. It
stores at most three immutable intent descriptors:

    type VRCombatIntentKind = 'attack-feat' | 'force-power';

    interface VRCombatIntent {
      readonly sourceKey: string;
      readonly label: string;
      readonly icon?: string;
      readonly kind: VRCombatIntentKind;
      readonly requiredInput:
        'melee-swing' | 'blaster-trigger' | 'force-trigger' |
        'force-push' | 'force-pull';
      readonly weaponSignature: string | null;
    }

sourceKey identifies an action-menu snapshot entry. weaponSignature records the
equipped attack class at enqueue time for attack feats; it is null for a Force
power. No target id is retained because the current soft lock is the target
when the player performs the action.

Selecting a combat feat or Force power on the wheel appends its descriptor. The
wheel shows the three ordered slots, their required physical input, and a
dedicated Clear Upcoming Actions control. It permits repeated descriptors just
as the original queue permits repeated selections. A fourth selection leaves
the sequence intact and gives one full-queue feedback event.

At an engine-eligible physical action:

1. The bridge reads only the FIFO head. A physical input that does not match the
   head leaves the sequence unchanged and may request the ordinary basic attack;
   it never consumes a later entry ahead of the head.
2. A matching head is checked against the actor, weapon signature, selected
   target, source snapshot, cost and cooldown availability, and action-menu
   revalidation route.
3. A valid matching head is removed and dispatched through its original
   authored route against the current locked target.
4. An invalid head is removed, reports its concrete invalidation reason, and
   does not dispatch.
5. With an empty sequence, the bridge requests the ordinary basic attackCreature
   action.

Weapon change, leader change, game load, module transition, combat cancellation,
and leaving an immersive session clear the sequence. This replaces the current
VRAttackStanceController behavior. A special is no longer a persistent stance:
it is consumed once and basic tempo combat resumes.

## Force Powers

Force power entries use the same upcoming-action sequence. The wheel never
assumes every target-panel spell is a Force power; it retains the existing
classifyVRForcePower classification so droid and item abilities remain attacks.

Most Force entries require an aimed dominant-hand trigger. Push and Pull retain
the existing directional gesture recognizer and consume their matching queued
entry only when its gesture occurs while the target is locked and the engine
tempo accepts it. The bridge re-resolves the selected action immediately before
calling the existing talent route. It does not call useTalentOnObject when the
power is queued.

## Grenade Contract

Grenades are intentionally separate from the upcoming-action sequence.

1. Selecting an engine-provided grenade action on the wheel creates
   VRArmedGrenadeState containing a presentation descriptor and revalidation
   closure. It does not dispatch or consume the item.
2. A presentation-only clone appears at the off-hand anchor. It points toward
   the current soft-locked hostile and gives a target or invalid indicator.
3. The off-hand trigger rising edge revalidates the original action against the
   actor and current soft lock.
4. Only a passing revalidation dispatches the original engine grenade route.
   The visual clone then leaves the anchor on a local throw animation while the
   engine owns the real grenade result and inventory mutation.
5. Target loss, target death, selection expiry, UI ownership, weapon or party
   changes, cancel, or revalidation failure removes the presentation clone
   without dispatching.

No arbitrary world-point throw is introduced in this milestone; a live hostile
soft lock is required, as selected by the player.

## First-Person Presentation

XRControllerAnchorHost already attaches presentation-only clones of engine
weapon models. The new VRFirstPersonCombatRig owns the complete local combat
presentation and is the only component allowed to add cloned body or hand
visuals to controller anchors.

For a humanoid, it builds two appearance-aware arm assemblies from the selected
actor's loaded Odyssey model and equipment state. Each assembly includes visible
hand geometry, current sleeve or armor material, and the held-item clone. It is
driven by the corresponding tracked controller pose and keeps a stable local
elbow and forearm offset so hands do not enter the camera. A two-handed grab
uses the second controller as the weapon's secondary grip while preserving the
dominant hand as the engine action hand. The source actor model is never
reparented, hidden outside the single first-person render, or modified.

For a droid, the same class-specific equipment clone is mounted to a stabilized
dominant-hand frame with no skin, hand, sleeve, or humanoid attachment-node
assumption. This explicitly accommodates the existing engine fact that droid
models need not have rhand or lhand attachment nodes.

The rig rebuilds only when selected actor identity, humanoid or droid
classification, appearance revision, or equipped-item identity changes. It
disposes geometry and material ownership that it creates and removes clones
during leader change, actor destruction, module transition, XR session end, and
VRSpike dispose. It never disposes engine-owned source geometry, textures, or
materials.

## Ownership and Failure Behavior

Combat input runs only after foreground UI, radial menu, keyboard, theater, and
world interaction routing have yielded ownership. Input latched while another
surface owns it is synchronized so it cannot become a fresh combat press on
return. Existing combat cancel remains globally reachable; it additionally
clears target lock, upcoming actions, and armed grenade state.

Every engine boundary is wrapped in narrow error handling with one focused,
non-spamming diagnostic per failure class. Public state-mutating methods reject
invalid configuration and impossible inputs with typed errors. A presentation
failure clears only its local clone or readout; it cannot clear an engine action
queue or alter actor equipment.

## Automated Verification

Unit coverage is required before each production implementation step:

| Unit | Required cases |
|---|---|
| VRCombatTargetLock | immediate acquire, grace retention, reacquire during grace, dwell transfer, death or unload immediate clear, invalid timestamps and configuration. |
| VRCombatIntentQueue | FIFO head-only order, duplicate intents, three-entry cap, input mismatch retention, invalid skip, clear-on-weapon-change, clear-on-life-cycle reset, immutable snapshot output. |
| Tempo adapter | physical input alone cannot authorize an action before engine window; an engine window permits one request; extra input does not produce duplicate engine requests. |
| Action bridge | live target is resolved at dispatch, stale source is rejected, no target is rejected, correct existing feat or spell route is called exactly once, and queued selection itself has no engine side effect. |
| Armed grenade state | selection does not dispatch, only an off-hand trigger edge with a live revalidated target dispatches, all cancel paths leave inventory and engine queue untouched. |
| Combat rig | humanoid assembly uses clones and original actor hierarchy remains unchanged; droid path never dereferences hand nodes; rebuild and dispose release only rig-owned objects. |
| VRSpike integration | dominant-hand input, UI ownership and latch behavior, target feedback, cancel cleanup, presentation reset, and long-range combat aim regression. |

Run focused tests first, then npm test with runInBand, configured TypeScript,
webpack development build, and the applicable VR emulator check. Report
pre-existing failures separately.

## Physical Acceptance Gates

Automated, browser, and emulator checks do not establish headset acceptance.
In a Quest 3 plus VDXR Chrome session, verify in the Peragus slice:

1. Immediate soft lock, 500 ms grace, and dwell transfer with multiple hostile
   droids; no accidental target transfer while swinging.
2. Humanoid hands, sleeves, weapon grip, and two-handed pose remain aligned and
   outside the camera across movement and recentering.
3. Droid floating weapon presentation remains stable without hand-node errors.
4. Melee and blaster physical input feel responsive but generate no extra
   engine attacks; d20 results, feat effects, and combat animations match the
   flatscreen rule path.
5. Three mixed attack-feat and Force entries execute in FIFO order against the
   live lock, then basic attacks resume; weapon swap clears all entries.
6. An armed grenade is visible in the off hand, cannot fire accidentally,
   dispatches only on off-hand trigger, and consumes inventory only after the
   engine route succeeds.
7. Push and Pull gestures, non-Push and Pull trigger casts, cancel, save and
   load, party switch, menu interruption, and module transition leave no stale
   lock, action, hand rig, or grenade presentation.
8. Record frame cadence, controller tracking, comfort observations, visible
   clipping, and differences between browser or emulator and headset behavior.

## Files Expected to Change

- src/vr/runtime/VRCombatTargetLock.ts and focused tests.
- src/vr/runtime/VRCombatIntentQueue.ts and focused tests.
- src/vr/runtime/VRArmedGrenadeState.ts and focused tests.
- src/vr/runtime/VRFirstPersonCombatRig.ts and focused tests.
- src/vr/runtime/VRCombatInputController.ts and focused tests.
- src/vr/runtime/XRControllerAnchorHost.ts and focused tests.
- src/vr/VRSpike.ts, src/GameState.ts,
  src/vr/runtime/VRActionMenuEngineBridge.ts, and
  src/vr/runtime/VRActionWheelModelBuilder.ts.
- DESIGN.md, ROADMAP.md, and HEADSET-TEST-PLAN.md so the project contract and
  manual acceptance instructions remain accurate.
