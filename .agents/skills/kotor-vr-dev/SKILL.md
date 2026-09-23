---
name: kotor-vr-dev
description: Expert development, interaction authoring, WebXR testing, and emulation skill for kotor2-vr (KotOR II Odyssey Engine in WebXR/Three.js). Use whenever scripting VR interactions, authoring gestures, recording/replaying WebXR traces, driving Quest 3 emulation, diagnosing engine bugs, or verifying gameplay loops.
---

# KotOR 2 VR Development & Interaction Scripting Skill

You are an expert VR Systems Engineer and Odyssey Engine specialist working on **kotor2-vr**, a TypeScript reimplementation of the Odyssey game engine (KotOR II: The Sith Lords) running in room-scale WebXR under Electron and Three.js.

---

## 1. Non-Negotiable Guardrails & Behavioral Invariants

Adhere strictly to the engineering rules defined in the repository `AGENTS.md`:

1. **NEVER run `npm run dev`**:
   - It runs `webpack-dev-server` with an absolute `publicPath`. Under Electron's `file://` scheme, this loads from the drive root and renders a completely blank/black window with zero console errors.
   - **Correct workflow**: Use `npm run webpack:dev-watch` (or `npm run webpack:dev`) for bundling, and `npm run start` for Electron.
2. **Preserve Working Tree & Uncommitted Fixes**:
   - The main checkout on branch `spike/stereo-perf` routinely carries uncommitted fixes between manual headset test rounds.
   - **NEVER** run `git checkout -- .`, `git reset --hard`, `git clean -fd`, or overwrite untracked/modified files without explicit user consent.
3. **Verify in Emulation Before Requesting Headset Testing**:
   - Real headset sessions are manual and expensive.
   - Any logic, UI, comfort, locomotion, or combat feature testable in the emulated Quest 3 harness **MUST pass `npm run vr:check`** before handing off.
4. **Verify Action Code via Jest, Not Just tsc**:
   - `npx tsc --noEmit -p tsconfig.kotorjs.json` does NOT include `src/actions/`!
   - Always run `npx jest --ci --silent` to ensure engine actions and combat logic have not regressed.
   - Run `npm run webpack:dev` before `npm run vr:check` to ensure `dist/` is fresh.
5. **Diagnostic Logging Over Pure Speculation**:
   - Explicitly log object metadata (`ResRef`, `Tag`, `ID`, and `Type`) rather than guessing. Probes must report `found: true/false`.
6. **Check Vanilla TSL Mechanics Before Fixing**:
   - Consult Odyssey data definitions (2DA, GFF, DLG) before fixing perceived bugs. `Lockable` means "can be re-locked", not "pickable". `Plot` means indestructible, not unusable.

---

## 2. Odyssey Engine & WebXR Architecture

Understanding the separation of concerns is critical for writing correct interaction code:

```
[ WebXR Tracked Controllers / Headset ]
                    │
                    ▼
          [ XRInputRouter ]
                    │ (Raw poses & button edges)
                    ▼
      [ VRInteractionSystem & Gestures ]
                    │ (Near-touch / ray / swing / flick)
                    ▼
          [ VRWorldUseAdapter ]
                    │ (VR authorizes intent)
                    ▼
   [ Engine Core / ModuleCreature / CombatRound ]
                    │ (Sole source of truth: rolls, damage, inventory, saves)
                    ▼
          [ Three.js Renderers ]
```

### Core Design Principles
- **VR Authorizes; The Engine Resolves**: VR code never rolls damage, decrements inventory, calculates range, applies a feat, or writes combat results.
- **No Speculative Engine Actions**: Selecting an action changes only VR intent state. Its engine action is resolved and dispatched only when matching physical input is confirmed.
- **Fail Closed**: A stale target, invalid action, missing pose, full queue, active dialog, weapon swap, party change, or exception MUST refuse to issue an engine action.
- **Presentation is Non-Mutating**: Controller-anchored models and arms are clones. The original actor body and equipment remain under engine ownership.

---

## 3. VR Interaction Scripting & Testing Toolkit

### A. Declarative WebXR Action DSL (`tools/vr-emulator/dsl/`)
When authoring automated tests or scenario walkthroughs, avoid raw coordinate math and string-concatenated CDP calls. Use the high-level DSL:

```typescript
const { WebXRActionDriver } = require('./dsl/WebXRActionDriver');

// Aim ray at an interactive terminal or door
await driver.aimRayAt({ tag: 'MedCom' });
await driver.pressTrigger('right');

// Execute physical melee swing
await driver.performMeleeSwing({ speed: 2.5, direction: 'horizontal' });

// Force gesture flick
await driver.performForceFlick({ direction: 'push', speed: 1.5 });
```

### B. In-Engine Trace Recording & Replay (`src/vr/runtime/recording/`)
When reproducing or asserting physical VR interaction bugs:
- **Record**: Call `VRSpike.startInputRecording()` (or via `vr_record_trace` tool in `kotor-vr-mcp`) during a session to capture frame-by-frame controller poses and button states into `.vrtrace.json`.
- **Replay**: Call `VRSpike.playInputTrace(trace)` in tests to deterministically replay the exact physical movement through `XRInputRouter`.

### C. Live Inspection via KotOR-VR MCP & CDP
- Query active targets: Inspect `VRSpike.interactionRegistry.getTargets()` or use `vr_inspect_interaction_targets` tool to inspect ray/near reach candidates and distances.
- Inspect engine mode: Confirm whether engine is in `EngineMode.DIALOG` or menu ownership before attempting gameplay actions.
- Debug Gizmos: Call `VRSpike.toggleInteractionGizmos()` or use `vr_toggle_debug_gizmos` to visualize 3D target radii, controller rays, and velocity ribbons.

---

## 4. Verification Checklist
Before completing any VR interaction task:
- [ ] Code compiles cleanly with strict null checks (`npm run check:strict-null` or `npx tsc`).
- [ ] Jest unit tests pass (`npx jest --ci --silent`).
- [ ] Bundle rebuilt (`npm run webpack:dev`).
- [ ] Emulated Quest 3 check passes (`npm run vr:check`).
