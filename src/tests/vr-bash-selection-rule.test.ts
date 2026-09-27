import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Allen, 2026-09-26: swing-to-bash fired on any locked door or container the
 * weapon hand pointed at, bashing things while he reached for other prompt
 * options. Bash must be chosen from the prompt first; only then does a swing
 * bash that target.
 */
const read = (file: string) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('arming Bash from the world prompt', () => {
  // GameState is heavy to import in Jest; the rule is small enough to pin.
  const game = read('GameState.ts');

  test('only a Bash pick on a module object arms it', () => {
    const at = game.indexOf('export function resolveArmedBashTargetId(');
    const body = game.slice(at, game.indexOf('\n}', at));
    // Evaluate the pure rule in isolation.
    const rule = new Function('promptId', 'label',
      body.slice(body.indexOf('{') + 1)) as (promptId: string | null, label: string) => number | null;
    expect(rule('module-object:443', 'Bash')).toBe(443);
    expect(rule('module-object:443', 'Use')).toBeNull();
    expect(rule('module-object:443', 'Security')).toBeNull();
    expect(rule(null, 'Bash')).toBeNull();
    expect(rule('party:2', 'Bash')).toBeNull();
  });

  test('a swing is offered a bash context only for the armed target', () => {
    const at = game.indexOf('getWeaponBashContext: (aimedTargetId) => {');
    const body = game.slice(at, game.indexOf('serviceCombatSwingBuffer:', at));
    expect(body).toContain('if (aimedTargetId === null || aimedTargetId !== vrArmedBashTargetId) return null;');
    expect(game).toMatch(/noteWorldPromptSelection: \(promptId, label\) => \{\s*vrArmedBashTargetId = resolveArmedBashTargetId\(promptId, label\);/);
  });

  test('every player prompt pick is reported, with the prompt it came from', () => {
    const spike = read('vr/VRSpike.ts');
    const at = spike.indexOf("} else if (effect.type === 'activate') {");
    const body = spike.slice(at, spike.indexOf('action.activate();', at));
    expect(body).toContain('const promptId = VRSpike.worldPromptCandidateId;');
    expect(body).toContain('VRSpike.hooks?.noteWorldPromptSelection?.(promptId, action.label);');
    expect(body.indexOf('const promptId')).toBeLessThan(body.indexOf('VRSpike.clearWorldActionPrompt(false);'));
  });
});
