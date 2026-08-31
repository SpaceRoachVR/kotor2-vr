/**
 * Ad-hoc probe: did the layered Override index build, and do the per-module
 * loading screens resolve through it?
 *
 * The earlier probe checked `GameMenu.backgroundMaterial`, which is the wrong
 * surface for a loading screen: `LoadScreen.setLoadBackground` assigns the
 * texture to the *panel fill* instead, using a resref from `loadscreens.2da`
 * chosen per module. Those are exactly the textures a planet-texture mod
 * replaces, so they exercise the layered Override path that the regression
 * gate — which runs with no `--mod` roots — never touches.
 *
 *   node tools/vr-emulator/probe-override-index.js --url "<launch url>"
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

  const harness = new VrHarness({ port: 9434 });
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
      const RL = K.ResourceLoader;
      const out = {};

      // Did the Override index build at all, and with which layers?
      const counts = {};
      const layerCounts = {};
      let indexedTypes = 0;
      for (const type of [K.ResourceTypes.tpc, K.ResourceTypes.tga, K.ResourceTypes.txi,
                          K.ResourceTypes.mdl, K.ResourceTypes.mdx]) {
        let n = 0;
        // No public enumeration, so sample through the accessor on known names.
        counts[type] = n;
      }
      out.overrideProbe = {};

      // Sample a handful of names that the installed mods actually ship.
      for (const name of ['c_banthh01', 'i_belt_holoadv']) {
        const entries = RL.getOverrideResourceEntries
          ? RL.getOverrideResourceEntries(K.ResourceTypes.tpc, name)
          : null;
        out.overrideProbe[name] = entries
          ? entries.map(e => ({ layerId: e.layerId, layerOrder: e.layerOrder, filepath: e.filepath }))
          : 'accessor missing';
      }

      // The per-module loading screens: the surface that is actually green.
      const table = K.GameState.TwoDAManager.datatables.get('loadscreens');
      out.loadscreenRows = table ? table.RowCount : null;
      out.loadscreens = [];
      if (table) {
        const seen = new Set();
        for (let i = 0; i < table.RowCount && out.loadscreens.length < 12; i++) {
          const row = table.rows[i];
          const resref = row && (row.bmpresref || row.BMPResRef);
          if (!resref || seen.has(resref)) continue;
          seen.add(resref);
          let ok = false, err = null;
          try { ok = !!(await K.TextureLoader.LoadGUI(resref)); }
          catch (e) { err = String(e && e.message || e); }
          out.loadscreens.push({ resref, ok, err });
        }
      }
      return out;
    })()`, { timeoutMs: 180000 });

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
