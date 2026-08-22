import { describe, expect, test } from '@jest/globals';
import path from 'path';

const jestConfig = require('../../jest.config.js');

function matchesAny(patterns: readonly string[], filePath: string): boolean {
  return patterns.some((pattern) => new RegExp(pattern).test(filePath));
}

describe('Jest worktree discovery', () => {
  test('keeps active-worktree tests discoverable while ignoring nested worktrees for discovery and haste', () => {
    const activeTestPath = path.join(process.cwd(), 'src', 'tests', 'checkpoint-snapshot.test.ts');
    const nestedWorktreePath = path.join(
      process.cwd(),
      '.worktrees',
      'other-branch',
      'src',
      'tests',
      'stale.test.ts'
    );

    expect(matchesAny(jestConfig.testPathIgnorePatterns, activeTestPath)).toBe(false);
    expect(matchesAny(jestConfig.testPathIgnorePatterns, nestedWorktreePath)).toBe(true);
    expect(matchesAny(jestConfig.modulePathIgnorePatterns, activeTestPath)).toBe(false);
    expect(matchesAny(jestConfig.modulePathIgnorePatterns, nestedWorktreePath)).toBe(true);
  });
});
