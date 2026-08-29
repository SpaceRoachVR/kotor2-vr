/**
 * Starts the local asset service the browser build loads game data through, and
 * returns its launch URL.
 *
 * Extracted from run-checks.js so the playthrough driver can start one the same
 * way. The launch URL carries a token that cannot be guessed, which is why
 * every tool either starts its own service or is handed the URL with --url.
 */
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ASSET_SERVER = path.join(__dirname, '..', 'asset-http', 'asset-server.js');

/**
 * @param {object} [options]
 * @param {number} [options.port] port for the service. Defaults to the server's
 *   own 8479. Pass one to run a second service alongside a running tool: the
 *   port was previously fixed, so two harness runs could not coexist and the
 *   second died with EADDRINUSE. That single constraint serialised every
 *   emulator-driven session.
 */
function startAssetService(options = {}) {
  const extraArgs = options.port ? ['--port', String(options.port)] : [];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ASSET_SERVER, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let buffered = '';
    const onData = (chunk) => {
      buffered += chunk.toString();
      const match = buffered.match(/Open (http:\/\/\S+)/);
      if (match) {
        child.stdout.off('data', onData);
        resolve({ url: match[1], stop: () => child.kill() });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (chunk) => { buffered += chunk.toString(); });
    child.on('exit', (code) => {
      if (/EADDRINUSE/.test(buffered)) {
        reject(new Error(
          'An asset service is already running on that port. Either stop it, pass its ' +
          'launch URL with --url "<url>" (the token cannot be guessed), or start this ' +
          'one on another port.'
        ));
        return;
      }
      reject(new Error(`asset service exited with code ${code}: ${buffered.slice(-400)}`));
    });
    setTimeout(() => reject(new Error('asset service printed no launch URL')), 20_000);
  });
}

function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { res.resume(); resolve(); })
        .on('error', () => {
          if (Date.now() > deadline) reject(new Error(`asset service never came up on ${port}`));
          else setTimeout(attempt, 250);
        });
    };
    attempt();
  });
}

module.exports = { startAssetService, waitForPort, ASSET_SERVER };
