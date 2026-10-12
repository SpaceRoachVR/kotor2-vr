# Continuous Peragus acceptance

Build the browser bundle, then start the authored fresh-game route under the emulated Quest 3:

```powershell
npm run webpack:dev
node tools/vr-emulator/playthrough.js --acceptance --until mining-tunnels
```

The extended target is the first authored arrival in `102PER`, with control restored to the Exile. The route includes character creation, the Ebon Hawk prologue and repairs, travel to Peragus, Kreia's awakening, the administration override, Atton's code conversation, T3's hangar errand and fuel-depot ambush, and Atton opening the emergency hatch. The previously accepted `t3-fuel-depot` target remains available for the shorter segment.

Acceptance requires one browser pass from a fresh game. It rejects saved-state resumes, prologue skipping, death reloads, injected health recovery, failed steps, page exceptions, and VR-loop failures. The report records the SHA-256 digest of the bundle observed by CDP, the campaign steps, progression snapshots, and ten advancing XR frames at arrival. Check both the process exit status and `verdict.passed` in `evidence/playthrough-report.json`.

The milestone assertions verify:

- Kreia's live creature, `101PER_Kreia_Spawn=2`, `101PER_Talk_Kreia=1`, and `RecoverEbonHawk` state 10.
- Atton's live creature and `101PER_Know_Adm_Code=1`, set by the authored `a_setcode` script.
- T3-M4 as party leader with NPC slot 8 available, in ready, presenting gameplay in `106PER` and then `103PER`.
- The authored ambush reaching `103PER_T3_Ambush=2` (`a_creforhk50amb`), Atton's hatch conversation setting `101PER_Open_Hatch=1` (`a_sethatch`), and the solo Exile in ready, presenting gameplay first in `101PER`, then in `102PER`. T3 must not follow before his later authored rescue. The Exile's identity is `isPlayer=true` with NPC slot -1; an empty protagonist Tag is valid.

The T3 route walks both corners of the hangar ramp landing, equips the looted Ion Striker through the equipment menu, and commits the offered droid abilities with the required trigger input. Ranged combat engages from firing distance. Navigation interrupts travel to fight a live attacker when the player takes damage. These inputs enter the engine's existing combat queue; gesture recognition remains a separate test boundary.

The exterior lift route follows the connected west ramp. The cockpit and communications console approaches follow their connected interior floors around the wall corners. Precise approaches use short thumbstick pulses released inside the browser, avoiding full-speed overshoot and transport delays around small arrival tolerances.

T3's approach to Fuel Control follows the connected upper-deck `103pera` floor at z 22.4. The generic planner can select lower-deck anchors beneath this corridor. The route keeps the combat sweep within eight metres so it does not divert toward droids on the lower floor roughly ten metres below.

Run the CLI sequentially against its default writable storage. Concurrent harness sessions require both separate ports and separate `userRoot` directories in `startAssetService`; New Game clears temporary game data and can corrupt another browser's in-progress load if their storage is shared.

For focused diagnosis, saved checkpoints remain available:

```powershell
node tools/vr-emulator/playthrough.js --resume t3-fuel-depot --until mining-tunnels
```

Diagnostic replays can use recovery conveniences and are not continuous acceptance evidence. Preserve their reports under distinct filenames before launching another run; the default report path is overwritten.

This gate complements Jest and `npm run vr:check`. It proves an automated campaign segment in emulation. It does not establish the rest of Peragus, physical-headset comfort or performance, sustained campaign memory, or release readiness. The navigation driver can still need bounded retries around smoothed path corners; retain those logs when assessing route quality.
