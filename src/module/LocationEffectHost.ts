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
  readonly effects: GameEffect[] = [];
  disposed = false;

  constructor(
    position: THREE.Vector3,
    private readonly scene?: THREE.Object3D,
    public audioEmitter?: AudioEmitter,
  ){
    this.position = position.clone();
    this.model.position.copy(position);
    this.scene?.add(this.model);
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
