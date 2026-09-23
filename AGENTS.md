# kotor2-vr Engineering Rules & Behavioral Invariants

You are working on **kotor2-vr**, a TypeScript reimplementation of the Odyssey engine (KotOR II: The Sith Lords) being turned into a room-scale VR experience.

## Non-Negotiable Guardrails

1. **NEVER run `npm run dev`**:
   - It runs webpack-dev-server with an absolute `publicPath`. Under Electron's `file://` scheme, this loads from the drive root and renders a completely blank/black window with zero console errors.
   - Build workflow: Use `npm run webpack:dev-watch` (or `npm run webpack:dev`) for bundling, and `npm run start` for Electron.

2. **Preserve Working Tree & Uncommitted Fixes**:
   - The main checkout on branch `spike/stereo-perf` routinely carries a large set of uncommitted fixes between manual headset test rounds.
   - NEVER run `git checkout -- .`, `git reset --hard`, `git clean -fd`, or overwrite untracked/modified files without explicit user consent.

3. **Verify in Emulation Before Requesting Headset Testing**:
   - A real headset session is manual, expensive, and run by Allen.
   - Any logic, UI, comfort, locomotion, or combat feature testable in the emulated Quest 3 harness MUST pass `npm run vr:check` before handing off to Allen.

4. **Verify Action Code via Jest, Not Just tsc**:
   - `npx tsc --noEmit -p tsconfig.kotorjs.json` does NOT include `src/actions/`!
   - Always run `npx jest --ci --silent` to ensure engine actions and combat logic have not regressed.
   - Run `npm run webpack:dev` before `npm run vr:check` to ensure `dist/` is fresh.

5. **Diagnostic Logging Over Pure Speculation**:
   - When diagnosing engine errors or stuck state, add diagnostics that explicitly log object metadata (ResRef, Tag, ID, and Type) rather than guessing.
   - Ensure probes state whether their target was located (`found: true/false`), avoiding ambiguous zero-counts.

6. **Check Vanilla TSL Mechanics Before Fixing**:
   - Check Odyssey data definitions (2DA, GFF, DLG) before fixing perceived bugs.
   - `Lockable` means "can be re-locked", NOT "pickable".
   - `Plot` means indestructible, NOT unusable.
   - The prologue begins with T3-M4 (single-member droid party, empty quest log).
