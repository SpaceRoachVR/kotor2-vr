import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

// Module reaches three's ESM examples, the NWScript VM and the audio engine at
// import time. None of that is on the addEffect path, so stub just enough to load it.
jest.mock('@/GameState', () => ({ GameState: {} }));
jest.mock('@/three/odyssey', () => ({ OdysseyModel3D: class {}, OdysseyObject3D: class {} }));
jest.mock('@/nwscript/NWScriptInstance', () => ({ NWScriptInstance: class {} }));
jest.mock('@/nwscript/NWScript', () => ({ NWScript: class {} }));
jest.mock('@/loaders', () => ({ MDLLoader: class {}, ResourceLoader: class {}, TextureLoader: class {} }));
jest.mock('@/module/ModuleArea', () => ({ ModuleArea: class {} }));
jest.mock('@/odyssey', () => ({ OdysseyModel: class {}, OdysseyModelAnimation: class {}, OdysseyWalkMesh: class {} }));
jest.mock('@/audio/AudioEngine', () => ({ AudioEngine: { GetAudioEngine: (): object => ({}) } }));
jest.mock('@/audio/AudioEmitter', () => ({
  AudioEmitter: class {
    static created: any[] = [];
    maxDistance = 0;
    type = 0;
    destroyed = false;
    constructor(){ (this.constructor as any).created.push(this); }
    setPriorityGroupId(): void { /* inert */ }
    load(): void { /* inert */ }
    setPosition(): void { /* inert */ }
    playSound(): void { /* inert */ }
    destroy(): void { this.destroyed = true; }
  },
}));

import { GameState } from '@/GameState';
import { AudioEmitter } from '@/audio/AudioEmitter';
import { Module } from '@/module/Module';
import { LocationEffectHost } from '@/module/LocationEffectHost';
import { GameEffect } from '@/effects/GameEffect';
import { EffectLink } from '@/effects/EffectLink';
import { EffectACIncrease } from '@/effects/EffectACIncrease';
import { GameEffectDurationType } from '@/enums/effects/GameEffectDurationType';

const { INSTANT, TEMPORARY, PERMANENT } = GameEffectDurationType;

let scene: THREE.Group;
let time: { getFutureTimeFromSeconds: jest.Mock<(seconds: number) => { pauseDay: number; pauseTime: number }>; update: jest.Mock };

/** A stand-in effect that records what happened to it. */
class Probe extends GameEffect {
  removed = 0;
  appliedWith: unknown;
  onApply(object?: any){
    if(this.applied) return;
    super.onApply();
    this.appliedWith = object;
  }
  onRemove(){ this.removed++; }
}

function module(): Module {
  const m = Object.create(Module.prototype) as Module;
  m.effects = [];
  m.locationEffectHosts = new Map();
  m.eventQueue = [];
  m.readyToProcessEvents = true;
  m.timeManager = time as any;
  return m;
}

function at(x = 4, y = 5, z = 6): any {
  return { position: new THREE.Vector3(x, y, z) };
}

/** Runs Module.tick the way the game loop does. */
function advance(m: Module, seconds: number, step = 0.25): void {
  for(let t = 0; t < seconds; t += step){ m.tick(step); }
}

function emitters(): any[] {
  return (AudioEmitter as any).created;
}

beforeEach(() => {
  scene = new THREE.Group();
  (GameState as any).group = { effects: scene };
  (AudioEmitter as any).created = [];
  time = {
    getFutureTimeFromSeconds: jest.fn((seconds: number) => ({ pauseDay: 1, pauseTime: 1000 + seconds * 1000 })),
    update: jest.fn(),
  };
});

afterEach(() => {
  delete (GameState as any).group;
  jest.restoreAllMocks();
});

describe('Module.addEffect: lifetime', () => {
  test('a TEMPORARY effect gets an expiry, leaves when it runs out, and takes its host with it', () => {
    const m = module();
    const effect = new Probe();

    m.addEffect(effect, at(), TEMPORARY, 3);

    expect(effect.getDurationType()).toBe(TEMPORARY);
    expect(effect.expireTime).toBe(4000);
    expect(m.effects).toEqual([effect]);
    expect(scene.children).toHaveLength(1);

    advance(m, 2.5);
    expect(m.effects).toEqual([effect]);

    // Before the fix onDurationEnd called Module.removeEffect, which did not
    // exist, and tick threw every frame from then on.
    expect(() => advance(m, 1.5)).not.toThrow();
    expect(m.effects).toEqual([]);
    expect(effect.removed).toBe(1);
    expect(scene.children).toHaveLength(0);
    expect(emitters()[0].destroyed).toBe(true);
    expect(m.locationEffectHosts.size).toBe(0);
  });

  test('a PERMANENT effect never gains an expiry and keeps its host', () => {
    const m = module();
    const effect = new Probe();

    m.addEffect(effect, at(), PERMANENT, 0);
    advance(m, 600, 1);

    expect(effect.getDurationType()).toBe(PERMANENT);
    expect([effect.expireDay, effect.expireTime]).toEqual([0, 0]);
    expect(m.effects).toEqual([effect]);
    expect(scene.children).toHaveLength(1);
    expect(time.getFutureTimeFromSeconds).not.toHaveBeenCalled();
  });

  test('an INSTANT effect is not given an expiry', () => {
    const m = module();
    const effect = new Probe();

    m.addEffect(effect, at(), INSTANT, 0);
    advance(m, 10, 1);

    expect(effect.getDurationType()).toBe(INSTANT);
    expect([effect.expireDay, effect.expireTime]).toEqual([0, 0]);
    expect(m.effects).toEqual([effect]);
    expect(time.getFutureTimeFromSeconds).not.toHaveBeenCalled();
  });

  test('omitted arguments keep the lifetime the effect was built with', () => {
    const m = module();
    const effect = new Probe();
    effect.setDurationType(PERMANENT);

    m.addEffect(effect, at());

    expect(effect.getDurationType()).toBe(PERMANENT);
  });

  test('an expiry that is already set is not recomputed', () => {
    const m = module();
    const effect = new Probe();
    effect.setExpireDay(9);
    effect.setExpireTime(77);

    m.addEffect(effect, at(), TEMPORARY, 3);

    expect(time.getFutureTimeFromSeconds).not.toHaveBeenCalled();
    expect([effect.expireDay, effect.expireTime]).toEqual([9, 77]);
  });

  test('a TEMPORARY effect with no duration is left as it was', () => {
    const m = module();
    const effect = new Probe();

    m.addEffect(effect, at(), TEMPORARY, 0);
    advance(m, 5, 1);

    expect(effect.expireTime).toBe(0);
    expect(m.effects).toEqual([effect]);
  });
});

describe('Module.addEffect: links', () => {
  test('the children are attached, not the link, and share the link lifetime and one host', () => {
    const m = module();
    const a = new Probe();
    const b = new EffectACIncrease();
    const link = new EffectLink(a, b);

    m.addEffect(link, at(), TEMPORARY, 3);

    expect(m.effects).toEqual([a, b]);
    expect(m.effects).not.toContain(link);
    for(const child of [a, b]){
      expect(child.getDurationType()).toBe(TEMPORARY);
      expect(child.duration).toBe(3);
      expect(child.expireTime).toBe(4000);
      // Attached to the host that carries its model and emitter; the module has
      // neither, which is how every location visual used to vanish (round 11).
      expect(child.object).toBe(m.locationEffectHosts.get(child));
      expect(child.object).not.toBe(m);
    }
    expect(a.applied && b.applied).toBe(true);
    expect(scene.children).toHaveLength(1);
    expect(m.locationEffectHosts.get(a)).toBe(m.locationEffectHosts.get(b));

    advance(m, 4);
    expect(m.effects).toEqual([]);
    expect(scene.children).toHaveLength(0);
  });

  test('a PERMANENT link keeps its children', () => {
    const m = module();
    const a = new Probe();
    const b = new Probe();

    m.addEffect(new EffectLink(a, b), at(), PERMANENT, 0);
    advance(m, 600, 1);

    expect(m.effects).toEqual([a, b]);
    expect([a, b].every((e) => e.getDurationType() === PERMANENT && e.expireTime === 0)).toBe(true);
  });

  test('nested links hand the lifetime all the way down', () => {
    const m = module();
    const leaves = [new Probe(), new Probe(), new Probe()];

    m.addEffect(new EffectLink(new EffectLink(leaves[0], leaves[1]), leaves[2]), at(), TEMPORARY, 2);

    expect(m.effects).toEqual(leaves);
    advance(m, 3);
    expect(m.effects).toEqual([]);
    expect(scene.children).toHaveLength(0);
  });

  test('a link with no children leaves no host behind', () => {
    const m = module();

    m.addEffect(new EffectLink(), at(), TEMPORARY, 3);

    expect(m.effects).toEqual([]);
    expect(scene.children).toHaveLength(0);
    expect(emitters()[0].destroyed).toBe(true);
  });
});

describe('Module.addEffect: the host', () => {
  test('sits at the location and is what the effect is applied with and created by', () => {
    const m = module();
    const effect = new Probe();

    m.addEffect(effect, at(4, 5, 6), PERMANENT);

    const host = m.locationEffectHosts.get(effect);
    expect(host).toBeInstanceOf(LocationEffectHost);
    expect(host.model.position.toArray()).toEqual([4, 5, 6]);
    expect(host.position.toArray()).toEqual([4, 5, 6]);
    expect(effect.appliedWith).toBe(host);
    expect(effect.getCreator()).toBe(host);
    expect(host.audioEmitter).toBe(emitters()[0]);
  });

  test('removing one child of a link keeps the host until the other goes', () => {
    const m = module();
    const a = new Probe();
    const b = new Probe();
    m.addEffect(new EffectLink(a, b), at(), PERMANENT);

    m.removeEffect(a);
    expect(scene.children).toHaveLength(1);
    expect(a.removed).toBe(1);

    m.removeEffect(b);
    expect(scene.children).toHaveLength(0);
    expect(m.effects).toEqual([]);
  });

  test('removing an effect the module does not carry does nothing', () => {
    const m = module();
    const kept = new Probe();
    const stranger = new Probe();
    m.addEffect(kept, at(), PERMANENT);

    m.removeEffect(stranger);

    expect(stranger.removed).toBe(0);
    expect(m.effects).toEqual([kept]);
  });

  test('with no location nothing is attached and nothing throws', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const m = module();

    expect(() => m.addEffect(new Probe(), undefined, TEMPORARY, 3)).not.toThrow();
    expect(m.effects).toEqual([]);
    expect(scene.children).toHaveLength(0);
  });

  test('LocationEffectHost.dispose is idempotent', () => {
    const emitter = { destroy: jest.fn() };
    const host = new LocationEffectHost(new THREE.Vector3(), scene, emitter as any);

    host.dispose();
    host.dispose();

    expect(emitter.destroy).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(0);
  });
});

describe('a location effect draws and plays on its host', () => {
  test('the host offers what a visual effect reads from its object', () => {
    const removed: unknown[] = [];
    const owner = { removeEffect: (e: unknown) => { removed.push(e); } };
    const host = new LocationEffectHost(new THREE.Vector3(1, 2, 3), undefined, undefined, { tag: 'ctx' }, owner as any);
    expect(host.model).toBeInstanceOf(THREE.Object3D);
    expect(host.model.position.toArray()).toEqual([1, 2, 3]);
    expect(host.rotation).toBeInstanceOf(THREE.Euler);
    expect(host.quaternion).toBeInstanceOf(THREE.Quaternion);
    expect(host.context).toEqual({ tag: 'ctx' });
    const effect = {} as any;
    host.removeEffect(effect);
    expect(removed).toEqual([effect]);
  });
});
