/**
 * The moments of a swoop ride that something outside the engine wants to feel:
 * the VR layer pulses the controllers on each. No engine imports, so both the
 * player and the VR host can depend on it without a cycle.
 */
export type SwoopRideEventType = 'obstacle' | 'pad' | 'mine' | 'wall' | 'jump' | 'land';

export interface SwoopRideEvent {
  readonly type: SwoopRideEventType;
  /** 0..1, how hard: a wall tap versus a full-speed slam. */
  readonly strength: number;
}

export type SwoopRideListener = (event: SwoopRideEvent) => void;

const listeners = new Set<SwoopRideListener>();

export function addSwoopRideListener(listener: SwoopRideListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function emitSwoopRideEvent(type: SwoopRideEventType, strength = 1): void {
  const event: SwoopRideEvent = { type, strength: Math.max(0, Math.min(1, Number.isFinite(strength) ? strength : 1)) };
  for (const listener of listeners) {
    try { listener(event); } catch (error) { console.warn('swoop ride listener failed', error); }
  }
}
