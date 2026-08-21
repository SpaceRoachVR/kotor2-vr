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
  // Git worktrees live under .worktrees/ inside this repo, so their test files
  // match testMatch too. Left in, every suite runs twice AND the worktree's
  // copies resolve `@/` through moduleNameMapper back to *this* rootDir —
  // running a branch's stale expectations against main's source.
  testPathIgnorePatterns: ['/node_modules/', '/\\.worktrees/'],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true
};