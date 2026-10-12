import { afterEach, expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));

import { GameState } from '@/GameState';
import { ActionParameter } from '@/actions/ActionParameter';
import { ActionParameterType } from '@/enums/actions/ActionParameterType';
import { GFFDataType } from '@/enums/resource/GFFDataType';
import { GFFField } from '@/resource/GFFField';
import { GFFStruct } from '@/resource/GFFStruct';
import { NWScript } from '@/nwscript/NWScript';

GameState.NWScript = NWScript;

function scriptSituation(validStack: boolean): GFFStruct {
  const parameter = new GFFStruct();
  parameter.addField(new GFFField(GFFDataType.DWORD, 'Type', ActionParameterType.SCRIPT_SITUATION));
  const script = new GFFStruct();
  script.addField(new GFFField(GFFDataType.CEXOSTRING, 'Name', 'test_continuation'));
  script.addField(new GFFField(GFFDataType.VOID, 'Code').setData(new Uint8Array([0x20, 0x00])));
  script.addField(new GFFField(GFFDataType.DWORD, 'CodeSize', 2));
  script.addField(new GFFField(GFFDataType.DWORD, 'InstructionPtr', 0));
  const stack = new GFFStruct();
  stack.addField(new GFFField(GFFDataType.INT, 'BasePointer', 0));
  stack.addField(new GFFField(GFFDataType.INT, 'StackPointer', 0));
  if(validStack) stack.addField(new GFFField(GFFDataType.INT, 'TotalSize', 0));
  script.addField(new GFFField(GFFDataType.STRUCT, 'Stack')).addChildStruct(stack);
  parameter.addField(new GFFField(GFFDataType.STRUCT, 'Value')).addChildStruct(script);
  return parameter;
}

afterEach(() => {
  for(const instance of [...NWScript.NWScriptInstanceMap.values()]) instance.dispose();
});

test('a failed saved-stack restore does not retain a registered script instance', () => {
  const before = NWScript.NWScriptInstanceMap.size;
  expect(() => ActionParameter.FromStruct(scriptSituation(false))).toThrow();
  expect(NWScript.NWScriptInstanceMap.size).toBe(before);
});

test('a valid saved script situation retains its continuation and restored stack', () => {
  const parameter = ActionParameter.FromStruct(scriptSituation(true));
  expect(parameter?.scriptInstance.isStoreState).toBe(true);
  expect(parameter?.scriptInstance.nwscript.name).toBe('test_continuation');
  expect(parameter?.scriptInstance.stack.pointer).toBe(0);
  expect(NWScript.NWScriptInstanceMap.has(parameter!.scriptInstance.uuid)).toBe(true);
});
