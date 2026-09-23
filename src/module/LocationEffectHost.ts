import * as THREE from "three";
import type { AudioEmitter } from "@/audio/AudioEmitter";
import type { GameEffect } from "@/effects/GameEffect";

/**
 * The stand-in object for one `ApplyEffectAtLocation` call.
 *
 * An effect applied at a location has no creature or placeable to live on, so
 * `Module.addEffect` gives it this: a scene node and an audio emitter at the
 * location, recorded as the effect's creator. A link applied at a location
 * shares one host between its children.
 *
 * It used to be an object literal whose `dispose` and `removeEffect` read
 * `this.effects` and `this.onRemove`, neither of which it had, and nothing
 * called either — so every location effect left its node in
 * `GameState.group.effects` and its emitter registered for good. The host now
 * tracks the effects it carries and releases both once the last one is gone.
 */
export class LocationEffectHost {
  readonly model = new THREE.Object3D();
  readonly position: THREE.Vector3;
  readonly rotation = new THREE.Euler();
  readonly quaternion = new THREE.Quaternion();
  readonly effects: GameEffect[] = [];
  disposed = false;

  constructor(
    position: THREE.Vector3,
    private readonly scene?: THREE.Object3D,
    public audioEmitter?: AudioEmitter,
    /** What model loading reads as `object.context` (GameState in the game). */
    readonly context?: unknown,
    /** Removal goes back through the owner, which keeps the host bookkeeping. */
    private readonly owner?: { removeEffect(effect: GameEffect): void },
  ){
    this.position = position.clone();
    this.model.position.copy(position);
    this.scene?.add(this.model);
  }

  /**
   * An effect is attached to its host, not to the module: a visual effect puts
   * its models on `object.model` and plays on `object.audioEmitter`, and the
   * module has neither, so every ApplyEffectAtLocation visual loaded its model
   * and threw it away, silently (round 11: mines, grenade blasts).
   */
  removeEffect(effect: GameEffect): void {
    this.owner?.removeEffect(effect);
  }

  track(effect: GameEffect): void {
    if(this.effects.indexOf(effect) == -1){ this.effects.push(effect); }
  }

  /** Stops carrying `effect`; disposes the host once it carries nothing. */
  release(effect: GameEffect): void {
    const index = this.effects.indexOf(effect);
    if(index >= 0){ this.effects.splice(index, 1); }
    if(!this.effects.length){ this.dispose(); }
  }

  dispose(): void {
    if(this.disposed){ return; }
    this.disposed = true;
    this.effects.length = 0;
    this.scene?.remove(this.model);
    this.audioEmitter?.destroy();
    this.audioEmitter = undefined;
  }
}
