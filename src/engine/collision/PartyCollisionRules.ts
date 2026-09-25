/**
 * Whether one creature's movement should ignore another creature's body.
 *
 * Followers have no "step aside" behaviour here, so a party member standing
 * in a narrow place pinned the controlled leader for good: at 106PER's
 * Decontamination Console the strip between the gas vents is 2.5 m wide,
 * Atton stood 1.9 m from the Exile, and every push at the console stopped on
 * him (run 14 of the Peragus playthrough, reproduced by
 * tools/vr-emulator/probe-deccon-walk.js). Retail lets the controlled
 * character walk through their own party. Only the leader gets the pass;
 * followers still collide with the leader and with each other, and nothing
 * outside the party is affected.
 */
export interface PartyCollisionCandidate {
  readonly isPM?: boolean;
}

export function shouldIgnoreCreatureCollision<T extends PartyCollisionCandidate>(
  self: T,
  other: T,
  party: readonly T[],
): boolean {
  if (!self || !other || self === other) return false;
  if (!Array.isArray(party) || party.length === 0) return false;
  if (party[0] !== self) return false;
  return party.includes(other) || other.isPM === true;
}
