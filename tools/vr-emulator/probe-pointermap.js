/**
 * Ad-hoc probe: where a real mouse click actually lands in GUI space.
 *
 * Established already: for every control in an attribute row, the drawn fill
 * quad and the hit box occupy the identical GUI rectangle (`deltaCentre` 0).
 * So art and box agree, and the remaining candidate is the screen -> GUI
 * pointer mapping — what `Mouse.positionUI` becomes for a given screen pixel.
 *
 * Sweeps real CDP mouse moves across an attribute row and reports, per screen
 * pixel, the resulting `Mouse.positionUI.x` and which control the engine
 * considers hovered. That is exactly the experience being reported, measured
 * rather than inferred from a screenshot.
 *
 *   node tools/vr-emulator/probe-pointermap.js --url "<launch url>"
 */
const { VrHarness } = require('./harness');

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

async function clickGuiControl(harness, menuName, controlName) {
  return harness.evaluate(`(() => {
    const menu = window.KotOR.GameState.MenuManager[${JSON.stringify(menuName)}];
    if (!menu) return 'no menu';
    const c = menu[${JSON.stringify(controlName)}];
    if (!c) return 'no control';
    try { c.onClick ? c.onClick() : c.click(); return 'clicked'; }
    catch (e) { return 'threw: ' + String(e && e.message || e); }
  })()`);
}

async function waitForMenu(harness, menuName, timeoutMs = 60000) {
  return harness.waitFor(
    `(() => { const m = window.KotOR.GameState.MenuManager[${JSON.stringify(menuName)}];
      return !!(m && m.bVisible); })()`, timeoutMs);
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');

  const harness = new VrHarness({ port: 9441 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      await clickButtonByText(harness, 'OK');
    } catch { /* already accepted */ }
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await waitForMenu(harness, 'MainMenu', 240_000);

    await clickGuiControl(harness, 'MainMenu', 'BTN_NEWGAME');
    await waitForMenu(harness, 'CharGenClass');
    await clickGuiControl(harness, 'CharGenClass', 'BTN_SEL3');
    await waitForMenu(harness, 'CharGenQuickOrCustom');
    await clickGuiControl(harness, 'CharGenQuickOrCustom', 'CUST_CHAR_BTN');
    await waitForMenu(harness, 'CharGenCustomPanel');
    await clickGuiControl(harness, 'CharGenCustomPanel', 'BTN_STEPNAME2');
    await new Promise((resolve) => setTimeout(resolve, 3000));
    // Raise Strength once so the minus is not hidden at the floor of 8.
    await clickGuiControl(harness, 'CharGenAbilities', 'STR_PLUS_BTN');
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Optionally resize AFTER the engine has booted. A GUI camera or viewport
    // captured at startup and not rebuilt on resize would scale the rendered
    // art away from the pointer mapping, which is exactly the class of fault
    // that shows as "the box is not over the symbol".
    const resizeArg = argv.includes('--resize') ? argv[argv.indexOf('--resize') + 1] : null;
    if (resizeArg) {
      const [w, h] = resizeArg.split('x').map(Number);
      await harness.cdp.send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: 1, mobile: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }

    // Screen geometry of the canvas, and the GUI-space row to aim at.
    const frame = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const c = gs.canvas;
      const r = c.getBoundingClientRect();
      const m = gs.MenuManager.CharGenAbilities;
      const rowY = m.STR_PLUS_BTN.box ? (m.STR_PLUS_BTN.box.min.y + m.STR_PLUS_BTN.box.max.y)/2 : null;
      return { rectLeft: r.left, rectTop: r.top, rectW: r.width, rectH: r.height,
               canvasW: c.width, canvasH: c.height, devicePixelRatio: window.devicePixelRatio,
               viewW: gs.ResolutionManager.getViewportWidth(), viewH: gs.ResolutionManager.getViewportHeight(),
               rowGuiY: rowY,
               minus: { min: m.STR_MINUS_BTN.box.min.x, max: m.STR_MINUS_BTN.box.max.x },
               plus: { min: m.STR_PLUS_BTN.box.min.x, max: m.STR_PLUS_BTN.box.max.x } };
    })()`);

    // Sweep the row in screen pixels and record what the engine sees.
    const samples = [];
    const screenY = Math.round(frame.rectTop + frame.rectH / 2 - (frame.rowGuiY) * (frame.rectH / frame.viewH));
    for (let sx = Math.round(frame.rectLeft + frame.rectW * 0.40); sx <= Math.round(frame.rectLeft + frame.rectW * 0.56); sx += 3) {
      await harness.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: screenY, buttons: 0 });
      const seen = await harness.evaluate(`(() => {
        const gs = window.KotOR.GameState;
        const Mouse = window.KotOR.Mouse;
        const m = gs.MenuManager.CharGenAbilities;
        const inBox = (c) => !!(c && c.box && Mouse.positionUI
          && Mouse.positionUI.x >= c.box.min.x && Mouse.positionUI.x <= c.box.max.x
          && Mouse.positionUI.y >= c.box.min.y && Mouse.positionUI.y <= c.box.max.y);
        return { uiX: Mouse.positionUI ? +Mouse.positionUI.x.toFixed(1) : null,
                 uiY: Mouse.positionUI ? +Mouse.positionUI.y.toFixed(1) : null,
                 onMinus: inBox(m.STR_MINUS_BTN), onPoints: inBox(m.STR_POINTS_BTN), onPlus: inBox(m.STR_PLUS_BTN) };
      })()`, { timeoutMs: 20000 });
      samples.push({ screenX: sx, ...seen });
    }

    console.log(JSON.stringify({ frame, screenY, samples }, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
