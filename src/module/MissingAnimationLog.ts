/**
 * Whether a missing animation is worth reporting for this object yet.
 *
 * `ModuleCreature`, `ModuleDoor` and `ModulePlaceable` all log an error when an
 * animation state resolves to no animation, and all three then set a fallback
 * state that resolves to no animation either — so the next frame logs again,
 * forever. Measured in the 82-module sweep: 702KOR produced 1194 console errors
 * and 501OND 965, together 84% of every console error in the run, and each flood
 * was a single creature (a Starving Tuk'ata, a Tame Boma) that could not resolve
 * one animation.
 *
 * `console.error` in a per-frame path is not free — it formats arguments and,
 * with devtools attached, crosses into the inspector. At VR framerates that is a
 * cost paid ninety times a second to repeat something already known.
 *
 * The information is worth keeping: an object that cannot animate is a real
 * defect. So report each distinct state once per object and stay quiet after.
 *
 * Kept free of engine imports so a test can exercise it directly — importing the
 * module classes pulls GameState and a chain Jest cannot parse, the same
 * constraint recorded in `ActiveControlDescent.ts`.
 *
 * @file MissingAnimationLog.ts
 * @license {@link https://www.gnu.org/licenses/gpl-3.0.txt|GPLv3}
 */

/**
 * @param reported - states already reported for one object; mutated on report
 * @param state - the animation state that failed to resolve
 * @returns true the first time a given state is seen, false afterwards
 */
export function shouldReportMissingAnimation(
  reported: Set<number>,
  state: number,
): boolean {
  const key = Number.isFinite(state) ? Number(state) : -1;
  if (reported.has(key)) {
    return false;
  }
  reported.add(key);
  return true;
}
