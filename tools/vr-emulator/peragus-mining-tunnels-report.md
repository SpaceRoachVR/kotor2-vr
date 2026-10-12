# Peragus acceptance: T3 ambush to the mining tunnels

## Accepted result

One uninterrupted fresh-game emulated Quest 3 run passed **98/98 steps** in
45 minutes 58 seconds (2026-10-09 02:54:31–03:40:28 UTC), with process exit 0
and `verdict.passed=true`. It completed T3's ambush, restored the solo Exile,
opened the emergency hatch, and reached ready gameplay in `102PER` at 24/24 HP.
Both new progression snapshots show `103PER_T3_Ambush=2`,
`101PER_Open_Hatch=1`, and exactly one party member: the original protagonist.

The run used one browser pass, no save resume, death reload, or injected health
recovery. Ten advancing XR frames were verified at arrival. It recorded zero
page exceptions, zero VR-loop failures, and four existing console errors
(missing INI, reputation data, and two character-template messages).

## Changes

The campaign driver extends the fresh-game target from T3's first `103PER`
arrival to the Exile's first authored `102PER` arrival. It checks the T3 ambush,
Atton's hatch-opening conversation, the restored protagonist identity, and a
solo party at both the administration level and mining-tunnel milestones.

The Fuel Control approach follows connected `103pera` upper-deck floor at
z 22.4. The generic planner selected overlapping lower-deck anchors at z 11.9
and sent T3 into walls. Sampling 736 points along the corrected approach found
none outside the live upper-deck walkmesh. Its combat sweep is limited to eight
metres to avoid chasing droids roughly ten metres below the corridor.

## Engine defect found by uninterrupted play

The first uninterrupted run reached the target in 98 steps, but detailed
review found T3 following the Exile after the ambush. That run is **not accepted**,
even though the earlier, weaker automated verdict reported a pass.

`PartyManager.Save()` copied every live NPC into `CurrentMembers`, including a
temporarily possessed solo character. Saving during T3's errand therefore
recruited him into the persistent roster. When control returned to the Exile,
`SwitchPlayerCharacter` restored T3 as a follower from that accidental roster
entry, before his later authored rescue.

A saved-prefix replay hid the defect: the party-table export excludes the
controlled player from its companion list, so reloading the checkpoint removed
the accidental in-memory membership. This explains why the diagnostic passed
with a solo Exile while uninterrupted play produced two party members.

Saving now preserves the roster maintained by explicit recruitment/removal
operations, updates its leader flags from the actual leader, and continues to
save live NPC templates. Four regression tests exercise the real save method:
temporary possession cannot recruit, recruited companions remain registered,
the Exile does not make the first follower leader, and an empty live party
cannot leave stale leadership. All four failed before the correction.

## Authored progression contract

- `a_sett3ambush` arms the ambush at `103PER_T3_Ambush=1`.
- `a_creforhk50amb` advances it to 2 and starts `hk50ambpc`.
- `a_delhk50ambush` switches back to the original PC, makes T3 unselectable,
  and starts `101PER` at `WP_ADMCON`.
- Atton's `a_sethatch` sets `101PER_Open_Hatch=1`.
- Acceptance requires these completed flags, ready presenting gameplay, and
  the solo Exile (`isPlayer=true`, `npcId=-1`) in `101PER` then `102PER`.
  The generated protagonist's empty Tag is valid.

Retail scripts were read/decompiled into ignored evidence; retail assets were
not changed. Existing working-tree changes were preserved.

## Verification status

The corrected build passed 267 Jest suites / 2,531 tests, 147 emulator-tool
tests, the configured TypeScript check, a fresh webpack build, and 28/28
`vr:check` checks with `Saves/000708 - Game707`. Webpack retained existing
warning groups. VR checks recorded zero page exceptions and four known console
errors within the existing baseline.

An earlier corrected uninterrupted attempt did not reach the target: it timed
out at the open `106PER` fuel-depot lift. A live read-only probe located door
`Door_to_103PER` (ID 309), linked to `103per`, and T3 at approximately
(-61.41, 9.00). The door's transition line runs north/south at x=-61.9156.
The driver's position-based extrapolation sent T3 along that line instead of
across it after combat displaced the approach. Its retry now aligns to the
line's centre on the player's side and crosses perpendicular to it using
ordinary locomotion. Three geometry regressions bring the harness total to
147 passing tests. A `t3-spikes` checkpoint diagnostic then passed 34/34 steps
through `102PER`, with the solo Exile at 24/24 HP. That replay entered the lift
without needing the new perpendicular retry, so its coverage of the retry is
limited to the geometry regressions. The accepted fresh run likewise did not
need that retry. Its perpendicular fallback therefore has unit coverage but
has not been exercised by a completed live run.

An earlier attempt on the corrected bundle ended during the prologue
transition without a completed report and is retained as interrupted evidence.

Serving bundle SHA-256:
`31212a39607520f9886240d54f4bc4b5e7d324fb947249b522bfae6ddbf4e21a`.

## Reproduce

```powershell
npm run webpack:dev
node tools/vr-emulator/playthrough.js --acceptance --until mining-tunnels
```

Run sequentially with other default-storage emulator tools. Require process
exit 0, `verdict.passed=true`, the solo-party progression snapshots, and
advancing XR frames. Checkpoints support diagnosis but do not replace fresh
acceptance.

## Evidence and remaining gates

Local ignored evidence is under `tools/vr-emulator/evidence/`:

- `mining-tunnels-fresh-completed.json`: first run, rejected for premature T3
  recruitment; retained with its original weaker verdict.
- `mining-tunnels-diagnostic-passed.json`: saved-prefix diagnostic, not fresh
  acceptance.
- `mining-tunnels-party-fixed-interrupted.log`: interrupted corrected attempt.
- `mining-tunnels-party-fixed-acceptance-retry.log` and
  `mining-tunnels-party-fixed-lift-failed.json`: corrected engine run blocked
  by the lift approach; not accepted.
- `mining-tunnels-crossing-diagnostic.log` and
  `mining-tunnels-crossing-diagnostic-passed.json`: 34/34 checkpoint diagnostic;
  not fresh acceptance.
- `mining-tunnels-crossing-fresh-acceptance.log` and
  `mining-tunnels-acceptance-passed.json`: accepted 98/98 fresh run.
- `mining-tunnels-crossing-tools.log`: 147 passing harness tests.
- `mining-tunnels-party-fixed-{jest,tools,tsc,build,vr-check}.log` and
  `mining-tunnels-party-fixed-vr-metrics.json`: corrected-build checks.

Long navigation still needs bounded retries around doors and corridor corners.
Full Peragus completion, physical gesture recognition, headset comfort and
performance, and campaign-wide memory/release acceptance remain open.
