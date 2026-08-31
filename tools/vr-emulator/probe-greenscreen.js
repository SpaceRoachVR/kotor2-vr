/**
 * Ad-hoc probe: is the flat-green screen caused by the WebGL 2 context?
 *
 * `GameMenu` draws a background-void sprite tinted RGB(0.102, 0.698, 0.549) —
 * green-teal — behind a `transparent` background material. A flat green screen
 * therefore means the background texture never reached the material, and the
 * void is all that is left to draw.
 *
 * This boots the real build twice, once per context version, screenshots the
 * main menu, and reports how much of the frame is that exact void colour. It
 * measures the rendered image rather than the loader's opinion of itself,
 * because every resolution-level check has already come back clean.
 *
 *   node tools/vr-emulator/probe-greenscreen.js --url "<launch url>"
 */
const { VrHarness } = require('./harness');

const VOID_RGB = [0.10196078568697, 0.69803923368454, 0.549019634723663]
  .map((channel) => Math.round(channel * 255));

async function clickButtonByText(harness, text) {
  const box = await harness.evaluate(`(() => {
    const wanted = ${JSON.stringify(text)}.toLowerCase();
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btn = Array.from(document.querySelectorAll('button')).filter(visible)
      .find(b => (b.textContent || '').trim().toLowerCase() === wanted);
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) throw new Error(`No visible button labelled "${text}"`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await harness.cdp.send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
      buttons: type === 'mousePressed' ? 1 : 0,
    });
  }
}

async function measure(url, port, mode) {
  const harness = new VrHarness({ port });
  try {
    // /launch redirects to a fixed game URL, so a query parameter added here
    // is discarded. Set the option in localStorage and reload instead — the
    // context version is chosen at boot, so it has to be in place beforehand.
    await harness.launch(url);
    // `default` clears the override so the build's own default is exercised —
    // which is the thing to confirm after changing that default.
    await harness.evaluate(mode === 'default'
      ? `localStorage.removeItem('kotor2vr.gl')`
      : `localStorage.setItem('kotor2vr.gl', ${JSON.stringify(mode)})`);
    await harness.cdp.send('Page.reload', {});
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // The EULA may already be accepted after the reload.
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
        20_000,
      );
      await clickButtonByText(harness, 'OK');
    } catch { /* already past it */ }
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);
    // Let the menu settle and its textures land.
    await new Promise((resolve) => setTimeout(resolve, 8000));

    // `preserveDrawingBuffer` is false, so reading the drawing buffer outside
    // the render callback returns a cleared one — it reports black regardless
    // of what was drawn. Page.captureScreenshot composites what the browser is
    // actually showing, which is the thing in question.
    const shot = await harness.cdp.send('Page.captureScreenshot', { format: 'png' });
    require('fs').writeFileSync(
      require('path').join(__dirname, 'evidence', `greenscreen-${mode}.png`),
      Buffer.from(shot.data, 'base64'),
    );
    return { mode, saved: `evidence/greenscreen-${mode}.png`,
             context: await harness.evaluate('window.KotOR.GameState.rendererContextMode') };
  } finally {
    await harness.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');

  const requested = argv.includes('--modes')
    ? argv[argv.indexOf('--modes') + 1].split(',')
    : ['webgl2', 'webgl1'];
  const ports = { webgl2: 9432, webgl1: 9433, default: 9435 };
  for (const mode of requested) {
    const port = ports[mode] || 9436;
    try {
      console.log(mode, JSON.stringify(await measure(url, port, mode)));
    } catch (error) {
      console.log(mode, 'FAILED', String(error && error.message || error));
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
