import * as path from 'path';
import { describe, expect, test } from '@jest/globals';

const { parseAssetServerArguments } = require('../../tools/asset-http/asset-server');

describe('asset-server CLI parsing', () => {
  const defaults = {
    gameRoot: 'C:\\game',
    userRoot: 'C:\\user',
    distRoot: 'C:\\dist',
    port: 8479,
  };

  test('parses each supported flag exactly once', () => {
    const result = parseAssetServerArguments([
      '--game', 'custom-game',
      '--user', 'custom-user',
      '--dist', 'custom-dist',
      '--port', '9000',
    ], defaults);

    expect(result).toEqual({
      gameRoot: path.resolve('custom-game'),
      userRoot: path.resolve('custom-user'),
      distRoot: path.resolve('custom-dist'),
      port: 9000,
    });
  });

  test.each([
    ['--unknown', 'value'],
    ['--game', 'one', '--game', 'two'],
    ['--port'],
    ['--port', 'not-a-port'],
  ])('rejects unknown, duplicate, and malformed arguments: %s', (...argumentsList: string[]) => {
    expect(() => parseAssetServerArguments(argumentsList, defaults)).toThrow();
  });
});
