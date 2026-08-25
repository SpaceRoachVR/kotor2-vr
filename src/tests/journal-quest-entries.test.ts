import { describe, expect, test } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Quests never appeared in the journal, though the prologue's own tutorial
 * announces them ("You have new quests"). Measured in a live headset session:
 * 117 categories loaded from `global.jrl` against **0 entries**.
 *
 * Three independent faults, all required:
 *
 * 1. The gate was `PlotExists`, which reads `plot.2da` — the 84-row experience
 *    table — instead of the 117 quest categories in `global.jrl`. Measured
 *    live: **0 of 117** categories passed it, so every quest in the game was
 *    rejected before it could be recorded.
 * 2. `AddJournalQuestEntry` built a new `JournalEntry`, called `load()` on it,
 *    and never pushed it into `Entries` — so every first-time quest was created
 *    and discarded. It also returned `false` unconditionally.
 * 3. The three NWScript opcodes that drive the journal — 367
 *    `AddJournalQuestEntry`, 368 `RemoveJournalQuestEntry`, 369
 *    `GetJournalEntry` — were all `action: undefined`, so no script could reach
 *    the manager at all. Same shape as the Galaxy Map opcodes (739-744).
 */
const MANAGER = fs.readFileSync(path.join(process.cwd(), 'src/managers/JournalManager.ts'), 'utf8');
const DEFS = fs.readFileSync(path.join(process.cwd(), 'src/nwscript/NWScriptDefK2.ts'), 'utf8');

const NEXT_STATIC = /\n  static /;

function methodBody(name: string): string {
  const at = MANAGER.indexOf(`static ${name}`);
  expect(at).toBeGreaterThan(-1);
  const rest = MANAGER.slice(at + 10);
  const end = rest.search(NEXT_STATIC);
  return end === -1 ? rest : rest.slice(0, end);
}

function opcodeBody(name: string): string {
  const at = DEFS.indexOf(`name: '${name}'`);
  expect(at).toBeGreaterThan(-1);
  const rest = DEFS.slice(at);
  return rest.slice(0, rest.indexOf('\n  },'));
}

describe('the quest gate is the journal, not the experience table', () => {
  test('AddJournalQuestEntry gates on the global.jrl category', () => {
    const body = methodBody('AddJournalQuestEntry');
    expect(body).toMatch(/GetCategoryByTag\(szPlotID\)/);
    expect(body).not.toMatch(/if\(JournalManager\.PlotExists\(szPlotID\)\)/);
  });

  test('plot.2da is still used for quest experience, which is its purpose', () => {
    expect(methodBody('GetJournalQuestExperience')).toMatch(/datatables\.get\('plot'\)/);
  });
});

describe('a first-time quest entry reaches the journal', () => {
  test('AddJournalQuestEntry pushes the entry it just built', () => {
    const body = methodBody('AddJournalQuestEntry');
    // The else branch is the first-time path; it must add, not just load.
    const elseBranch = body.slice(body.indexOf('}else{'));
    expect(elseBranch).toMatch(/JournalManager\.AddEntry\(entry\)/);
  });

  test('it reports success rather than always returning false', () => {
    expect(methodBody('AddJournalQuestEntry')).toMatch(/return true;/);
  });
});

describe('the journal opcodes are wired to the manager', () => {
  test.each([
    ['AddJournalQuestEntry', /JournalManager\.AddJournalQuestEntry\(/],
    ['RemoveJournalQuestEntry', /JournalManager\.RemoveJournalQuestEntry\(/],
    ['GetJournalEntry', /JournalManager\.GetJournalEntryState\(/],
  ])('%s has an implementation', (name, call) => {
    const body = opcodeBody(name as string);
    expect(body).not.toMatch(/action:\s*undefined/);
    expect(body).toMatch(call as RegExp);
  });

  test('GetJournalEntry returns the state rather than discarding it', () => {
    expect(opcodeBody('GetJournalEntry')).toMatch(/return\s+GameState\.JournalManager\.GetJournalEntryState/);
  });

  test('bAllowOverrideHigher is passed as a boolean, not the raw int', () => {
    expect(opcodeBody('AddJournalQuestEntry')).toMatch(/!!args\[2\]/);
  });
});
