/**
 * Exploratory run: load the browser build under the emulated device and report
 * what the page is doing at intervals, so a scenario can be written against
 * real selectors and real timing rather than guesses.
 *
 *   node tools/vr-emulator/explore.js "<launch-url>" [seconds]
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');

(async () => {
  const url = process.argv[2];
  const seconds = Number(process.argv[3] || 180);
  if (!url) throw new Error('usage: explore.js <launch-url> [seconds]');

  const harness = new VrHarness({ port: 9423 });
  const outDir = path.join(__dirname, 'evidence');
  fs.mkdirSync(outDir, { recursive: true });

  await harness.launch(url);
  console.log('launched; emulated device ready');

  const deadline = Date.now() + seconds * 1000;
  let tick = 0;
  while (Date.now() < deadline) {
    tick += 1;
    let snapshot;
    try {
      snapshot = await harness.evaluate(`(() => {
        const btn = document.querySelector('#vr-spike-button');
        const canvases = Array.from(document.querySelectorAll('canvas')).map(c => ({ w: c.width, h: c.height }));
        return {
          url: location.href,
          title: document.title,
          vrButton: btn ? { text: btn.textContent, disabled: btn.disabled } : null,
          canvases,
          bodyTextHead: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 300),
          visibleButtons: Array.from(document.querySelectorAll('button'))
            .filter(b => b.offsetParent !== null)
            .map(b => (b.textContent || '').trim())
            .slice(0, 20),
          hasGameState: typeof window.GameState !== 'undefined',
        };
      })()`);
    } catch (error) {
      snapshot = { evaluateError: error.message };
    }
    console.log(`\n--- t+${tick * 5}s ---`);
    console.log(JSON.stringify(snapshot, null, 2));

    const errors = harness.pageErrors.slice(-3);
    if (errors.length) console.log('pageErrors:', errors);

    await new Promise((r) => setTimeout(r, 5000));
  }

  const consoleDump = harness.consoleMessages
    .map((m) => `[${m.level}] ${m.text}`)
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'explore-console.log'), consoleDump);
  console.log(`\nwrote ${harness.consoleMessages.length} console lines to evidence/explore-console.log`);
  await harness.close();
})().catch((error) => {
  console.error('EXPLORE ERROR', error);
  process.exitCode = 1;
});
