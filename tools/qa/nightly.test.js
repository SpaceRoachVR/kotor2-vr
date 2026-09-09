/**
 * node --test tools/qa/nightly.test.js
 *
 * The nightly's judgement — what counts as real movement and what is weather —
 * is checked here so it stays verifiable without a two-hour run.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  diffSummaries, renderDelta, codeCounts, diffCodes, renderCodeDelta, readNoiseFloor,
} = require('./nightly');

const NOISE = {
  runs: 5,
  measuredCodes: new Set(['stable-code', 'flaky-code', 'another-stable']),
  flakyCodes: new Map([['flaky-code', 10]]),
  modulesCleanSpread: 8,
  findingsSpread: 18,
};

test('code counts are keyed by code, from the full ranking', () => {
  assert.deepEqual(
    codeCounts([{ code: 'a', moduleCount: 12 }, { code: 'b', moduleCount: 3 }]),
    { a: 12, b: 3 },
  );
  assert.deepEqual(codeCounts(undefined), {});
});

test('a code that did not move is left out entirely', () => {
  const split = diffCodes({ 'stable-code': 12 }, { 'stable-code': 12 }, NOISE);
  assert.equal(split.stable.length, 0);
  assert.equal(split.flaky.length, 0);
});

test('movement in a measured-stable code is reported as real', () => {
  const split = diffCodes({ 'stable-code': 12 }, { 'stable-code': 19 }, NOISE);
  assert.equal(split.flaky.length, 0);
  assert.deepEqual(
    split.stable.map((r) => [r.code, r.was, r.now, r.delta]),
    [['stable-code', 12, 19, 7]],
  );
});

test('movement in a measured-flaky code is quarantined, with its spread', () => {
  const split = diffCodes({ 'flaky-code': 15 }, { 'flaky-code': 25 }, NOISE);
  assert.equal(split.stable.length, 0);
  assert.equal(split.flaky[0].delta, 10);
  assert.equal(split.flaky[0].spread, 10);
});

test('a code the floor never saw is flagged unmeasured rather than assumed stable', () => {
  const split = diffCodes({}, { 'brand-new': 4 }, NOISE);
  assert.equal(split.stable[0].code, 'brand-new');
  assert.equal(split.stable[0].unmeasured, true);
  assert.equal(split.stable[0].was, 0);
  assert.match(renderCodeDelta(split, NOISE), /unmeasured by the noise floor/);
});

test('a code that disappeared counts as movement to zero', () => {
  const split = diffCodes({ 'stable-code': 6 }, {}, NOISE);
  assert.deepEqual(
    split.stable.map((r) => [r.was, r.now, r.delta]),
    [[6, 0, -6]],
  );
});

test('rows sort by absolute movement, so the biggest change reads first', () => {
  const split = diffCodes(
    { 'stable-code': 1, 'another-stable': 10 },
    { 'stable-code': 3, 'another-stable': 0 },
    NOISE,
  );
  assert.deepEqual(split.stable.map((r) => r.code), ['another-stable', 'stable-code']);
});

test('with no noise floor, everything is treated as real and the gap is stated', () => {
  const split = diffCodes({ 'flaky-code': 15 }, { 'flaky-code': 25 }, null);
  assert.equal(split.flaky.length, 0, 'nothing can be excluded without a measurement');
  assert.equal(split.stable.length, 1);
  assert.match(renderCodeDelta(split, null), /no noise floor measured/);
});

test('both sections render even when only one of them has movement', () => {
  const text = renderCodeDelta(diffCodes({ 'stable-code': 1 }, { 'stable-code': 2 }, NOISE), NOISE);
  assert.match(text, /REAL —/);
  assert.match(text, /NOISE —/);
  assert.match(text, /\(no movement\)/);
});

test('readNoiseFloor returns null rather than throwing when none has been taken', () => {
  assert.equal(readNoiseFloor(path.join(os.tmpdir(), 'definitely-not-here.json')), null);
});

test('readNoiseFloor splits measured codes into stable and flaky', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nf-')), 'noise-floor.json');
  fs.writeFileSync(file, JSON.stringify({
    runCount: 5,
    modulesClean: { spread: 8 },
    findings: { spread: 18 },
    codes: [
      { code: 'steady', stable: true, spread: 0 },
      { code: 'jumpy', stable: false, spread: 10 },
    ],
  }));
  const noise = readNoiseFloor(file);
  assert.equal(noise.runs, 5);
  assert.equal(noise.flakyCodes.get('jumpy'), 10);
  assert.equal(noise.flakyCodes.has('steady'), false);
  assert.equal(noise.measuredCodes.has('steady'), true);
});

test('the summary delta still reports totals unchanged when nothing moved', () => {
  const same = { modulesLoaded: 82, modulesClean: 40, modulesBlocked: 0, findings: 60 };
  assert.match(renderDelta(diffSummaries(same, same)), /unchanged/);
  assert.equal(renderDelta(diffSummaries(null, same)), '  (no previous run to compare against)');
});
