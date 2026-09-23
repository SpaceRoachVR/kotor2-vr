import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { NWScriptDataType } from '@/enums/nwscript/NWScriptDataType';
import { defaultValueForUnimplementedAction } from '@/nwscript/unimplementedActionDefault';

describe('unimplemented NWScript actions keep the stack aligned', () => {
  test('each returning type gets its "nothing" value', () => {
    expect(defaultValueForUnimplementedAction(NWScriptDataType.INTEGER)).toBe(0);
    expect(defaultValueForUnimplementedAction(NWScriptDataType.FLOAT)).toBe(0.0);
    expect(defaultValueForUnimplementedAction(NWScriptDataType.STRING)).toBe('');
    expect(defaultValueForUnimplementedAction(NWScriptDataType.OBJECT)).toBeUndefined();
    expect(defaultValueForUnimplementedAction(NWScriptDataType.EFFECT)).toBeUndefined();
  });

  test('CALL_ACTION pushes a value for a non-VOID action that has no implementation', () => {
    // CALL_ACTION imports GameState, so it is checked by source rather than
    // executed: the else branch must push, and only for non-VOID actions.
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'nwscript', 'NWScriptInstructionSet.ts'),
      'utf8',
    );
    const start = source.indexOf('export const CALL_ACTION');
    const end = source.indexOf('export const', start + 1);
    const body = source.slice(start, end);
    const elseBranch = body.slice(body.lastIndexOf('}else{'));

    expect(elseBranch).toMatch(/action_definition\.type != NWScriptDataType\.VOID/);
    expect(elseBranch).toMatch(
      /this\.stack\.push\(\s*defaultValueForUnimplementedAction\(action_definition\.type\),\s*action_definition\.type\s*\)/,
    );
  });
});
