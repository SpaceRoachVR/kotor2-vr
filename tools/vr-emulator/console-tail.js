/**
 * Appends the game page's console and exceptions to a file, with elapsed
 * seconds, and follows the page across reloads.
 *
 *   node tools/vr-emulator/console-tail.js <out.log> [--port 9422]
 *
 * A headset round reloads the page for every stop, and a freeze is only
 * explainable from what the console said before it. Arguments are formatted
 * with value ?? description ?? type, never JSON.stringify: stringify runs
 * THREE's Texture.toJSON, which warns on every texture it cannot encode.
 */
const fs = require('fs');
const { CdpSession, findPageTarget } = require('./cdp');

const argv = process.argv.slice(2);
const out = argv.find((a) => !a.startsWith('--'));
const portAt = argv.indexOf('--port');
const PORT = Number(portAt > -1 ? argv[portAt + 1] : process.env.KOTOR2VR_CDP_PORT || 9422);
if (!out) { console.error('usage: console-tail.js <out.log> [--port 9422]'); process.exit(2); }

const started = Date.now();
const write = (text) => fs.appendFileSync(out, `${((Date.now() - started) / 1000).toFixed(1).padStart(8)} ${text}\n`);
const format = (args) => (args || []).map((a) => (a.value ?? a.description ?? a.type)).join(' ');

async function main() {
  const target = await findPageTarget(PORT, (u) => /\/game\//.test(u));
  const cdp = await CdpSession.connect(target.webSocketDebuggerUrl);
  write(`ATTACH ${target.url}`);
  // The inspector keeps every logged argument alive for later inspection, so a
  // log line that passes an object (engine code does) holds it - a destroyed
  // door, its model - for as long as the recorder is attached (ROADMAP 0.3).
  // The text is already written; let the inspector drop the objects.
  let sinceDiscard = 0;
  cdp.on('Runtime.consoleAPICalled', (p) => {
    write(`${p.type.toUpperCase().padEnd(7)} ${format(p.args)}`);
    if (++sinceDiscard >= 100) {
      sinceDiscard = 0;
      cdp.send('Runtime.discardConsoleEntries').catch(() => {});
    }
  });
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails || {};
    write(`EXCEPT  ${(d.exception && d.exception.description) || d.text}`);
  });
  cdp.on('Log.entryAdded', (p) => write(`LOG.${p.entry.level.toUpperCase()} ${p.entry.text} ${p.entry.url || ''}`));
  cdp.on('Page.frameNavigated', (p) => { if (!p.frame.parentId) write(`NAVIGATED ${p.frame.url}`); });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await new Promise(() => {});
}

main().catch((e) => { write(`TAILER ERROR ${e.message || e}`); process.exit(1); });
