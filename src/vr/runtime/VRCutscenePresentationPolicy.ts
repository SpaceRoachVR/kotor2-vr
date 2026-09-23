import * as THREE from 'three';

/**
 * Where a conversation's current shot is shown in VR.
 *
 * - `theater`: the authored camera's view is reprojected onto a screen in front
 *   of the player, with the captions composited onto it.
 * - `world`: the player stays where they are, looking at the scene with their
 *   own eyes, and only the dialogue is shown on a panel in the lower half of
 *   their view.
 */
export type VRCutscenePresentation = 'theater' | 'world';

/** Which of the engine's three dialogue camera routes framed the current shot. */
export type VRCutsceneCameraKind = 'dialog' | 'placeable' | 'animated';

export interface VRCutsceneShot {
  /** The DLG's own `AnimatedCut` flag: a scripted cinematic from end to end. */
  readonly animatedCutscene: boolean;
  readonly cameraKind: VRCutsceneCameraKind;
  /** World position of the placed or animated camera, when there is one. */
  readonly cameraPosition: THREE.Vector3 | null;
  /** Speaker and listener positions, excluding the player's own character. */
  readonly participantPositions: readonly THREE.Vector3[];
  readonly playerPosition: THREE.Vector3 | null;
  /**
   * Whether a point lies over the floor of the room the player stands in:
   * true, false, or null when the engine cannot tell (no floor under it).
   *
   * This used to be the room's bounding box, which cannot answer it: on the
   * Ebon Hawk the corridor room 001ebo5 spans the whole ship, 14.8–88.7 by
   * 2.4–75.1, so every security camera on board counted as "in the player's
   * room" and its feed was held in the world, never shown (round 8, T5).
   */
  readonly isOverPlayerRoom: ((point: THREE.Vector3) => boolean | null) | null;
  /** Whether an earlier shot of this same conversation went to the theater. */
  readonly theaterAlreadyShown: boolean;
}

/**
 * Anything this close to the player is in view of the player whatever the room
 * geometry says: an adjacent corridor looking in, or a room the engine resolved
 * imprecisely.
 */
export const VR_CUTSCENE_NEARBY_METRES = 6;

/**
 * Whether a point is somewhere the player cannot see from where they stand.
 * With no idea where the player is, nothing counts as nearby.
 */
export function isVRCutscenePointRemote(
  point: THREE.Vector3,
  playerPosition: THREE.Vector3 | null,
  isOverPlayerRoom: ((point: THREE.Vector3) => boolean | null) | null,
): boolean {
  if (isOverPlayerRoom?.(point) === true) return false;
  if (playerPosition &&
    Math.hypot(point.x - playerPosition.x, point.y - playerPosition.y) <= VR_CUTSCENE_NEARBY_METRES) {
    return false;
  }
  return true;
}

/**
 * Decides one shot's presentation. The rule, as Allen set it in round 7:
 * "The only scenes that should be skipped are direct interactions, which should
 * only show dialogue on the bottom half of the screen. Movies which show scenes
 * outside of the room the player is in (such as the intro movie and camera
 * feeds or past video logs) should still show."
 *
 * 1. A DLG authored as an animated cutscene is a cinematic throughout.
 * 2. A shot through an animated camera is authored camera motion: theater.
 * 3. A placed camera the player could not see from here — the Ebon Hawk adrift
 *    outside, the hyperdrive, a security feed — is theater. A placed camera in
 *    the player's own room is just another angle on what they are looking at,
 *    unless this conversation is already on the theater: the prologue intro
 *    cuts between the cockpit and remote cameras, and flipping the screen away
 *    for each cockpit shot would pop it in and out of existence.
 * 4. The engine's own speaker/listener framing is a direct conversation, shown
 *    in the world — unless nobody in it is anywhere near the player.
 *
 * Measured on the 001EBO intro: its placed cameras 25 (the ship's exterior,
 * 38 m away), 30 (the medbay) and 23 (the hyperdrive) were all shown in the
 * world, i.e. never shown at all, while cameras 6 and 7 sit in the cockpit
 * with T3-M4.
 */
export function resolveVRCutscenePresentation(shot: VRCutsceneShot): VRCutscenePresentation {
  if (shot.animatedCutscene) return 'theater';
  if (shot.cameraKind === 'animated') return 'theater';

  if (shot.cameraKind === 'placeable') {
    if (shot.theaterAlreadyShown) return 'theater';
    if (!shot.cameraPosition) return 'theater';
    return isVRCutscenePointRemote(shot.cameraPosition, shot.playerPosition, shot.isOverPlayerRoom)
      ? 'theater'
      : 'world';
  }

  if (shot.participantPositions.length === 0) return 'world';
  const everyoneRemote = shot.participantPositions.every((position) =>
    isVRCutscenePointRemote(position, shot.playerPosition, shot.isOverPlayerRoom));
  return everyoneRemote ? 'theater' : 'world';
}
