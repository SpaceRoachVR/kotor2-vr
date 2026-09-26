/**
 * Evaluates a script file in the running game page over CDP and prints the
 * result as JSON, without reloading the page.
 *
 *   node tools/vr-emulator/live-eval.js <file.js> [--port 9422] [--timeout 60000]
 *
 * The file's text is evaluated as an expression (wrap it in an IIFE; async is
 * fine, the promise is awaited). Written for headset sessions, where a query
 * against the live engine settles in one shot what source reading cannot, and
 * where shell quoting of an inline script has cost more time than the query.
 */
const fs = require('fs');
const { CdpSession, findPageTarget } = require('./cdp');

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : fallback; };
const PORT = Number(opt('--port', process.env.KOTOR2VR_CDP_PORT || 9422));
const TIMEOUT = Number(opt('--timeout', 60000));

async function main() {
  if (!file) throw new Error('pass a script file');
  const source = fs.readFileSync(file, 'utf8');
  const target = await findPageTarget(PORT, (u) => /\/game\//.test(u));
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl);
  try {
    const result = await cdp.evaluate(source, { timeoutMs: TIMEOUT });
    console.log(JSON.stringify(result, null, 1));
  } finally {
    cdp.close();
  }
}

main().catch((error) => { console.error(error.message || error); process.exit(1); });
