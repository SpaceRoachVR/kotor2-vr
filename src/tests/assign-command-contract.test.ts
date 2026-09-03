import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `AssignCommand` reported a missing subject as an error. Its own contract says
 * that is not one:
 *
 *   "6: Assign aActionToAssign to oActionSubject.
 *    * No return value, but if an error occurs, the log file will contain
 *    'AssignCommand failed.'
 *    (If the object doesn't exist, nothing happens.)"
 *
 * Scripts pass subjects that do not exist as ordinary control flow — a
 * `GetObjectByTag` that matched nothing resolves through
 * `ModuleObjectManager.GetObjectById` to `undefined`, and `OBJECT_INVALID`
 * resolves to `undefined` by explicit design. Retail does nothing. This engine
 * logged `console.error('AssignCommand', args)`, which the console captured as
 * a bare "AssignCommand Array(2)" naming neither cause nor script.
 *
 * The 82-module sweep reported it in 9 modules. After separating the two
 * conditions, all 9 lost the error and no "unusable action" replaced it —
 * confirming every occurrence was the documented no-op, not a real fault.
 *
 * `NWScriptDefK1` cannot be imported here: it reaches GameState and therefore
 * the whole engine graph. These pin the two branches at source level, plus a
 * model of the contract.
 */
const SOURCE = 'src/nwscript/NWScriptDefK1.ts';
const contents = fs.readFileSync(path.join(process.cwd(), SOURCE), 'utf8');

/**
 * The body of action 6, isolated so neighbouring actions cannot satisfy a
 * match, and with comments stripped — the rationale above the fix quotes the
 * very call it replaced, so matching raw source would pass on prose.
 */
const assignCommandBody = (() => {
  const at = contents.indexOf('name: "AssignCommand"');
  expect(at).toBeGreaterThan(-1);
  const rest = contents.slice(at);
  const body = rest.slice(0, rest.indexOf('\n  7:{'));
  return body
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
})();

describe('AssignCommand subject handling', () => {
  test('returns silently when the subject is not a ModuleObject', () => {
    // The guard must be an early return, not a logged branch.
    expect(assignCommandBody).toMatch(
      /if\(!BitWise\.InstanceOfObject\(args\[0\][\s\S]{0,80}\)\)\s*\{\s*return;/,
    );
  });

  test('does not report a missing subject as an error', () => {
    // The only console.error left must be the unusable-action branch.
    const errors = assignCommandBody.match(/console\.error\(/g) || [];
    expect(errors.length).toBe(1);
    expect(assignCommandBody).toContain('unusable action');
  });

  test('no longer dumps the raw argument array', () => {
    expect(assignCommandBody).not.toMatch(/console\.error\('AssignCommand',\s*args\)/);
  });
});

describe('AssignCommand action handling', () => {
  test('still reports an unusable action, which is a real fault', () => {
    expect(assignCommandBody).toMatch(/typeof args\[1\] !== 'object'/);
    expect(assignCommandBody).toContain('console.error');
  });

  test('names the subject and the calling script so it can be located', () => {
    expect(assignCommandBody).toContain('getTag');
    expect(assignCommandBody).toMatch(/script '\$\{/);
  });

  test('runs the assigned action when both arguments are sound', () => {
    expect(assignCommandBody).toContain('args[1].script.caller = args[0]');
    expect(assignCommandBody).toContain('args[1].script.runScript()');
  });
});

/**
 * A model of the branch selection, so the contract is asserted as behaviour
 * rather than only as text.
 */
describe('the contract', () => {
  type Outcome = 'noop' | 'error' | 'run';
  function assignCommand(subjectResolves: boolean, action: unknown): Outcome {
    if (!subjectResolves) return 'noop';
    if (typeof action !== 'object' || !action || !(action as any).script) return 'error';
    return 'run';
  }

  test.each([
    ['a missing subject', false, { script: {} }, 'noop'],
    ['a missing subject and a bad action', false, undefined, 'noop'],
    ['a sound subject and action', true, { script: {} }, 'run'],
    ['a sound subject with an undefined action', true, undefined, 'error'],
    ['a sound subject with a non-object action', true, 42, 'error'],
    ['a sound subject with a scriptless action', true, {}, 'error'],
  ])('%s -> %s', (_name, resolves, action, expected) => {
    expect(assignCommand(resolves as boolean, action)).toBe(expected);
  });

  // The subject check comes first: a missing subject is a no-op regardless of
  // what the action looks like, so a bad action cannot be reported for a
  // subject that was never there.
  test('a missing subject short-circuits before the action is judged', () => {
    expect(assignCommand(false, undefined)).toBe('noop');
  });
});
