import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

const {
  REDACTED_VALUE,
  collectEnvironmentManifest,
  parseArguments,
  writeManifest,
} = require('../../tools/qa/collect-environment-manifest');

describe('environment manifest collector', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test('redacts every environment value while retaining auditable runtime metadata', () => {
    const manifest = collectEnvironmentManifest({
      environment: {
        API_TOKEN: 'must-not-leak',
        NODE_ENV: 'test',
      },
      now: new Date('2026-08-22T00:00:00.000Z'),
      workingDirectory: process.cwd(),
    });

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      collectedAt: '2026-08-22T00:00:00.000Z',
      workspace: { path: REDACTED_VALUE, packageManifestPresent: true },
      environment: {
        variableCount: 2,
        values: {
          API_TOKEN: REDACTED_VALUE,
          NODE_ENV: REDACTED_VALUE,
        },
      },
    });
    expect(JSON.stringify(manifest)).not.toContain('must-not-leak');
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.environment.values)).toBe(true);
  });

  test('accepts only the documented output option and writes valid redacted JSON', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-vr-manifest-'));
    temporaryDirectories.push(temporaryDirectory);
    const manifest = collectEnvironmentManifest({
      environment: { ACCESS_KEY: 'must-not-leak' },
      now: new Date('2026-08-22T00:00:00.000Z'),
      workingDirectory: temporaryDirectory,
    });

    expect(parseArguments([])).toEqual({ outputPath: null });
    expect(parseArguments(['--output', 'environment.json'])).toEqual({ outputPath: 'environment.json' });
    expect(() => parseArguments(['--unexpected'])).toThrow(/usage/i);

    const outputPath = writeManifest('environment.json', manifest, temporaryDirectory);
    const output = fs.readFileSync(outputPath, 'utf8');

    expect(output).not.toContain('must-not-leak');
    expect(JSON.parse(output)).toEqual(manifest);
  });
});
