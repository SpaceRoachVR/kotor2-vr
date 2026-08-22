'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_MODULES = Object.freeze(['001ebo', '101per', '102per']);
const RUNTIMES = new Set(['electron', 'chrome']);
const STATUSES = new Set(['resolved', 'missing', 'invalid', 'decode-error']);
const SEMANTICS = new Set([
  'diffuse', 'lightmap', 'normal', 'bump', 'environment', 'gui', 'font', 'particle', 'other',
]);
const VISUAL_CATEGORIES = new Set([
  'doors', 'ui-icons', 'holograms', 'force-fields', 'lightmaps', 'held-models',
]);
const SOURCES = new Set([
  'none', 'override-tga', 'override-tpc', 'active-module',
  'gui-pack', 'texture-pack', 'key-bif',
]);
const RECORD_KEYS = Object.freeze([
  'requestedResref', 'resolvedResref', 'semantic', 'activeModule', 'status',
  'searchedSources', 'selectedSource', 'txiSource', 'fallback',
  'diagnosticCode', 'cacheGeneration', 'aliasEvidence', 'width', 'height', 'sha256',
  'visualCategory', 'required',
]);
const REQUIRED_COVERAGE = Object.freeze([
  Object.freeze({ module: '001ebo', visualCategory: 'doors' }),
  Object.freeze({ module: '001ebo', visualCategory: 'ui-icons' }),
  Object.freeze({ module: '001ebo', visualCategory: 'held-models' }),
  Object.freeze({ module: '101per', visualCategory: 'holograms' }),
  Object.freeze({ module: '101per', visualCategory: 'force-fields' }),
  Object.freeze({ module: '101per', visualCategory: 'lightmaps' }),
  Object.freeze({ module: '102per', visualCategory: 'doors' }),
]);

function createVisualManifest(input) {
  if (!input || typeof input !== 'object' || !RUNTIMES.has(input.runtime)) {
    throw new TypeError('Material visual manifest runtime must be electron or chrome');
  }
  if (!input.modules || typeof input.modules !== 'object' || Array.isArray(input.modules)) {
    throw new TypeError('Material visual manifest requires a module record object');
  }

  const normalizedModules = new Map();
  for (const [moduleName, records] of Object.entries(input.modules)) {
    const normalizedModule = normalizeResref(moduleName);
    if (normalizedModules.has(normalizedModule)) {
      throw new TypeError(`Duplicate material audit module '${normalizedModule}'`);
    }
    if (!Array.isArray(records)) {
      throw new TypeError(`Material audit module '${normalizedModule}' records must be an array`);
    }
    normalizedModules.set(normalizedModule, records);
  }

  const missingModules = REQUIRED_MODULES.filter((moduleName) => !normalizedModules.has(moduleName));
  if (missingModules.length) {
    throw new TypeError(`Material audit is missing required modules: ${missingModules.join(', ')}`);
  }
  const unexpectedModules = [...normalizedModules.keys()].filter(
    (moduleName) => !REQUIRED_MODULES.includes(moduleName),
  );
  if (unexpectedModules.length) {
    throw new TypeError(`Material audit contains unexpected modules: ${unexpectedModules.join(', ')}`);
  }

  const modules = REQUIRED_MODULES.map((moduleName) => Object.freeze({
    module: moduleName,
    records: Object.freeze(normalizedModules.get(moduleName).map((record) => sanitizeRecord(record, moduleName))),
  }));
  validateCoverage(modules);

  return Object.freeze({
    schemaVersion: 1,
    runtime: input.runtime,
    modules: Object.freeze(modules),
  });
}

function sanitizeRecord(record, moduleName) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError(`Material audit '${moduleName}' contains a non-object record`);
  }
  const requestedResref = normalizeResref(record.requestedResref);
  if (!requestedResref) {
    throw new TypeError(`Material audit '${moduleName}' record requires requestedResref`);
  }
  if (!STATUSES.has(record.status) || !SOURCES.has(record.selectedSource)) {
    throw new TypeError(`Material audit '${moduleName}:${requestedResref}' has invalid status or source`);
  }
  if (!SEMANTICS.has(record.semantic)) {
    throw new TypeError(`Material audit '${moduleName}:${requestedResref}' has invalid semantic`);
  }
  if (!VISUAL_CATEGORIES.has(record.visualCategory)) {
    throw new TypeError(`Material audit '${moduleName}:${requestedResref}' has invalid visual category`);
  }
  if (typeof record.required !== 'boolean') {
    throw new TypeError(`Material audit '${moduleName}:${requestedResref}' must explicitly state whether it is required`);
  }
  if (normalizeResref(record.activeModule) !== moduleName) {
    throw new TypeError(`Material audit '${moduleName}:${requestedResref}' has a mismatched active module`);
  }
  if (!Number.isSafeInteger(record.cacheGeneration) || record.cacheGeneration < 1) {
    throw new TypeError(`Material audit '${moduleName}:${requestedResref}' has invalid cache generation`);
  }
  if (!Array.isArray(record.searchedSources) || record.searchedSources.some((source) => !SOURCES.has(source) || source === 'none')) {
    throw new TypeError(`Material audit '${moduleName}:${requestedResref}' has invalid searched sources`);
  }

  validateResolutionMetadata(record, moduleName, requestedResref);

  const sanitized = {};
  for (const key of RECORD_KEYS) {
    if (record[key] !== undefined) {
      sanitized[key] = key === 'requestedResref' || key === 'resolvedResref' || key === 'activeModule' || key === 'fallback'
        ? normalizeResref(record[key])
        : key === 'searchedSources'
          ? Object.freeze([...record[key]])
          : record[key];
    }
  }
  return Object.freeze(sanitized);
}

function validateResolutionMetadata(record, moduleName, requestedResref) {
  const recordName = `Material audit '${moduleName}:${requestedResref}'`;
  const hasDimensions = Number.isSafeInteger(record.width) && record.width > 0
    && Number.isSafeInteger(record.height) && record.height > 0;
  const hasHash = typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(record.sha256);

  if (record.required && record.status !== 'resolved') {
    throw new TypeError(`${recordName} required material did not resolve`);
  }
  if (record.status === 'resolved') {
    if (record.selectedSource === 'none' || !normalizeResref(record.resolvedResref)) {
      throw new TypeError(`${recordName} resolved record is missing source identity`);
    }
    if (!hasDimensions || !hasHash) {
      throw new TypeError(`${recordName} resolved record requires dimensions and sha256 metadata`);
    }
    return;
  }
  if (record.required) {
    throw new TypeError(`${recordName} required material must not be absent`);
  }
  if (typeof record.diagnosticCode !== 'string' || !record.diagnosticCode.trim()) {
    throw new TypeError(`${recordName} absent optional map requires a resolver diagnostic code`);
  }
  if (record.status === 'decode-error') {
    if (record.selectedSource === 'none' || !normalizeResref(record.resolvedResref)) {
      throw new TypeError(`${recordName} decode error requires the attempted source identity`);
    }
    if (hasDimensions || hasHash) {
      throw new TypeError(`${recordName} decode error must not claim decoded metadata`);
    }
    return;
  }
  if (record.selectedSource !== 'none') {
    throw new TypeError(`${recordName} absent optional map must select no source`);
  }
  if (hasDimensions || hasHash || normalizeResref(record.resolvedResref)) {
    throw new TypeError(`${recordName} absent optional map must not claim loaded metadata`);
  }
}

function validateCoverage(modules) {
  for (const requirement of REQUIRED_COVERAGE) {
    const module = modules.find((candidate) => candidate.module === requirement.module);
    const covered = module?.records.some((record) => (
      record.visualCategory === requirement.visualCategory && record.required === true
    ));
    if (!covered) {
      throw new TypeError(`Material audit is missing required visual coverage '${requirement.module}:${requirement.visualCategory}'`);
    }
  }
}

function normalizeResref(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--runtime', '--input', '--output'].includes(flag) || !value) {
      throw new TypeError('usage: visual-manifest.js --runtime <electron|chrome> --input <json> [--output <json>]');
    }
    options[flag.slice(2)] = value;
  }
  if (!options.runtime || !options.input) {
    throw new TypeError('usage: visual-manifest.js --runtime <electron|chrome> --input <json> [--output <json>]');
  }
  return options;
}

function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const inputPath = path.resolve(options.input);
  const parsed = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const manifest = createVisualManifest({
    runtime: options.runtime,
    modules: parsed.modules ?? parsed,
  });
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  if (!options.output) {
    process.stdout.write(json);
    return;
  }
  const outputPath = path.resolve(options.output);
  fs.writeFileSync(outputPath, json, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${outputPath}\n`);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`material-visual-manifest: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = { createVisualManifest, run };
