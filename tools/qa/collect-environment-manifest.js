#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REDACTED_VALUE = '[redacted]';

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

  const environmentVariables = {};
  for (const name of Object.keys(environment).sort()) {
    environmentVariables[name] = REDACTED_VALUE;
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
      variableCount: Object.keys(environmentVariables).length,
      values: Object.freeze(environmentVariables),
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
  if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
    throw new TypeError('outputPath must be a non-empty string');
  }
  if (typeof workingDirectory !== 'string' || workingDirectory.trim().length === 0) {
    throw new TypeError('workingDirectory must be a non-empty string');
  }

  const resolvedPath = path.resolve(workingDirectory, outputPath);
  const parentDirectory = path.dirname(resolvedPath);
  if (!fs.existsSync(parentDirectory) || !fs.statSync(parentDirectory).isDirectory()) {
    throw new Error(`output directory does not exist: ${parentDirectory}`);
  }
  if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
    throw new Error(`output path is a directory: ${resolvedPath}`);
  }

  fs.writeFileSync(resolvedPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return resolvedPath;
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
  collectEnvironmentManifest,
  main,
  parseArguments,
  writeManifest,
};
