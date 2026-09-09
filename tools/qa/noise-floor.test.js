/**
 * node --test tools/qa/noise-floor.test.js
 *
 * The aggregation decides what a measurement run MEANS, so it is checked
 * against hand-built runs rather than waiting on three hours of sweeping.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { fingerprint, analyzeRuns, renderReport, parseArgs } = require('./noise-floor');

const clean = (module) => ({ module, findings: [] });
const withCodes = (module, ...codes) => ({
  module,
  findings: codes.map((code) => ({ code, severity: 'major', subject: module, detail: 'x' })),
});

test('a module with no findings fingerprints as clean', () => {
  assert.equal(fingerprint(clean('101PER')), '(clean)');
});

test('fingerprints are order-independent but count-sensitive', () => {
  assert.equal(fingerprint(withCodes('X', 'b', 'a')), fingerprint(withCodes('X', 'a', 'b')));
  assert.notEqual(fingerprint(withCodes('X', 'a')), fingerprint(withCodes('X', 'a', 'a')));
  assert.equal(fingerprint(withCodes('X', 'a', 'a')), 'a×2');
});

test('identical runs report a zero noise floor', () => {
  const run = [clean('A'), withCodes('B', 'console-error:x')];
  const out = analyzeRuns([run, run, run]);
  assert.equal(out.stableModules, 2);
  assert.equal(out.flakyModules.length, 0);
  assert.equal(out.modulesClean.spread, 0);
  assert.equal(out.findings.spread, 0);
  assert.equal(out.unstableCodes.length, 0);
});

test('a module that flips between clean and dirty is named, with both variants', () => {
  const out = analyzeRuns([
    [clean('A'), withCodes('B', 'console-error:x')],
    [clean('A'), clean('B')],
  ]);
  assert.equal(out.stableModules, 1);
  assert.deepEqual(out.flakyModules.map((m) => m.module), ['B']);
  assert.deepEqual(out.flakyModules[0].variants.sort(), ['(clean)', 'console-error:x']);
  assert.equal(out.modulesClean.spread, 1);
  assert.equal(out.findings.spread, 1);
});

test('a module dirty in every run but with different codes still counts as varied', () => {
  const out = analyzeRuns([
    [withCodes('B', 'console-error:x')],
    [withCodes('B', 'console-error:y')],
  ]);
  assert.equal(out.stableModules, 0);
  // Clean counts match, so only a fingerprint comparison catches this.
  assert.equal(out.modulesClean.spread, 0);
  assert.equal(out.unstableCodes.length, 2);
});

test('codes sort by spread so the least trustworthy signal reads first', () => {
  const out = analyzeRuns([
    [withCodes('A', 'steady'), withCodes('B', 'steady', 'jumpy')],
    [withCodes('A', 'steady'), withCodes('B', 'steady')],
  ]);
  assert.equal(out.codes[0].code, 'jumpy');
  assert.equal(out.codes[0].spread, 1);
  assert.equal(out.codes[1].code, 'steady');
  assert.equal(out.codes[1].spread, 0);
});

test('a module absent from one run is a variant, not a crash', () => {
  const out = analyzeRuns([[clean('A'), clean('B')], [clean('A')]]);
  assert.equal(out.moduleCount, 2);
  assert.ok(out.flakyModules.some((m) => m.variants.includes('(absent)')));
});

test('the report states the threshold a delta must clear', () => {
  const text = renderReport(analyzeRuns([
    [clean('A'), withCodes('B', 'x')],
    [clean('A'), clean('B')],
  ]));
  assert.match(text, /READ A DELTA AS NOISE UNLESS IT EXCEEDS: 1 clean modules, 1 findings/);
});

test('one run is refused, because one run measures nothing', () => {
  assert.throws(() => parseArgs(['--runs', '1']), /at least 2/);
  assert.throws(() => analyzeRuns([[clean('A')]]), /at least two runs/);
});
