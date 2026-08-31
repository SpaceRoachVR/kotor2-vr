/**
 * Ad-hoc probe: which screen pixels actually WORK for `-` and `+`.
 *
 * Everything measured so far — hit box vs authored extent, fill quad vs hit
 * box, pointer mapping vs box — is mutually consistent, yet manual testing
 * reports the working area is offset from the drawn art. Box containment is not
 * the same question as "which control receives the click", so this dispatches
 * real clicks across the row and records what the attribute value did.
 *
 * That is the user's actual experience, measured: the range of screen pixels
 * that decrements, the range that increments, and any dead band between them.
 *
 *   node tools/vr-emulator/probe-clicksweep.js --url "<launch url>"
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

const STR = `window.KotOR.GameState.CharGenManager.str`;

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');

  const harness = new VrHarness({ port: 9442 });
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

    // Lift Strength off its floor of 8 so both directions are available.
    for (let i = 0; i < 3; i++) await clickGuiControl(harness, 'CharGenAbilities', 'STR_PLUS_BTN');
    await new Promise((resolve) => setTimeout(resolve, 800));

    const frame = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const r = gs.canvas.getBoundingClientRect();
      const m = gs.MenuManager.CharGenAbilities;
      const b = (c) => c && c.box ? { min: c.box.min.x, max: c.box.max.x } : null;
      return { rectLeft: r.left, rectTop: r.top, rectW: r.width, rectH: r.height,
               viewH: gs.ResolutionManager.getViewportHeight(),
               rowGuiY: (m.STR_PLUS_BTN.box.min.y + m.STR_PLUS_BTN.box.max.y)/2,
               minus: b(m.STR_MINUS_BTN), points: b(m.STR_POINTS_BTN), plus: b(m.STR_PLUS_BTN),
               str: gs.CharGenManager.str };
    })()`);

    const screenY = Math.round(frame.rectTop + frame.rectH / 2 - frame.rowGuiY * (frame.rectH / frame.viewH));
    const centre = frame.rectLeft + frame.rectW / 2;
    const results = [];
    for (let gui = frame.minus.min - 12; gui <= frame.plus.max + 12; gui += 2) {
      const sx = Math.round(centre + gui);
      const before = await harness.evaluate(STR);
      await harness.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: screenY, buttons: 0 });
      for (const type of ['mousePressed', 'mouseReleased']) {
        await harness.cdp.send('Input.dispatchMouseEvent', {
          type, x: sx, y: screenY, button: 'left', clickCount: 1,
          buttons: type === 'mousePressed' ? 1 : 0,
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 90));
      const after = await harness.evaluate(STR);
      const delta = after - before;
      results.push({ guiX: gui, screenX: sx, delta });
      // Put it back so the sweep does not drift into a bound.
      if (delta > 0) await clickGuiControl(harness, 'CharGenAbilities', 'STR_MINUS_BTN');
      else if (delta < 0) await clickGuiControl(harness, 'CharGenAbilities', 'STR_PLUS_BTN');
    }

    const span = (want) => {
      const hit = results.filter(r => Math.sign(r.delta) === want).map(r => r.guiX);
      return hit.length ? { fromGuiX: Math.min(...hit), toGuiX: Math.max(...hit) } : null;
    };
    console.log(JSON.stringify({
      boxes: { minus: frame.minus, points: frame.points, plus: frame.plus },
      decrementsAt: span(-1),
      incrementsAt: span(1),
      deadPixels: results.filter(r => r.delta === 0).map(r => r.guiX),
    }, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
