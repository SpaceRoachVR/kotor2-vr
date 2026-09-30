import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

jest.mock('@/GameState', () => ({ GameState: { debugMode: false } }));

import { AutoSaveManager, AutoSaveWorld } from '@/engine/AutoSaveManager';
import { NWScriptInstance } from '@/nwscript/NWScriptInstance';
import { buildVRActionWheel, VRActionWheelBuildContext } from '@/vr/runtime/VRActionWheelModelBuilder';

// Critic review 2026-09-29: freezes with no autosave cost whole headset rounds.
function world(overrides: Partial<AutoSaveWorld> = {}) {
  const save = jest.fn<AutoSaveWorld['save']>(() => Promise.resolve());
  const w: AutoSaveWorld = {
    enabled: () => true,
    canSave: () => true,
    inCombat: () => false,
    save,
    ...overrides,
  };
  return { w, save };
}

describe('AutoSaveManager', () => {
  beforeEach(() => AutoSaveManager.reset());

  test('an area request waits for quiet play, then saves to the autosave slot once', async () => {
    const { w, save } = world();
    AutoSaveManager.world = w;
    AutoSaveManager.request('area');
    AutoSaveManager.update(1.0);
    expect(save).not.toHaveBeenCalled();
    AutoSaveManager.update(0.6);
    expect(save).toHaveBeenCalledWith('autosave');
    await Promise.resolve();
    AutoSaveManager.update(5);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('a conversation or a fight restarts the quiet timer', () => {
    let busy = false;
    let fighting = false;
    const { w, save } = world({ canSave: () => !busy, inCombat: () => fighting });
    AutoSaveManager.world = w;
    AutoSaveManager.request('area');
    AutoSaveManager.update(1.4);
    busy = true;
    AutoSaveManager.update(1);
    busy = false;
    AutoSaveManager.update(1.4);
    fighting = true;
    AutoSaveManager.update(1);
    fighting = false;
    AutoSaveManager.update(1.4);
    expect(save).not.toHaveBeenCalled();
    AutoSaveManager.update(0.2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('a new area load drops a request that has not fired', () => {
    const { w, save } = world();
    AutoSaveManager.world = w;
    AutoSaveManager.request('script');
    AutoSaveManager.cancel();
    AutoSaveManager.update(10);
    expect(save).not.toHaveBeenCalled();
  });

  test('the Autosave option turned off means no autosave', () => {
    const { w, save } = world({ enabled: () => false });
    AutoSaveManager.world = w;
    AutoSaveManager.request('area');
    AutoSaveManager.update(10);
    expect(save).not.toHaveBeenCalled();
  });

  test('quick save happens now, and is refused in combat', () => {
    let fighting = true;
    const { w, save } = world({ inCombat: () => fighting });
    AutoSaveManager.world = w;
    expect(AutoSaveManager.quickSave()).toBe(false);
    fighting = false;
    expect(AutoSaveManager.quickSave()).toBe(true);
    expect(save).toHaveBeenCalledWith('quicksave');
  });
});

describe('save slots follow retail folder names', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', 'SaveGame.ts'), 'utf8');
  test('quicksave is 000000, autosave 000001, numbered games start at 000002 - Game1', () => {
    expect(src).toContain("folder: '000000 - QUICKSAVE'");
    expect(src).toContain("folder: '000001 - AUTOSAVE'");
    expect(src).toContain('Math.max(2, SaveGame.NEXT_SAVE_ID)');
  });
  test('DoSinglePlayerAutoSave requests an autosave', () => {
    const k1 = fs.readFileSync(path.join(__dirname, '..', 'nwscript', 'NWScriptDefK1.ts'), 'utf8');
    const at = k1.indexOf('name: "DoSinglePlayerAutoSave"');
    expect(k1.indexOf("AutoSaveManager.request('script')", at)).toBeGreaterThan(at);
    expect(k1.indexOf("AutoSaveManager.request('script')", at)).toBeLessThan(k1.indexOf('513:', at));
  });
});

describe('runaway NWScript guard', () => {
  test('a script stuck in a loop is stopped instead of freezing the frame', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const warns = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const loop: any = { address: 0, code: 0, opCall: () => {} };
    loop.nextInstr = loop;
    const instance = new NWScriptInstance(new Map([[0, loop]]));
    instance.name = 'k_test_loop';
    const before = NWScriptInstance.INSTRUCTION_ABORT;
    NWScriptInstance.INSTRUCTION_ABORT = 200000;
    try {
      instance.runScript();
    } finally {
      NWScriptInstance.INSTRUCTION_ABORT = before;
    }
    expect(instance.running).toBe(false);
    expect(warns.mock.calls.some((c) => String(c[0]).includes('k_test_loop'))).toBe(true);
    expect(errors.mock.calls.some((c) => String(c[0]).includes('aborted runaway script k_test_loop'))).toBe(true);
    errors.mockRestore();
    warns.mockRestore();
  });
});

describe('Quick Save on the wheel', () => {
  function context(overrides: Partial<VRActionWheelBuildContext> = {}): VRActionWheelBuildContext {
    return {
      id: 'action-wheel',
      targetActions: [],
      selfActions: [],
      targetIsHostileCreature: false,
      partyMembers: [],
      openComfortSettings: jest.fn(),
      openMenu: jest.fn(),
      quickSave: jest.fn(),
      canClearActions: false,
      clearQueuedActions: jest.fn(),
      canClearUpcomingActions: false,
      clearUpcomingActions: jest.fn(),
      ...overrides,
    };
  }
  const ids = (m: ReturnType<typeof buildVRActionWheel>) => m.pages.flatMap((p) => p.entries.map((e) => e.id));

  test('offered out of combat', () => {
    expect(ids(buildVRActionWheel(context()))).toContain('menu:quicksave');
  });
  test('not offered with a hostile targeted', () => {
    expect(ids(buildVRActionWheel(context({ targetIsHostileCreature: true })))).not.toContain('menu:quicksave');
  });
});
