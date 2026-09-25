import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { canTriggerFireEnter, canTriggerFireExit } from '@/module/TriggerFiringRules';
import { ModuleTriggerType } from '@/enums/module/ModuleTriggerType';

describe('trigger firing rules', () => {
  test('a generic trigger fires OnEnter every time, even after it has fired before', () => {
    // 102PER HotSteam: enter sets local 55, heartbeat hurts while set, exit clears it.
    expect(canTriggerFireEnter({ type: ModuleTriggerType.GENERIC, triggered: false, trapOneShot: false })).toBe(true);
    expect(canTriggerFireEnter({ type: ModuleTriggerType.GENERIC, triggered: true, trapOneShot: false })).toBe(true);
    expect(canTriggerFireEnter({ type: ModuleTriggerType.GENERIC, triggered: true, trapOneShot: true })).toBe(true);
  });

  test('a transition trigger fires again after the player leaves and returns', () => {
    expect(canTriggerFireEnter({ type: ModuleTriggerType.TRANSITION, triggered: true, trapOneShot: false })).toBe(true);
  });

  test('only a one-shot trap latches after it has sprung', () => {
    expect(canTriggerFireEnter({ type: ModuleTriggerType.TRAP, triggered: false, trapOneShot: true })).toBe(true);
    expect(canTriggerFireEnter({ type: ModuleTriggerType.TRAP, triggered: true, trapOneShot: true })).toBe(false);
    expect(canTriggerFireEnter({ type: ModuleTriggerType.TRAP, triggered: true, trapOneShot: false })).toBe(true);
  });

  test('OnExit is never latched', () => {
    for (const type of [ModuleTriggerType.GENERIC, ModuleTriggerType.TRANSITION, ModuleTriggerType.TRAP]) {
      expect(canTriggerFireExit({ type, triggered: true, trapOneShot: true })).toBe(true);
    }
  });

  test('ModuleTrigger consults the rules instead of the raw latch', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleTrigger.ts'), 'utf8');
    const start = source.indexOf('updateObjectInside(object: ModuleObject){');
    const body = source.slice(start, source.indexOf('actionDialogObject(', start));
    expect(body).toContain('canTriggerFireEnter(this)');
    expect(body).toContain('canTriggerFireExit(this)');
    expect(body).not.toContain('if(!this.triggered && this.isHostile(object))');
  });
});
