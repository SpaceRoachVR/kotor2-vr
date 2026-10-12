import {expect, test} from '@jest/globals';
import {shouldUpdateCompanionTemplate} from '@/module/creature/CompanionTemplateOwnership';

test('a Telos cinematic copy cannot overwrite the geared active Bao-Dur template', () => {
  const live = {npcId:1};
  const copy = {npcId:1};
  expect(shouldUpdateCompanionTemplate(live, [live])).toBe(true);
  expect(shouldUpdateCompanionTemplate(copy, [live])).toBe(false);
});
test('controlled companion identity takes precedence during possession or a party rebuild', () => {
  const controlled = {npcId:8};
  const copy = {npcId:8};
  expect(shouldUpdateCompanionTemplate(controlled, [], controlled)).toBe(true);
  expect(shouldUpdateCompanionTemplate(copy, [copy], controlled)).toBe(false);
});
test('companions left in the world still save when no active instance owns their slot', () => {
  expect(shouldUpdateCompanionTemplate({npcId:1}, [{npcId:0}], {npcId:-1})).toBe(true);
});
test.each([undefined, -1, NaN, Infinity, 1.5])('invalid companion id %s does not update a roster template', npcId => {
  expect(shouldUpdateCompanionTemplate({npcId}, [])).toBe(false);
});
