/**
 * Ad-hoc probe: the `+`/`-` hit boxes on the chargen Abilities screen.
 *
 * Reported from manual testing: every `-` box sits too far right and every `+`
 * box too far left, by the same distance. That is not a uniform translation —
 * the two move *toward each other* — so it is not the pointer mapping, which
 * would drag every control the same way, and not the VR hit padding, which is
 * zero on flatscreen and grows symmetrically besides.
 *
 * Dumps, per control: the hit box the engine tests against, the widget's world
 * position, and the authored extent. If the box centre and the world position
 * disagree, `updateBounds` is at fault. If they agree, the box is right and the
 * drawn symbol is somewhere else.
 *
 *   node tools/vr-emulator/probe-hitbox.js --url "<launch url>"
 */
const fs = require('fs');
const path = require('path');
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

  const harness = new VrHarness({ port: 9439 });
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
    // Step 2 is Attributes on the TSL custom panel.
    await clickGuiControl(harness, 'CharGenCustomPanel', 'BTN_STEPNAME2');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const report = await harness.evaluate(`(() => {
      let out_detail = null;
      const gs = window.KotOR.GameState;
      const THREE = window.KotOR.THREE || undefined;
      const menu =
        (gs.MenuManager.CharGenAbilities && gs.MenuManager.CharGenAbilities.bVisible && gs.MenuManager.CharGenAbilities) ||
        gs.MenuManager.GetForegroundMenu?.();
      if (!menu) return { error: 'no foreground menu' };

      const rows = [];
      const walk = (control, depth) => {
        if (!control || depth > 3) return;
        for (const child of (control.children || [])) {
          const name = child.name || (child.control && child.control.name) || '?';
          const box = child.box;
          let world = null;
          try {
            const v = new (child.widget.position.constructor)();
            child.widget.getWorldPosition(v);
            world = { x: +v.x.toFixed(2), y: +v.y.toFixed(2) };
          } catch (e) { world = 'err ' + String(e && e.message); }
          rows.push({
            name,
            clickable: !!(child.isClickable && child.isClickable()),
            allowClick: !!child.allowClick,
            boxMinX: box ? +box.min.x.toFixed(2) : null,
            boxMaxX: box ? +box.max.x.toFixed(2) : null,
            boxCentreX: box ? +(((box.min.x + box.max.x) / 2)).toFixed(2) : null,
            worldX: world && world.x !== undefined ? world.x : null,
            widgetLocalX: +child.widget.position.x.toFixed(2),
            extentW: child.extent ? child.extent.width : null,
            extentLeft: child.extent ? child.extent.left : null,
            boxW: box ? +(box.max.x - box.min.x).toFixed(2) : null,
          });
          walk(child, depth + 1);
        }
      };
      walk(menu.tGuiPanel, 0);

      // What does the minus button actually draw, and what draws where the
      // player thinks the minus is?
      const describe = (c) => c ? ({
        name: c.name,
        text: (() => { try { const t = c.text && c.text.text; return typeof t === 'string' ? t : String(t ?? ''); } catch { return 'err'; } })(),
        widgetVisible: !!(c.widget && c.widget.visible),
        fillTexture: (() => { try { return c.getFill().material.uniforms.map.value?.name ?? null; } catch { return 'n/a'; } })(),
        fillVisible: (() => { try { return !!c.getFill().visible; } catch { return null; } })(),
        hasHighlight: !!c.highlight, hasBorder: !!c.border,
        borderFillName: (() => { try { return String(c.border && c.border.fill && c.border.fill.name || ''); } catch { return 'err'; } })(),
        boxMinX: c.box ? +c.box.min.x.toFixed(1) : null,
        boxMaxX: c.box ? +c.box.max.x.toFixed(1) : null,
      }) : null;
      const m = gs.MenuManager.CharGenAbilities;
      out_detail = {
        STR_MINUS: describe(m && m.STR_MINUS_BTN),
        STR_POINTS: describe(m && m.STR_POINTS_BTN),
        STR_PLUS: describe(m && m.STR_PLUS_BTN),
        STR_LBL: describe(m && m.STR_LBL),
        COST_LBL: describe(m && (m.COST_LBL || m.LBL_COST)),
      };

      return {
        detail: out_detail,
        menu: menu.constructor.name,
        menuScale: menu.scale,
        viewport: gs.ResolutionManager.getViewportWidth() + 'x' + gs.ResolutionManager.getViewportHeight(),
        controls: rows.filter(r => /BTN|_UP|_DOWN|MINUS|PLUS|\\+|\\-/i.test(r.name) || r.clickable),
      };
    })()`, { timeoutMs: 60000 });

    const shot = await harness.cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(__dirname, 'evidence', 'hitbox-abilities.png'), Buffer.from(shot.data, 'base64'));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
