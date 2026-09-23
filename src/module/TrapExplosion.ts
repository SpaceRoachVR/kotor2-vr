import { AudioEmitter } from "@/audio/AudioEmitter";
import { AudioEngine } from "@/audio/AudioEngine";
import { AudioEmitterType } from "@/enums/audio/AudioEmitterType";
import { AudioPriorityGroup } from "@/enums/audio/AudioPriorityGroup";

/** The traps.2da row fields the explosion needs. */
export interface TrapExplosionRow { explosionsound?: string; }

/**
 * The sound a fired trap makes, from traps.2da (`cb_gr_fragment` for frag
 * mines, `cb_gr_stun` for flash-stun), or undefined when the row has none.
 */
export function resolveTrapExplosionSound(
  rows: ArrayLike<TrapExplosionRow> | Record<number, TrapExplosionRow> | undefined,
  trapType: number,
): string | undefined {
  if(!rows || !Number.isInteger(trapType) || trapType < 0) return undefined;
  const sound = (rows as Record<number, TrapExplosionRow>)[trapType]?.explosionsound;
  if(typeof sound !== 'string') return undefined;
  const trimmed = sound.trim();
  return trimmed && trimmed !== '****' ? trimmed : undefined;
}

/**
 * Plays a fired trap's explosion where it fired.
 *
 * Round 11: "Mines lack both audio and explosion animation." The engine played
 * the explosion on the trap trigger's own emitter, but triggers have no emitter
 * and are destroyed the moment they fire, and a trigger made by planting a mine
 * never had the sound set at all, so every mine exploded silently. A short-lived
 * positional emitter at the trap is released once the sound ends.
 */
export async function playTrapExplosion(
  position: { x: number; y: number; z: number } | undefined,
  sound: string | undefined,
): Promise<void> {
  if(!position || !sound) return;
  const emitter = new AudioEmitter(AudioEngine.GetAudioEngine());
  emitter.maxDistance = 50;
  emitter.type = AudioEmitterType.POSITIONAL;
  emitter.setPriorityGroupId(AudioPriorityGroup.NORMAL_SPELL_EFFECTS);
  await emitter.load();
  emitter.setPosition(position.x, position.y, position.z);
  const node = await emitter.playSound(sound);
  if(!node){ emitter.destroy(); return; }
  node.onended = () => emitter.destroy();
}
