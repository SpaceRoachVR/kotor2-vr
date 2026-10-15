import { parsePerfLayer, type PerfLayer } from '@/utility/RendererOptions';

/**
 * Cumulative bisect ladder for the VR performance harness (`?perflayer=l0..l5`).
 *
 * Each rung includes everything below it, so a harness can run one scene at
 * l0..l5 and read the cost of each layer off the frame-time difference:
 *
 * | layer | adds                                                    |
 * |-------|---------------------------------------------------------|
 * | 0     | nothing: an empty clear                                 |
 * | 1     | world submission, the player's room only                |
 * | 2     | all linked rooms                                        |
 * | 3     | characters: party, creatures, placeables, doors         |
 * | 4     | effects: emitters, grass, lights, wind                  |
 * | 5     | play layer: cursor, audio, VR UI passes, desktop mirror |
 *
 * Layer 5 is the normal game. Every call site is guarded so that at layer 5 it
 * behaves exactly as if the gate did not exist; {@link PerfLayerGate.active} is
 * the cheap test for "is any layer being stripped" and call sites that would
 * otherwise write state (group visibility) use it to stay untouched in play.
 */
export class PerfLayerGate {
  /** The active rung. 5 (everything on) until {@link configure} says otherwise. */
  static layer: PerfLayer = 5;

  /** Reads the layer from a launch query string. Absent or invalid means 5. */
  static configure(search: string): void {
    PerfLayerGate.layer = parsePerfLayer(search);
  }

  /** L1+: the scene is submitted for rendering at all. */
  static rendersWorld(): boolean { return PerfLayerGate.layer >= 1; }

  /** L2+: every linked room, not just the player's room. */
  static allRooms(): boolean { return PerfLayerGate.layer >= 2; }

  /** L3+: party, creatures, placeables and doors. */
  static characters(): boolean { return PerfLayerGate.layer >= 3; }

  /** L4+: emitters, grass, lights and wind. */
  static effects(): boolean { return PerfLayerGate.layer >= 4; }

  /** L5: cursor, audio, VR UI passes and the desktop mirror. */
  static playLayer(): boolean { return PerfLayerGate.layer >= 5; }

  /** True when any layer is being stripped (anything below L5). */
  static active(): boolean { return PerfLayerGate.layer < 5; }
}
