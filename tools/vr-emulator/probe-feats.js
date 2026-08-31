/**
 * Ad-hoc probe: the custom-character Feats screen.
 *
 * Reported from manual testing: missing materials, no hover descriptions in the
 * right-hand panel, and no feat selectable. Those three together look less like
 * three faults than like one throw part-way through building the screen —
 * partial render, no handlers wired, no hover.
 *
 * Drives MainMenu -> New Game -> class -> Custom -> Feats and reports the
 * console, the feat list state, and a screenshot.
 *
 *   node tools/vr-emulator/probe-feats.js --url "<launch url>"
 */
const fs = require('fs');
const path = require('path');
const { VrHarness } = require('./harness');

const EVIDENCE = path.join(__dirname, 'evidence');

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

/** Click a GUI control by driving the engine's own widget, as the menus expect. */
async function clickGuiControl(harness, menuName, controlName) {
  return harness.evaluate(`(() => {
    const menu = window.KotOR.GameState.MenuManager[${JSON.stringify(menuName)}];
    if (!menu) return 'no menu ' + ${JSON.stringify(menuName)};
    const control = menu[${JSON.stringify(controlName)}];
    if (!control) return 'no control ' + ${JSON.stringify(controlName)};
    try { control.onClick ? control.onClick() : control.click(); return 'clicked'; }
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

  const harness = new VrHarness({ port: 9438 });
  const trail = [];
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      await clickButtonByText(harness, 'OK');
    } catch { /* already accepted */ }
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await waitForMenu(harness, 'MainMenu', 240_000);

    trail.push(['MainMenu.BTN_NEWGAME', await clickGuiControl(harness, 'MainMenu', 'BTN_NEWGAME')]);
    await waitForMenu(harness, 'CharGenClass');
    trail.push(['CharGenClass.BTN_SEL3', await clickGuiControl(harness, 'CharGenClass', 'BTN_SEL3')]);
    await waitForMenu(harness, 'CharGenQuickOrCustom');
    trail.push(['CUST_CHAR_BTN', await clickGuiControl(harness, 'CharGenQuickOrCustom', 'CUST_CHAR_BTN')]);
    await waitForMenu(harness, 'CharGenCustomPanel');

    // Feats is step 4 on the TSL custom panel.
    trail.push(['CustomPanel.BTN_STEPNAME4', await clickGuiControl(harness, 'CharGenCustomPanel', 'BTN_STEPNAME4')]);
    await new Promise((resolve) => setTimeout(resolve, 4000));

    const report = await harness.evaluate(`(() => {
      const gs = window.KotOR.GameState;
      const feats = gs.MenuManager.CharGenFeats;
      const log = window.__xrHarness.log;
      const errors = log.filter(e => e.level === 'error').map(e => e.text.split('\\n')[0].slice(0, 240));
      const warns = log.filter(e => e.level === 'warning' || e.level === 'warn')
        .map(e => e.text.split('\\n')[0].slice(0, 200));
      const counts = {};
      for (const w of warns) { const k = w.replace(/[0-9a-f]{6,}/g, '#'); counts[k] = (counts[k]||0)+1; }
      // The icons render as the magenta diagnostic checker, so ask the router
      // why: status, which sources it searched, and the diagnostic code.
      const all = window.KotOR.TextureLoader.getDiagnostics() || [];
      const byRef = {};
      for (const d of all) {
        if (d.status === 'resolved') continue;
        const k = d.requestedResref + ' [' + d.semantic + '/' + d.status + '/' + (d.diagnosticCode||'') + ']';
        byRef[k] = (byRef[k] || 0) + 1;
      }
      const diags = Object.entries(byRef).sort((a,b)=>b[1]-a[1]).slice(0,25);
      const resolvedGui = (window.KotOR.TextureLoader.getDiagnostics() || [])
        .filter(d => d.status === 'resolved' && d.semantic === 'gui')
        .slice(-6)
        .map(d => ({ resref: d.requestedResref, source: d.selectedSource, layer: d.sourceLayerId }));
      const list = feats && (feats.LB_DESC || feats.LB_FEATS);
      return {
        visibleMenu: gs.MenuManager.GetForegroundMenu?.()?.constructor?.name ?? null,
        featsMenuPresent: !!feats,
        featsVisible: !!(feats && feats.bVisible),
        featListChildren: feats && feats.LB_FEATS ? (feats.LB_FEATS.children?.length ?? null) : null,
        selectedFeat: feats ? (feats.selectedFeat ?? null) : null,
        unresolved: diags,
        resolvedGuiSample: resolvedGui,
        errors: errors.slice(-25),
        topWarnings: Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,15),
      };
    })()`, { timeoutMs: 60000 });

    const shot = await harness.cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(EVIDENCE, 'feats-screen.png'), Buffer.from(shot.data, 'base64'));

    console.log(JSON.stringify({ trail, ...report, shot: 'evidence/feats-screen.png' }, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
