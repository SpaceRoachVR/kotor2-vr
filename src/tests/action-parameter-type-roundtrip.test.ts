import { expect, jest, test } from '@jest/globals';

jest.mock('@/GameState', () => ({ GameState: {} }));
// Only a type here; the real module drags in THREE's ESM examples.
jest.mock('@/nwscript/NWScriptInstance', () => ({ NWScriptInstance: class {} }));
import { ActionParameter } from '@/actions/ActionParameter';
import { ActionParameterType } from '@/enums/actions/ActionParameterType';

/**
 * ActionParameter.toStruct never wrote the 'Type' field that FromStruct keys
 * off (and that retail saves write as a DWORD on every parameter, per
 * tools/parity/save_schema.py), so every action parameter in a save reloaded as
 * undefined. action-parameter-structs.test.ts guards the hole that produced.
 */
test.each([
  [ActionParameterType.INT, 42],
  [ActionParameterType.FLOAT, 1.5],
  [ActionParameterType.DWORD, 0x7f000001],
  [ActionParameterType.STRING, 'k_ai_master'],
])('type %i parameter survives toStruct -> FromStruct', (type, value) => {
  const struct = new ActionParameter(type, value).toStruct();
  expect(struct.getFieldByLabel('Type').getValue()).toBe(type);

  const reloaded = ActionParameter.FromStruct(struct);
  expect(reloaded).toBeDefined();
  expect(reloaded!.type).toBe(type);
  expect(reloaded!.value).toBe(value);
});
