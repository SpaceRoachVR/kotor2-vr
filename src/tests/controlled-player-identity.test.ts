import { expect, test } from '@jest/globals';
import { getTransitionPlayerNpcId, resolveSavedControlledNpcId } from '@/managers/ControlledPlayerIdentity';

test('a possessed companion retains the roster slot needed for party saves and later switches', () => {
  expect(getTransitionPlayerNpcId(false, 8)).toBe(8);
  expect(getTransitionPlayerNpcId(false, 0)).toBe(0);
  expect(getTransitionPlayerNpcId(false, 11)).toBe(11);
});

test('the actual player keeps the player sentinel rather than a companion slot', () => {
  expect(getTransitionPlayerNpcId(true, 8)).toBe(-1);
  expect(getTransitionPlayerNpcId(true, -1)).toBe(-1);
  expect(getTransitionPlayerNpcId(true, undefined)).toBe(-1);
  expect(getTransitionPlayerNpcId(false, undefined)).toBe(-1);
});

test.each([-2, NaN, Infinity, 1.5])('invalid NPC slot %s cannot silently corrupt the party roster', (slot) => {
  expect(() => getTransitionPlayerNpcId(false, slot)).toThrow(RangeError);
});

test('rejects a malformed player flag', () => {
  expect(() => getTransitionPlayerNpcId(undefined as unknown as boolean, 8)).toThrow(TypeError);
});

test('a saved possessed body restores its leader slot without becoming the Exile', () => {
  const roster=[{npcId:8,available:true,tag:'T3M4'},{npcId:0,available:false,tag:'Atton'}];
  expect(resolveSavedControlledNpcId(' t3m4 ',roster)).toBe(8);
  expect(resolveSavedControlledNpcId('Atton',roster)).toBe(-1);
  expect(resolveSavedControlledNpcId('',roster)).toBe(-1);
  expect(resolveSavedControlledNpcId('Exile',roster)).toBe(-1);
  expect(resolveSavedControlledNpcId('T3M4',[])).toBe(-1);
});

test('ambiguous saved leaders fail instead of assigning an arbitrary companion slot', () => {
  expect(()=>resolveSavedControlledNpcId('T3M4',[
    {npcId:8,available:true,tag:'T3M4'},{npcId:9,available:true,tag:'t3m4'},
  ])).toThrow(/multiple available companions/);
});

test('malformed saved roster data is rejected', () => {
  expect(()=>resolveSavedControlledNpcId(null as unknown as string,[])).toThrow(TypeError);
  expect(()=>resolveSavedControlledNpcId('T3M4',[{npcId:-1,available:true,tag:'T3M4'}])).toThrow(TypeError);
  expect(()=>resolveSavedControlledNpcId('T3M4',[{npcId:8,available:'yes' as unknown as boolean,tag:'T3M4'}])).toThrow(TypeError);
});
