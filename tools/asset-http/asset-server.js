#!/usr/bin/env node
/**
 * Starts the loopback-only browser asset service for a locally installed game.
 *
 * Usage:
 *   node tools/asset-http/asset-server.js --game <retail-dir> --user <user-dir> [--dist <dist-dir>] [--port 8479]
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createAssetService } = require('./asset-service');

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error('--port must be an integer between 0 and 65535');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('--port must be an integer between 0 and 65535');
  }
  return port;
}

function parseAssetServerArguments(argumentsList, defaults = getDefaultOptions()) {
  if (!Array.isArray(argumentsList)) throw new TypeError('argumentsList must be an array');
  const values = {
    gameRoot: defaults.gameRoot,
    userRoot: defaults.userRoot,
    distRoot: defaults.distRoot,
    port: defaults.port,
  };
  const optionToProperty = {
    '--game': 'gameRoot',
    '--user': 'userRoot',
    '--dist': 'distRoot',
    '--port': 'port',
  };
  const seenOptions = new Set();

  for (let index = 0; index < argumentsList.length; index += 1) {
    const option = argumentsList[index];
    const property = optionToProperty[option];
    if (!property) throw new Error(`Unknown option: ${option}`);
    if (seenOptions.has(option)) throw new Error(`Duplicate option: ${option}`);
    const value = argumentsList[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    values[property] = property === 'port' ? parsePort(value) : path.resolve(value);
    seenOptions.add(option);
    index += 1;
  }

  return {
    gameRoot: path.resolve(values.gameRoot),
    userRoot: path.resolve(values.userRoot),
    distRoot: path.resolve(values.distRoot),
    port: parsePort(String(values.port)),
  };
}

function getDefaultOptions() {
  return {
    gameRoot: 'D:\\SteamLibrary\\steamapps\\common\\Knights of the Old Republic II',
    userRoot: path.join(process.env.LOCALAPPDATA || process.cwd(), 'Kotor2VR'),
    distRoot: path.join(__dirname, '..', '..', 'dist'),
    port: 8479,
  };
}

function validateRetailInstallation(gameRoot) {
  const keyPath = path.join(gameRoot, 'chitin.key');
  try {
    if (!fs.statSync(keyPath).isFile()) throw new Error('not a file');
  } catch (error) {
    throw new Error(`Retail KOTOR II installation is missing chitin.key: ${keyPath}`);
  }
}

async function main() {
  const { gameRoot, userRoot, distRoot, port } = parseAssetServerArguments(process.argv.slice(2));
  const token = crypto.randomBytes(32).toString('base64url');
  validateRetailInstallation(gameRoot);
  fs.mkdirSync(userRoot, { recursive: true });
  const service = createAssetService({
    assetRoot: gameRoot,
    userRoot,
    distRoot,
    token,
    host: '127.0.0.1',
    port,
    version: 'dev',
  });
  await service.start();

  const launchUrl = `${service.baseUrl}/launch?token=${encodeURIComponent(token)}`;
  console.log(`Asset service listening on ${service.baseUrl}`);
  console.log(`Open ${launchUrl}`);

  const close = async () => {
    try {
      await service.close();
      process.exitCode = 0;
    } catch (error) {
      console.error('Failed to stop asset service:', error.message);
      process.exitCode = 1;
    }
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Unable to start asset service: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { parseAssetServerArguments };
