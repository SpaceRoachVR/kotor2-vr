/**
 * The ground direction a Force push throws its target: straight away from
 * the creature that pushed it. With no pusher position (or the pusher standing
 * on the target) the target is thrown backwards along its own facing.
 *
 * Deliberately free of engine imports so it can be tested without the world.
 */
export interface PointLike { x: number; y: number; }

export function forcePushDirection(target: PointLike, pusher: PointLike | undefined, targetFacing: number): [number, number] {
  if(pusher && Number.isFinite(pusher.x) && Number.isFinite(pusher.y)){
    const dx = target.x - pusher.x;
    const dy = target.y - pusher.y;
    const length = Math.hypot(dx, dy);
    if(length > 1e-3) return [dx / length, dy / length];
  }
  return [-Math.cos(targetFacing + Math.PI / 2), -Math.sin(targetFacing + Math.PI / 2)];
}
