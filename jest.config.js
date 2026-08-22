const path = require('path');

function escapeRegularExpression(value) {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');
}

// The active checkout may itself live inside a parent .worktrees directory.
// Anchor this pattern to the active root so only worktrees nested *inside*
// this checkout are excluded from Jest discovery and the Haste file map.
const nestedWorktreePattern = `${escapeRegularExpression(path.resolve(__dirname))}[\\\\/]\\.worktrees[\\\\/]`;

/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    "^.+.ts?$": ["ts-jest", {}],
  },
  testMatch: ['**/*.test.ts'],
  // Git worktrees nested inside this checkout match testMatch too. Excluding
  // them prevents duplicate suites and stale expectations from contaminating
  // this branch, without excluding an active checkout located under a parent
  // .worktrees directory.
  testPathIgnorePatterns: ['/node_modules/', nestedWorktreePattern],
  // Jest builds its Haste map from modulePathIgnorePatterns. Keep nested
  // worktrees out of the map as well as test discovery.
  modulePathIgnorePatterns: [nestedWorktreePattern],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true
};
