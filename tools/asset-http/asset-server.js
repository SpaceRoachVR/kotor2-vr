#!/usr/bin/env node
/**
 * Starts the loopback-only browser asset service for a locally installed game.
 *
 * Usage:
 *   node tools/asset-http/asset-server.js --game <retail-dir> --user <user-dir> [--mod <mod-dir> ...] [--dist <dist-dir>] [--port 8479]
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
    modRoots: [],
    discoverModLayers: true,
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
    if (option === '--no-mods') {
      // Measurement runs (the parity tooling, vr:sweep) pass this so results
      // describe retail rather than whatever the player has layered on.
      values.discoverModLayers = false;
      continue;
    }
    if (option === '--mod') {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--mod requires a value');
      values.modRoots.push(path.resolve(value));
      index += 1;
      continue;
    }
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
    modRoots: values.modRoots,
    discoverModLayers: values.discoverModLayers,
  };
}

/**
 * Standing mod layers: every directory in <userRoot>/mods, in name order, which
 * is why they are numbered (01-, 02-, 03-). Later layers win, so a higher
 * number overrides a lower one, and all of them override retail.
 *
 * Explicit --mod roots are applied first so an ad-hoc layer stays below the
 * standing ones rather than silently outranking them.
 */
function discoverModLayers(userRoot) {
  const modsDirectory = path.join(userRoot, 'mods');
  let entries;
  try {
    entries = fs.readdirSync(modsDirectory, { withFileTypes: true });
  } catch (error) {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
    .map((name) => path.join(modsDirectory, name))
    .filter((candidate) => {
      try {
        return fs.statSync(candidate).isDirectory();
      } catch (error) {
        // A junction to a Steam Workshop item disappears when it is
        // unsubscribed; skip it rather than failing the whole launch.
        return false;
      }
    });
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
  const { gameRoot, userRoot, distRoot, port, modRoots, discoverModLayers: discover } =
    parseAssetServerArguments(process.argv.slice(2));
  const layers = discover ? [...modRoots, ...discoverModLayers(userRoot)] : modRoots;
  const token = crypto.randomBytes(32).toString('base64url');
  validateRetailInstallation(gameRoot);
  fs.mkdirSync(userRoot, { recursive: true });
  for (const layer of layers) console.log(`Mod layer: ${layer}`);
  const service = createAssetService({
    assetRoot: gameRoot,
    modRoots: layers,
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

module.exports = { parseAssetServerArguments, discoverModLayers };
