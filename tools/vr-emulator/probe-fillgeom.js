/**
 * Ad-hoc probe: where the `+`/`-` icons are actually DRAWN, versus the hit box.
 *
 * The hit boxes were measured exactly: `box.min = authoredLeft - 400`, width =
 * authored width, box centre == widget world position, for every control in the
 * row. So the boxes are where the GUI file puts them.
 *
 * Manual testing reports that a `-` only fires when clicked right of its icon
 * and a `+` only when clicked left of its icon — both boxes displaced *outward*
 * relative to the drawn art. Since the boxes are authored-correct, the drawn
 * quad must be the thing that is offset. This measures the fill mesh directly
 * rather than estimating it from a screenshot, which is what I got wrong before.
 *
 *   node tools/vr-emulator/probe-fillgeom.js --url "<launch url>"
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

/** Fill-mesh world extent vs hit box, for one control. */
const MEASURE = `(function measure(menuName, controlName){
  const gs = window.KotOR.GameState;
  const menu = gs.MenuManager[menuName];
  const c = menu && menu[controlName];
  if (!c) return { control: controlName, missing: true };
  const out = { control: controlName, visible: !!(c.widget && c.widget.visible) };
  if (c.box) { out.hitMinX = +c.box.min.x.toFixed(2); out.hitMaxX = +c.box.max.x.toFixed(2);
               out.hitCentreX = +((c.box.min.x + c.box.max.x)/2).toFixed(2); }
  try {
    const fill = c.getFill();
    fill.updateWorldMatrix(true, false);
    const p = fill.matrixWorld.elements;
    const worldX = p[12], worldY = p[13];
    const g = fill.geometry;
    const w = (g.parameters && g.parameters.width) || null;
    const sx = fill.scale.x, msx = Math.hypot(p[0], p[1], p[2]);
    const drawnW = w !== null ? w * msx : null;
    out.fillWorldX = +worldX.toFixed(2);
    out.fillWorldY = +worldY.toFixed(2);
    out.fillGeomW = w;
    out.fillScaleX = +sx.toFixed(3);
    out.fillWorldScaleX = +msx.toFixed(3);
    out.drawnMinX = drawnW !== null ? +(worldX - drawnW/2).toFixed(2) : null;
    out.drawnMaxX = drawnW !== null ? +(worldX + drawnW/2).toFixed(2) : null;
    out.deltaCentre = out.hitCentreX !== undefined ? +(out.hitCentreX - worldX).toFixed(2) : null;
  } catch (e) { out.fillError = String(e && e.message || e); }
  return out;
})`;

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');

  const harness = new VrHarness({ port: 9440 });
  const measure = async (menu, control) =>
    harness.evaluate(`${MEASURE}(${JSON.stringify(menu)}, ${JSON.stringify(control)})`, { timeoutMs: 30000 });

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

    const before = { plus: await measure('CharGenAbilities', 'STR_PLUS_BTN'),
                     minus: await measure('CharGenAbilities', 'STR_MINUS_BTN'),
                     points: await measure('CharGenAbilities', 'STR_POINTS_BTN') };

    // Raise Strength so the minus stops being hidden at the floor of 8.
    await clickGuiControl(harness, 'CharGenAbilities', 'STR_PLUS_BTN');
    await new Promise((resolve) => setTimeout(resolve, 1200));

    const after = { plus: await measure('CharGenAbilities', 'STR_PLUS_BTN'),
                    minus: await measure('CharGenAbilities', 'STR_MINUS_BTN') };

    console.log(JSON.stringify({ before, after }, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
