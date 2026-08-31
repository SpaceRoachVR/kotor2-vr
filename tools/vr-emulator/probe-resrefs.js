/**
 * Sweep: do the texture resrefs hard-coded in engine code exist in THIS install?
 *
 * `GUIFeatItem` asked for `lbl_indent` and `lbl_skarr` — K1 names hard-coded in
 * a class TSL also uses — and every TSL feat row rendered as a magenta checker
 * because the install ships neither. That mistake is invisible until someone
 * opens the right screen, so this asks the engine's own router to resolve every
 * literal collected from the source and reports which come back missing.
 *
 *   node tools/vr-emulator/probe-resrefs.js --url "<launch url>" --refs a,b,c
 */
const { VrHarness } = require('./harness');

async function acceptEula(harness) {
  try {
    await harness.waitFor(
      `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
  } catch { return; }
  const box = await harness.evaluate(`(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const btn = Array.from(document.querySelectorAll('button')).filter(visible)
      .find(b => (b.textContent || '').trim() === 'OK');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!box) return;
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
  const refs = (argv[argv.indexOf('--refs') + 1] || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');
  if (!refs.length) throw new Error('--refs a,b,c is required');

  const harness = new VrHarness({ port: 9455 });
  try {
    await harness.launch(url);
    await acceptEula(harness);
    await harness.waitFor(`!!(window.KotOR && window.KotOR.GameState && window.KotOR.GameState.MenuManager)`, 240_000);
    await harness.waitFor(`!!window.KotOR.GameState.MenuManager.MainMenu`, 240_000);

    const report = await harness.evaluate(`(async () => {
      const K = window.KotOR;
      const out = { resolved: [], missing: [] };
      for (const ref of ${JSON.stringify(refs)}) {
        let ok = false, err = null;
        try { ok = !!(await K.TextureLoader.LoadGUI(ref)); }
        catch (e) { err = String(e && e.message || e); }
        (ok ? out.resolved : out.missing).push(err ? ref + ' (' + err + ')' : ref);
      }
      return out;
    })()`, { timeoutMs: 180000 });

    console.log(JSON.stringify(report, null, 1));
  } finally {
    await harness.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
