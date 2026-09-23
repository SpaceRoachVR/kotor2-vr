# Engine architecture

## The frame loop

```
GameState.Update                 (requestAnimationFrame entry, GameState.ts)
  └─ GameState.UpdateIngame
       └─ Module.tick
            └─ ModuleArea.update
                 └─ <ModuleObject>.update            per object
                      └─ updateActionQueue
                           └─ ActionQueue.process    runs only this[0]
                                └─ Action.update  →  ActionStatus
```

`ActionQueue.process` runs **only the front action** each frame. The action returns
`IN_PROGRESS` (stay) or anything else (shift off). Actions commonly push a
prerequisite to the front — `ActionSetMine` unshifts an `ActionMoveToPoint`, then an
`ActionPlayAnimation`, before doing its own work — so a single logical action can span
many frames and several queue entries.

Because only the front action runs, **anything that wedges the front of the queue
stops that object permanently**. That was the cause of the mine bug: an action threw,
`process` had no try/catch, so it was never shifted and re-threw forever. It is now
guarded, but the same pattern applies to any other per-frame queue consumer.

## GameState

`src/GameState.ts` is a static class holding effectively all global state: the THREE
scene, the current `Module`, engine mode, and references to every manager. Almost
everything reaches globals through it. Notable flags we added:

- `GameState.holdWorldFadeInForDialog`
- `GameState.disableTransit` — backs NWScript opcode 860 `SetDisableTransit`; gates
  area transitions in both `ModuleTrigger` and `ModuleDoor.transitNPC`

Both are cleared in `UnloadModule()`. Any new global flag must be cleared there too,
or it leaks across module loads and produces bugs that only appear on the second area.

## Module / area / objects

- `Module` owns the area and the script/event plumbing.
- `ModuleArea` loads rooms, placeables, creatures, triggers, doors, sounds, waypoints,
  encounters, and stores; `updateRoomVisibility()` drives `.vis`-based room culling.
- `ModuleObject` is the base for everything in the world.
  `ModuleObjectManager.ObjectList` is a `Map<id, object>`; `GetObjectById` resolves
  DWORD action parameters back to objects.

**Object id resolution is a live trap.** `Action.setParameter(i, DWORD, someObject)`
stores `object.id`, and `getParameter` resolves it via `GetObjectById`. If the id does
not map back to the object you set, you silently get a *different* object or
`undefined`. This is the open root cause of the mine bug — parameter 0 is set from a
`ModuleItem` but resolves to something without a `properties` array. When debugging an
action, print what the parameters actually resolved to.

Note `AddObjectById` skips assignment when `object.id` is already truthy, and
`setParameter` maps a falsy `id` to `OBJECT_INVALID`. Id `0` is therefore hazardous.

Player creation lives in `ModuleArea.loadPlayer()`. If `PartyManager.Player` is not a
`ModuleCreature`, it falls through to an `else` that builds a placeholder
`ModulePlayer` from `getPlayerTemplate()` — an appearance-less default human. That is
the "naked human on the hull" bug: the prologue spawns T3-M4 by script
(`DoSpecialSpawnInT3M4`) but never assigns it as the player, so a phantom human is
invented alongside it.

## NWScript

- `src/nwscript/NWScriptDefK1.ts` — 772 opcodes, all implemented.
- `src/nwscript/NWScriptDefK2.ts` — 877 definitions. **A merge loop at the bottom of
  the file copies the K1 implementation into any K2 entry whose `action === undefined`.**
- `NWScript.ts` selects the K2 table wholesale for TSL.

This merge loop is the single most misread thing in the codebase. An entry with
`action: undefined` is **not** unimplemented — it inherits K1. Overriding one without
checking K1's version is how we made the prologue crawl unskippable: K1's `PlayMovie`
hardcodes `skippable = true`, our override passed `!!args[1]`, and TSL passes `0`.

Counting real gaps requires a set-difference against the K1 table, not counting
`undefined` entries. The genuine gap is **~81 TSL-only opcodes with no K1 counterpart**.
Named ones worth having: the influence trio 795–797, `DisplayMessageBox` 864,
`DisplayDatapad` 865. Implemented this session: 805 `IsMoviePlaying`, 806 `QueueMovie`,
807 `PlayMovieQueue`, 860 `SetDisableTransit`.

## Dialogue and cutscenes

`CutsceneManager` runs conversations; `DLGObject` / `DLGNode` model the tree.

- `ActionDialogObject` picks which conversation to start. Routing to the wrong
  `OnDialog` script was the hangar-log bug: it fired the *target's* dialogue when the
  target was the player. It now skips `CreatureOnDialog` when the target is the player.
- `DLGNode.playVoiceOver` must tolerate a missing VO file. A missing resref resolves
  to `undefined` rather than throwing, and if that does not mark the checklist the
  node waits forever. There is a stall detector that warns after 10s with the full
  checklist — that warning is the fastest way to diagnose a frozen conversation.
- Reply filtering must match between `setReplies` and `selectReplyAtIndex`, or the
  player picks a different line than the one displayed.

## Rendering and resources

- THREE.js r0.149. `TextureLoader.UpdateMaterial` resolves a texture, then a fallback,
  and now warns when both fail instead of leaving a white material.
- `ResourceLoader` reads from BIF/RIM/ERF/MOD/KEY via the corresponding managers.
- Under Electron, file access goes through Node `fs` in `GameFileSystem`. The browser
  build uses the File System Access API, which was dramatically slower and threw
  `NotReadableError` on large reads — this is why we run in Electron.

## Combat

`combat/`, `talents/`, `effects/` implement the d20 layer: a 3-second round with an
attack queue. This is the hook point for the VR swing governor — see
`references/vr-design.md`.
