import { expect, test } from '@jest/globals';
import { resolveKillExperience } from '@/combat/killExperience';

/**
 * `xptable.2da` is indexed by killer level down the rows (row 0 = level 1) and
 * victim challenge rating across the columns. The engine loaded it and used it
 * nowhere, so combat awarded no experience at all.
 *
 * These rows are the shape the 2DA loader produces: an object keyed by row
 * index, with string cells.
 */
const XPTABLE = {
  // Level 1
  '0': { __rowlabel: '0', level: '1', '0': '100', '1': '125', '2': '150', '9': '3000' },
  // Level 2
  '1': { __rowlabel: '1', level: '2', '0': '100', '1': '125', '2': '150', '9': '500' },
  // Level 3
  '2': { __rowlabel: '2', level: '3', '0': '100', '1': '100', '2': '150', '9': '525' },
};

test('a level-1 character killing a CR-1 creature earns the authored 125', () => {
  expect(resolveKillExperience(XPTABLE, 1, 1)).toBe(125);
});

test('the row is the killer level and the column is the challenge rating', () => {
  // Level 3 / CR 1 is 100 where level 1 / CR 1 is 125 — transposing the two
  // would silently pay the wrong amount rather than fail.
  expect(resolveKillExperience(XPTABLE, 3, 1)).toBe(100);
  expect(resolveKillExperience(XPTABLE, 1, 2)).toBe(150);
  expect(resolveKillExperience(XPTABLE, 2, 9)).toBe(500);
});

test('a fractional challenge rating floors to its tier', () => {
  // Challenge ratings are authored as floats; rounding up would pay out a tier
  // the creature does not belong to.
  expect(resolveKillExperience(XPTABLE, 1, 1.9)).toBe(125);
  expect(resolveKillExperience(XPTABLE, 1, 2.0)).toBe(150);
});

test('anything unresolvable yields 0 rather than throwing', () => {
  // A kill worth nothing is a balance question; a throw would abort onDeath and
  // strand the corpse mid-animation.
  expect(resolveKillExperience(null, 1, 1)).toBe(0);
  expect(resolveKillExperience(undefined, 1, 1)).toBe(0);
  expect(resolveKillExperience(XPTABLE, 99, 1)).toBe(0);
  expect(resolveKillExperience(XPTABLE, 0, 1)).toBe(0);
  expect(resolveKillExperience(XPTABLE, 1, 47)).toBe(0);
  expect(resolveKillExperience(XPTABLE, 1, -1)).toBe(0);
  expect(resolveKillExperience(XPTABLE, Number.NaN, 1)).toBe(0);
  expect(resolveKillExperience(XPTABLE, 1, Number.NaN)).toBe(0);
});

test('the 2DA empty marker is not read as a number', () => {
  // "****" is the table's own "no value"; Number("****") is NaN, and a NaN
  // reaching addXP would corrupt the total rather than award nothing.
  const rows = { '0': { level: '1', '1': '****', '2': '   ', '3': '0' } };

  expect(resolveKillExperience(rows, 1, 1)).toBe(0);
  expect(resolveKillExperience(rows, 1, 2)).toBe(0);
  expect(resolveKillExperience(rows, 1, 3)).toBe(0);
});

test('a fractional cell is truncated, so experience stays a whole number', () => {
  const rows = { '0': { level: '1', '1': '125.7' } };

  expect(resolveKillExperience(rows, 1, 1)).toBe(125);
});

/**
 * Retail's HUD has two experience notices, plot (LBL_PLOTXP) and stealth
 * (LBL_STEALTHXP), and its kill reward is a Combat-log line (dialog.tlk
 * 1407). Paying kill XP through the plot-XP route lit the plot notice and
 * played the journal chime (gui_quest) on every kill.
 */
test('kill experience is paid without the plot-XP notice', () => {
  const fs = require('fs');
  const path = require('path');
  const creature = fs.readFileSync(path.join(__dirname, '..', 'module', 'ModuleCreature.ts'), 'utf8');
  const award = creature.slice(creature.indexOf('  awardKillExperience(){'));
  const body = award.slice(0, award.indexOf('\n  }\n'));
  expect(body).toContain('GameState.PartyManager.GiveXP(experience, false);');
  const party = fs.readFileSync(path.join(__dirname, '..', 'managers', 'PartyManager.ts'), 'utf8');
  expect(party).toMatch(/static GiveXP\(nXP = 0, notify = true\)\{[\s\S]*?if\(notify\)\{\s*GameState\.UINotificationManager\.EnableUINotificationIconType\(UIIconTimerType\.PLOT_XP_RECEIVED\);/);
});
