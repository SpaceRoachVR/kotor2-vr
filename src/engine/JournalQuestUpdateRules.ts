/**
 * What AddJournalQuestEntry does to a quest's state.
 *
 * nwscript.nss 367: "bAllowOverrideHigher: If this is TRUE, you can set the
 * state to a lower number than the one it is currently on". So a lower state
 * is refused without it, and a call that leaves the state where it is changes
 * nothing. Only a change updates the journal entry and raises the journal
 * notification (icon and chime). Retail scripts rely on the no-op: 106PER's
 * JournalRescue trigger re-adds RescuePC 10 from its heartbeat.
 *
 * @param current the quest's state now, or undefined when it has no entry
 * @param requested the state the script asks for
 * @param allowOverrideHigher the script's bAllowOverrideHigher
 */
export function resolveJournalQuestUpdate(
  current: number | undefined,
  requested: number,
  allowOverrideHigher: boolean,
): { state: number; changed: boolean } {
  if (current === undefined) return { state: requested, changed: true };
  if (requested === current) return { state: current, changed: false };
  if (requested < current && !allowOverrideHigher) return { state: current, changed: false };
  return { state: requested, changed: true };
}
