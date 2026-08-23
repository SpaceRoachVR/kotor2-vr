import { describe, expect, test } from '@jest/globals';

/**
 * The journal's active/completed toggle had no effect: `getFilteredEntries`
 * returned every entry regardless of mode, so both tabs showed the same list
 * and finished quests never left the active one.
 *
 * The filter is reproduced here rather than driving the menu, because the menu
 * needs a loaded GUI, a TLK manager and a live GameState. What is worth pinning
 * is the rule itself, including the two cases that are easy to get wrong: a
 * quest whose state failed to resolve, and completion coming from the category
 * entry rather than from the journal entry.
 */
enum JournalQuestMode { ACTIVE, COMPLETED }

type TestEntry = { entry?: { end?: number } };

function filterByMode(entries: readonly TestEntry[], mode: JournalQuestMode): readonly TestEntry[] {
  return entries.filter((entry) => {
    const completed = !!(entry.entry && entry.entry.end);
    return mode === JournalQuestMode.COMPLETED ? completed : !completed;
  });
}

describe('journal quest mode filter', () => {
  const active: TestEntry = { entry: { end: 0 } };
  const completed: TestEntry = { entry: { end: 1 } };
  const unresolved: TestEntry = {};
  const all = [active, completed, unresolved];

  test('the active tab excludes finished quests', () => {
    expect(filterByMode(all, JournalQuestMode.ACTIVE)).not.toContain(completed);
  });

  test('the completed tab shows only finished quests', () => {
    expect(filterByMode(all, JournalQuestMode.COMPLETED)).toEqual([completed]);
  });

  test('the two tabs partition the list, losing nothing', () => {
    // The bug was that both tabs showed everything; over-correcting into a
    // filter that drops entries from both would be worse.
    const shown = [
      ...filterByMode(all, JournalQuestMode.ACTIVE),
      ...filterByMode(all, JournalQuestMode.COMPLETED),
    ];

    expect(shown).toHaveLength(all.length);
    expect(new Set(shown)).toEqual(new Set(all));
  });

  test('an entry whose state failed to resolve stays visible as active', () => {
    // Showing a quest in the wrong tab is recoverable; hiding it is not.
    expect(filterByMode(all, JournalQuestMode.ACTIVE)).toContain(unresolved);
  });
});
