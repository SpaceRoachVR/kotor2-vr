import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, test } from '@jest/globals';

const {
  QA_EVIDENCE_DIRECTORY,
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

  test('reports an environment count without persisting variable names or values', () => {
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
      workspace: { path: '[redacted]', packageManifestPresent: true },
      environment: {
        variableCount: 2,
      },
    });
    expect(JSON.stringify(manifest)).not.toContain('must-not-leak');
    expect(JSON.stringify(manifest)).not.toContain('API_TOKEN');
    expect(JSON.stringify(manifest)).not.toContain('NODE_ENV');
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.environment)).toBe(true);
  });

  test('writes only a new manifest file inside the approved QA evidence directory', () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'kotor2-vr-manifest-'));
    temporaryDirectories.push(temporaryDirectory);
    const evidenceDirectory = path.join(temporaryDirectory, QA_EVIDENCE_DIRECTORY);
    fs.mkdirSync(evidenceDirectory, { recursive: true });
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

    expect(outputPath).toBe(path.join(evidenceDirectory, 'environment.json'));
    expect(output).not.toContain('must-not-leak');
    expect(JSON.parse(output)).toEqual(manifest);
    expect(() => writeManifest('environment.json', manifest, temporaryDirectory)).toThrow(/exist/i);

    for (const invalidPath of [
      '../environment.json',
      '..\\environment.json',
      path.join(temporaryDirectory, 'environment.json'),
      path.join(QA_EVIDENCE_DIRECTORY, 'nested', 'environment.json'),
    ]) {
      expect(() => writeManifest(invalidPath, manifest, temporaryDirectory)).toThrow(/output path/i);
    }
  });
});
