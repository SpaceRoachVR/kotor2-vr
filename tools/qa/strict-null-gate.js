#!/usr/bin/env node
/**
 * Strict-null-check gate for the directories that have been hardened.
 *
 * The engine as a whole cannot turn `strictNullChecks` on — 2339 errors as of
 * 2026-08-30, nearly all of it in `src/module`, `src/managers` and
 * `src/controls`. But the loader and VR code is written in a
 * `?? undefined` / optional-property style that only means anything under
 * strict null checking, and none of it was actually checked.
 *
 * So: `tsconfig.strict.json` compiles the hardened directories with
 * `strictNullChecks: true`, and this script fails only on errors *inside* those
 * directories. Errors reported in files they merely import are expected and
 * ignored — those directories have not been hardened yet.
 *
 * To harden another directory, add it to both `HARDENED` here and the
 * `include` in `tsconfig.strict.json`, then fix what appears. The list only
 * ever grows.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const HARDENED = [
  'src/loaders/',
  'src/vr/',
];

const repoRoot = path.resolve(__dirname, '..', '..');
// Invoke the local tsc directly rather than through npx: `shell: true` on
// Windows is what npx.cmd needs, and it concatenates rather than escapes.
const tsc = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const result = spawnSync(
  process.execPath,
  [tsc, '--noEmit', '-p', 'tsconfig.strict.json'],
  { cwd: repoRoot, encoding: 'utf8' },
);

const output = `${result.stdout || ''}${result.stderr || ''}`;
const isHardened = (line) => HARDENED.some((dir) => line.replace(/\\/g, '/').startsWith(dir));
const failures = output
  .split(/\r?\n/)
  .filter((line) => line.includes('error TS'))
  .filter(isHardened);

if (failures.length) {
  console.error(`strict-null gate: ${failures.length} error(s) in hardened directories\n`);
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(`\nHardened: ${HARDENED.join(', ')}`);
  process.exit(1);
}

// A tsc that failed to run at all reports nothing to filter, which would pass
// silently. Distinguish that from a clean compile.
if (result.error || (result.status !== 0 && !output.includes('error TS'))) {
  console.error('strict-null gate: tsc did not run');
  console.error(output || result.error);
  process.exit(1);
}

console.log(`strict-null gate: clean across ${HARDENED.join(', ')}`);
