import { beforeEach, describe, expect, jest, test } from '@jest/globals';

const pending: Array<() => void> = [];
jest.mock('@/GameState', () => ({ GameState: { SWRuleSet: { getPriorityGroupById: () => ({ volume: 127 }) } } }));
jest.mock('@/audio/AudioEngine', () => ({ AudioEngine: { sfxChannel: { getGainNode: () => ({}) } } }));
jest.mock('@/audio/AudioLoader', () => ({
  AudioLoader: {
    // Each load resolves only when the test says so: the window in which a
    // second play, a stop or a destroy used to be lost.
    LoadSound: () => new Promise((resolve) => pending.push(() => resolve(new Uint8Array(4)))),
  },
}));

import { AudioEmitter } from '@/audio/AudioEmitter';

class FakeSource {
  loop = false; buffer: any = null; started = 0; stopped = 0; connected = true; onended: any = null; name = '';
  playbackRate = { value: 1 };
  connect() { this.connected = true; }
  disconnect() { this.connected = false; }
  start() { this.started++; }
  stop() { this.stopped++; }
}

function fakeEngine() {
  const sources: FakeSource[] = [];
  const node = () => ({ connect: jest.fn(), disconnect: jest.fn(), gain: { value: 1, setValueAtTime: jest.fn(), linearRampToValueAtTime: jest.fn() } });
  const engine: any = {
    audioCtx: {
      currentTime: 0,
      createBufferSource: () => { const s = new FakeSource(); sources.push(s); return s; },
      createGain: node,
      createPanner: node,
      decodeAudioData: async () => ({ duration: 1 }),
    },
    addEmitter: jest.fn(),
    removeEmitter: jest.fn(),
  };
  return { engine, sources };
}

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const resolveAll = async () => { while (pending.length) pending.shift()!(); await flush(); };
const playing = (sources: FakeSource[]) => sources.filter((s) => s.started > 0 && s.stopped === 0);

/**
 * Round 18: a constant astromech wheel sound on the Ebon Hawk exterior, and
 * audio that got worse as the run went on. Two engine faults:
 * - playSound loads the file before it starts the source, and a second play
 *   or a stop inside that window was lost: the late source looped with no
 *   reference left to stop it (the rolling droid's fs_wheel loop).
 * - destroy() left every source playing and connected: each area's looping
 *   sound objects kept going after the area was unloaded (measured: 106PER's
 *   al_vent_tube / al_holding_cell loops still live in 001EBO and 002EBO).
 */
describe('AudioEmitter sound lifetime', () => {
  beforeEach(() => { pending.length = 0; });

  test('two plays of a sound still loading start it once', async () => {
    const { engine, sources } = fakeEngine();
    const emitter = new AudioEmitter(engine);
    emitter.isLooping = true;
    void emitter.playSound('fs_wheel_drdslow');
    expect(emitter.isPlayingSound('fs_wheel_drdslow')).toBe(true);
    void emitter.playSound('fs_wheel_drdslow');
    await resolveAll();
    expect(playing(sources)).toHaveLength(1);
  });

  test('a stop while the sound loads means it never starts', async () => {
    const { engine, sources } = fakeEngine();
    const emitter = new AudioEmitter(engine);
    emitter.isLooping = true;
    void emitter.playSound('fs_wheel_drdslow');
    emitter.stop();
    await resolveAll();
    expect(playing(sources)).toHaveLength(0);
    expect(emitter.isPlayingSound('fs_wheel_drdslow')).toBe(false);
  });

  test('destroy stops a loop and nothing pending starts afterwards', async () => {
    const { engine, sources } = fakeEngine();
    const emitter = new AudioEmitter(engine);
    emitter.isLooping = true;
    void emitter.playSound('al_vent_tube');
    await resolveAll();
    expect(playing(sources)).toHaveLength(1);
    void emitter.playSound('al_vent_tube_2');
    emitter.destroy();
    await resolveAll();
    expect(playing(sources)).toHaveLength(0);
    expect(emitter.gainNode.disconnect).toHaveBeenCalled();
  });

  test('destroy lets a one-shot finish (a door destroyed sound)', async () => {
    const { engine, sources } = fakeEngine();
    const emitter = new AudioEmitter(engine);
    void emitter.playSoundFireAndForget('cb_bu_door');
    await resolveAll();
    emitter.destroy();
    expect(playing(sources)).toHaveLength(1);
    expect(emitter.gainNode.disconnect).not.toHaveBeenCalled();
    sources[0].onended();
    expect(emitter.gainNode.disconnect).toHaveBeenCalled();
  });

  test('a sound object emitter destroyed while its sounds load never starts', async () => {
    const { engine, sources } = fakeEngine();
    const emitter = new AudioEmitter(engine);
    emitter.sounds = ['amb_comp_01'];
    emitter.isLooping = true;
    const loading = emitter.load();
    emitter.destroy();
    await resolveAll();
    await loading;
    expect(playing(sources)).toHaveLength(0);
  });
});
