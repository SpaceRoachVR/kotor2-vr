import { XRHandInputFrame, XRHandRole, XRInputFrame, XRWorldPose } from './XRTypes';

/**
 * Picks which hand is pointing at a VR surface.
 *
 * Every ray-driven surface used to hard-code a hand — the radial menu resolved
 * its ray from the left controller only, the comfort panel and the legacy panel
 * pointer from the right only. That is invisible to the player: nothing on
 * screen says which controller a given surface listens to, so pointing with the
 * other hand simply does nothing and the surface reads as broken.
 *
 * Resolution is therefore by hit, not by role: whichever hand is actually
 * aiming at the surface owns it. Where both hands hit at once the previous
 * owner keeps the pointer, so a ray resting near the seam between two wedges
 * cannot flicker between hands from frame to frame; only losing the hit hands
 * ownership over. Each surface owns its own resolver instance, because the hand
 * pointing at the radial menu is often not the hand pointing at a panel.
 */
export interface VRResolvedPointerHand<THit> {
  readonly hand: XRHandRole;
  readonly pose: XRWorldPose;
  readonly hit: THit;
}

/** Returns the surface's hit for a ray, or null when that ray misses. */
export type VRPointerHitTest<THit> = (pose: XRWorldPose, hand: XRHandRole) => THit | null;

/** Deterministic scan order for the first acquisition, before any hand is sticky. */
const SCAN_ORDER: readonly XRHandRole[] = ['right', 'left'];

export class VRPointerHandResolver {
  private activeHand: XRHandRole | null = null;

  /**
   * Resolves the pointing hand for one frame, or null when neither hand hits.
   * A hit test that throws is treated as a miss for that hand: one surface
   * mis-projecting a ray must not take the whole frame down.
   */
  resolve<THit>(
    frame: XRInputFrame | null | undefined,
    hitTest: VRPointerHitTest<THit>,
  ): VRResolvedPointerHand<THit> | null {
    if (!frame) {
      this.activeHand = null;
      return null;
    }

    // The sticky hand is tried first so a hit it still holds wins outright.
    const order = this.activeHand
      ? [this.activeHand, ...SCAN_ORDER.filter((role) => role !== this.activeHand)]
      : SCAN_ORDER;

    for (const hand of order) {
      const pose = VRPointerHandResolver.trackedRay(frame.hands[hand]);
      if (!pose) continue;

      let hit: THit | null;
      try {
        hit = hitTest(pose, hand);
      } catch {
        continue;
      }
      if (hit === null || hit === undefined) continue;

      this.activeHand = hand;
      return { hand, pose, hit };
    }

    this.activeHand = null;
    return null;
  }

  /** The hand that last held the pointer, for drawing its ray. */
  get pointingHand(): XRHandRole | null {
    return this.activeHand;
  }

  /** Drops ownership when the surface closes, so it reacquires cleanly. */
  reset(): void {
    this.activeHand = null;
  }

  private static trackedRay(hand: XRHandInputFrame | undefined): XRWorldPose | null {
    const pose = hand?.targetRayPose;
    return pose?.trackingState === 'tracked' ? pose : null;
  }
}
