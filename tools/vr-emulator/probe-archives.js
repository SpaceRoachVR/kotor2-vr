/**
 * Ad-hoc probe: what GetModuleArchives actually returns.
 *
 * ERFObject/RIMObject swallow their own load failures, so load() resolves and
 * the loader hands back an empty archive rather than nothing. This install
 * ships no .mod files at all, so GetModuleMod was expected to be returning an
 * empty ERF for every module - and logging "success" while doing it. Check the
 * claim rather than assert it.
 */
const { VrHarness } = require('./harness');

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[argv.indexOf('--url') + 1];
  if (!url || url.startsWith('--')) throw new Error('--url <launch url> is required');
  const harness = new VrHarness({ port: 9463 });
  try {
    await harness.launch(url);
    try {
      await harness.waitFor(
        `Array.from(document.querySelectorAll('button')).some(b => (b.textContent||'').trim() === 'OK')`, 60_000);
      const box = await harness.evaluate(`(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => (x.textContent||'').trim() === 'OK');
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) };
      })()`);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await harness.cdp.send('Input.dispatchMouseEvent', {
          type, x: box.x, y: box.y, button: 'left', clickCount: 1,
          buttons: type === 'mousePressed' ? 1 : 0 });
      }
    } catch { /* already accepted */ }
    await harness.waitFor(`document.querySelector('#vr-spike-button') !== null`, 240_000, 2000);

    const report = await harness.evaluate(`(async () => {
      const M = window.KotOR.GameState.Module;
      const out = {};
      for (const name of ['154HAR', '001EBO', '202TEL']) {
        const mod = await M.GetModuleMod(name);
        const rimA = await M.GetModuleRimA(name);
        const rimB = await M.GetModuleRimB(name);
        const dlg = await M.GetModuleDLG(name);
        const lips = await M.GetModuleLips(name);
        const describe = (a) => a === undefined ? 'undefined'
          : { entries: (a.resources || []).length, loadFailed: !!a.loadFailed, notFound: !!a.notFound };
        out[name] = { mod: describe(mod), rimA: describe(rimA), rimB: describe(rimB),
                      dlg: describe(dlg), lips: describe(lips) };
      }
      const archives = await M.GetModuleArchives('154HAR');
      out.getModuleArchives154HAR = (archives || []).map(a => ({
        path: String(a.resource_path || ''), entries: (a.resources || []).length }));
      return out;
    })()`, { timeoutMs: 120000 });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await harness.close();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
