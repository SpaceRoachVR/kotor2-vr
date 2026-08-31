/**
 * Ad-hoc probe: why is the loading screen a flat colour?
 *
 * `GameMenu` draws a "background void" sprite at z=-6 tinted RGB(0.102, 0.698,
 * 0.549) — a green-teal — with the real background texture at z=-5 on a
 * `transparent` material. So a solid green screen is not a broken shader or a
 * wrong clear colour: it is the void showing through because the background
 * texture never reached the material.
 *
 * Boots to the main menu and reports, for each menu that carries a background,
 * whether its texture resolved and what the material is actually holding.
 *
 *   node tools/vr-emulator/probe-loadscreen.js --url "<launch url>"
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

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');

  const harness = new VrHarness({ port: 9431 });
  try {
    await harness.launch(url);
    await harness.waitFor(
      `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`,
      90_000,
    );
    await clickButtonByText(harness, 'OK');
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);

    const report = await harness.evaluate(`(async () => {
      const K = window.KotOR;
      const gs = K.GameState;
      const out = { context: gs.rendererContextMode, isWebGL2: gs.renderer?.capabilities?.isWebGL2, menus: [], direct: {} };

      // Does the resolver hand back a texture for these at all?
      for (const resref of ['1600x1200load', 'load_default', 'blackfill']) {
        try {
          const tex = await K.TextureLoader.LoadGUI(resref);
          out.direct[resref] = tex
            ? { ok: true, name: tex.name, w: tex.image?.width ?? null, h: tex.image?.height ?? null,
                isCompressed: !!tex.isCompressedTexture, mipmaps: tex.mipmaps?.length ?? null,
                format: tex.format, needsUpdate: tex.needsUpdate }
            : { ok: false };
        } catch (e) { out.direct[resref] = { ok: false, threw: String(e && e.message || e) }; }
      }

      // What do the live menus actually hold?
      for (const name of ['MainMenu', 'LoadScreen']) {
        const menu = gs.MenuManager[name];
        if (!menu) { out.menus.push({ name, present: false }); continue; }
        const mapValue = menu.backgroundMaterial?.uniforms?.map?.value ?? null;
        out.menus.push({
          name,
          present: true,
          background: menu.background ?? null,
          hasBackgroundSprite: !!menu.backgroundSprite,
          hasVoidSprite: !!menu.backgroundVoidSprite,
          mapIsSet: !!mapValue,
          mapName: mapValue?.name ?? null,
          mapImageW: mapValue?.image?.width ?? null,
          mapMipmaps: mapValue?.mipmaps?.length ?? null,
        });
      }
      return out;
    })()`, { timeoutMs: 120000, awaitPromise: true });

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
