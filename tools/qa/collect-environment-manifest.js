#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REDACTED_VALUE = '[redacted]';
const QA_EVIDENCE_DIRECTORY = path.join('tools', 'qa', 'evidence');

function collectEnvironmentManifest(options = {}) {
  const environment = options.environment ?? process.env;
  const now = options.now ?? new Date();
  const workingDirectory = options.workingDirectory ?? process.cwd();

  if (!isRecord(environment)) {
    throw new TypeError('environment must be an object');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('now must be a valid Date');
  }
  if (typeof workingDirectory !== 'string' || workingDirectory.trim().length === 0) {
    throw new TypeError('workingDirectory must be a non-empty string');
  }

  return Object.freeze({
    schemaVersion: 1,
    collectedAt: now.toISOString(),
    runtime: Object.freeze({
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
    }),
    workspace: Object.freeze({
      path: REDACTED_VALUE,
      packageManifestPresent: fs.existsSync(path.join(workingDirectory, 'package.json')),
    }),
    environment: Object.freeze({
      variableCount: Object.keys(environment).length,
    }),
  });
}

function parseArguments(args) {
  if (!Array.isArray(args)) {
    throw new TypeError('args must be an array');
  }
  if (args.length === 0) {
    return { outputPath: null };
  }
  if (args.length !== 2 || args[0] !== '--output' || typeof args[1] !== 'string' || args[1].trim().length === 0) {
    throw new TypeError('usage: collect-environment-manifest.js [--output <path>]');
  }
  return { outputPath: args[1] };
}

function writeManifest(outputPath, manifest, workingDirectory = process.cwd()) {
  const outputFileName = validateOutputFileName(outputPath);
  if (typeof workingDirectory !== 'string' || workingDirectory.trim().length === 0) {
    throw new TypeError('workingDirectory must be a non-empty string');
  }

  const evidenceDirectory = path.resolve(workingDirectory, QA_EVIDENCE_DIRECTORY);
  if (!fs.existsSync(evidenceDirectory) || !fs.statSync(evidenceDirectory).isDirectory()) {
    throw new Error(`approved QA evidence directory does not exist: ${evidenceDirectory}`);
  }

  const resolvedPath = path.resolve(evidenceDirectory, outputFileName);
  if (fs.existsSync(resolvedPath)) {
    throw new Error(`output path already exists: ${resolvedPath}`);
  }

  fs.writeFileSync(resolvedPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return resolvedPath;
}

function validateOutputFileName(outputPath) {
  if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
    throw new TypeError('output path must be a non-empty file name');
  }
  if (path.isAbsolute(outputPath) || path.win32.isAbsolute(outputPath) || path.posix.isAbsolute(outputPath)) {
    throw new TypeError('output path must be relative to the approved QA evidence directory');
  }

  const pathSegments = outputPath.split(/[\\/]+/);
  if (pathSegments.length !== 1 || pathSegments[0] === '.' || pathSegments[0] === '..') {
    throw new TypeError('output path must name a file directly under the approved QA evidence directory');
  }
  return pathSegments[0];
}

function main(args = process.argv.slice(2)) {
  const { outputPath } = parseArguments(args);
  const manifest = collectEnvironmentManifest();
  if (outputPath === null) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${writeManifest(outputPath, manifest)}\n`);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`collect-environment-manifest: ${message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  REDACTED_VALUE,
  QA_EVIDENCE_DIRECTORY,
  collectEnvironmentManifest,
  main,
  parseArguments,
  writeManifest,
};
