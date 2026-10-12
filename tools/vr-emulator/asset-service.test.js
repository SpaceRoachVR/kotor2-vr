const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildAssetServiceArgs } = require('./asset-service');

test('isolated browser services keep their writable root as a single CLI argument', () => {
  const root = path.resolve('evidence', 'isolated user data');
  assert.deepEqual(buildAssetServiceArgs({port:8480,userRoot:root}), ['--no-mods','--port','8480','--user',root]);
  assert.deepEqual(buildAssetServiceArgs(), ['--no-mods']);
});

test('invalid isolation settings fail before spawning a service', () => {
  for (const port of [0, -1, 65536, 1.5, NaN, '8480']) assert.throws(() => buildAssetServiceArgs({port}), /port/);
  for (const userRoot of ['', 'relative/path', null, 42]) assert.throws(() => buildAssetServiceArgs({userRoot}), /absolute path/);
  for (const options of [null, []]) assert.throws(() => buildAssetServiceArgs(options), /options/);
});
